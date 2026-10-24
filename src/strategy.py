"""Signal generation, trend confirmation, pullback and exit rules."""

from __future__ import annotations

from typing import Any, Mapping

import numpy as np
import pandas as pd

from .indicators import add_indicators_from_config
from .momentum import index_return, score_frame, sector_strength, top_fraction
from .regime import regime_at, regime_frame
from .risk import compute_stop


def prepare_data(
    data: Mapping[str, pd.DataFrame], config: Mapping[str, Any]
) -> dict[str, pd.DataFrame]:
    return {symbol: add_indicators_from_config(df, config) for symbol, df in data.items()}


def stock_trend(row: Mapping[str, Any], config: Mapping[str, Any]) -> bool:
    cfg = config.get("strategy", {})
    fast = int(cfg.get("ema_fast", 20))
    mid = int(cfg.get("ema_mid", 50))
    slow = int(cfg.get("sma_slow", 200))
    try:
        return bool(
            row["close"] > row[f"ema{fast}"]
            and row[f"ema{fast}"] > row[f"ema{mid}"]
            and row[f"ema{mid}"] > row[f"sma{slow}"]
            and row[f"ema{fast}_slope"] > 0
            and row[f"ema{mid}_slope"] > 0
        )
    except (KeyError, TypeError):
        return False


def pullback_status(row: Mapping[str, Any], config: Mapping[str, Any]) -> tuple[bool, float]:
    """Whether price touched within 1 ATR of the 20/50 EMA recently.

    The pullback window is configurable (default five sessions), because the
    breakout confirmation normally happens after the actual touch. Requiring
    both on the same candle would make the setup almost impossible to trigger.
    """
    cfg = config.get("strategy", {})
    fast = int(cfg.get("ema_fast", 20))
    mid = int(cfg.get("ema_mid", 50))
    atr_value = row.get(f"atr{int(cfg.get('atr_window', 14))}")
    if atr_value is None or not np.isfinite(atr_value) or atr_value <= 0:
        return False, np.nan
    distance = min(
        abs(float(row["close"]) - float(row[f"ema{fast}"])),
        abs(float(row["close"]) - float(row[f"ema{mid}"])),
    )
    distance_in_atr = distance / float(atr_value)
    recent = row.get("pullback_ok")
    if recent is not None and np.isfinite(recent):
        return bool(recent), float(distance_in_atr)
    return bool(distance_in_atr <= float(cfg.get("pullback_atr_mult", 1.0))), float(distance_in_atr)


def entry_confirmation(row: Mapping[str, Any], config: Mapping[str, Any]) -> bool:
    cfg = config.get("strategy", {})
    try:
        breakout = (row["close"] > row["prev_high"]) or (
            row["close"] > row["high_breakout_prev"]
        )
        volume_ok = row["volume_ratio"] >= float(cfg.get("volume_mult", 1.3))
        candle_ok = row["close_position"] >= float(cfg.get("close_range_min", 0.60))
        bullish = row["close"] > row["open"]
        return bool(breakout and volume_ok and candle_ok and bullish)
    except (KeyError, TypeError):
        return False


def build_candidates(
    prepared: Mapping[str, pd.DataFrame],
    universe: Any,
    benchmark: pd.DataFrame,
    date: pd.Timestamp,
    config: Mapping[str, Any],
    *,
    sector_cache: pd.DataFrame | None = None,
    scores_cache: pd.DataFrame | None = None,
    require_confirmation: bool = True,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Evaluate the top momentum cohort at ``date``.

    Returns ``(candidates, sectors)``. ``candidates`` contains every member of
    the top momentum cohort, including rejected names and a rejection reason.
    """
    date = pd.Timestamp(date)
    eligible = universe.eligible_symbols(date)
    scores = (
        scores_cache
        if scores_cache is not None
        else score_frame(prepared, eligible, date, config)
    )
    sectors = (
        sector_cache
        if sector_cache is not None
        else sector_strength(universe, benchmark, date, config)
    )
    if scores.empty:
        return pd.DataFrame(), sectors

    top = top_fraction(scores, config.get("universe", {}).get("top_momentum_pct", 0.20))
    sector_ok = set(sectors.loc[sectors["eligible"], "sector"]) if not sectors.empty else set()
    nifty_rs = index_return(benchmark, date, int(config.get("strategy", {}).get("rs_window", 63)))
    cfg = config.get("strategy", {})
    atr_window = int(cfg.get("atr_window", 14))
    max_stop = float(cfg.get("max_stop_distance_pct", 0.08))
    rows = []

    for item in top.to_dict("records"):
        symbol = item["symbol"]
        sector = universe.sector_of(symbol)
        df = prepared.get(symbol)
        reasons: list[str] = []
        row: Mapping[str, Any] | None = None
        if df is None or date not in df.index:
            reasons.append("missing_data_on_date")
        else:
            row = df.loc[date]
            if not np.isfinite(row.get(f"atr{atr_window}", np.nan)):
                reasons.append("missing_atr")
            if not stock_trend(row, config):
                reasons.append("trend_filter")
            pullback, distance_atr = pullback_status(row, config)
            if not pullback:
                reasons.append("not_near_ema")
            if require_confirmation and not entry_confirmation(row, config):
                reasons.append("no_entry_confirmation")
            if row.get(f"ret{int(cfg.get('rs_window', 63))}", np.nan) <= nifty_rs:
                reasons.append("weak_relative_strength")
        if sector not in sector_ok:
            reasons.append("sector_not_eligible")
        if row is not None:
            stop_plan = compute_stop(
                float(row["close"]),
                float(row["swing_low"]),
                float(row[f"atr{atr_window}"]),
                float(cfg.get("atr_stop_mult", 2.0)),
                max_stop,
            )
            if not stop_plan.valid:
                reasons.append(stop_plan.reason)
        else:
            stop_plan = None

        rows.append(
            {
                **item,
                "sector": sector,
                "sector_return_63d": _sector_value(sectors, sector, "sector_return_63d"),
                "sector_relative_return": _sector_value(sectors, sector, "relative_return"),
                "sector_above_sma": _sector_value(sectors, sector, "above_sma"),
                "sector_eligible": sector in sector_ok,
                "ret_63d": float(row.get(f"ret{int(cfg.get('rs_window', 63))}", np.nan))
                if row is not None
                else np.nan,
                "relative_strength": float(
                    row.get(f"ret{int(cfg.get('rs_window', 63))}", np.nan) - nifty_rs
                )
                if row is not None
                else np.nan,
                "trend_ok": stock_trend(row, config) if row is not None else False,
                "pullback_ok": pullback_status(row, config)[0] if row is not None else False,
                "pullback_distance_atr": pullback_status(row, config)[1]
                if row is not None
                else np.nan,
                "volume_ratio": float(row.get("volume_ratio", np.nan)) if row is not None else np.nan,
                "entry_reference": float(row["close"]) if row is not None else np.nan,
                "stop_price": float(stop_plan.stop_price) if stop_plan is not None else np.nan,
                "stop_distance_pct": float(stop_plan.distance_pct)
                if stop_plan is not None
                else np.nan,
                "atr": float(row.get(f"atr{atr_window}", np.nan)) if row is not None else np.nan,
                "swing_low": float(row.get("swing_low", np.nan)) if row is not None else np.nan,
                "eligible": len(reasons) == 0,
                "rejection_reason": "|".join(reasons),
            }
        )

    return pd.DataFrame(rows), sectors


def _sector_value(sectors: pd.DataFrame, sector: str, column: str) -> Any:
    if sectors.empty or "sector" not in sectors.columns:
        return np.nan
    match = sectors.loc[sectors["sector"] == sector, column]
    return match.iloc[0] if len(match) else np.nan


def evaluate_exit(
    position: Any,
    row: Mapping[str, Any],
    config: Mapping[str, Any],
) -> tuple[str, str]:
    """Return ``(should_exit_reason, detail)`` using close data only.

    The trailing stop is intentionally evaluated on the close and executed on
    the next open, matching the strategy specification. The initial hard stop is
    separate and is handled intraday by the backtester.
    """
    cfg = config.get("strategy", {})
    close = float(row["close"])
    ema_fast = float(row[f"ema{int(cfg.get('ema_fast', 20))}"])
    exit_low = row.get("exit_low_prev")
    if pd.notna(exit_low) and close < float(exit_low):
        return "close_below_10day_low", f"close {close:.2f} < prior 10d low {float(exit_low):.2f}"
    if getattr(position, "below_ema_days", 0) >= int(cfg.get("exit_ema_days", 2)):
        return "below_ema20_two_days", f"close {close:.2f} < EMA20 {ema_fast:.2f} for 2 sessions"
    if close <= position.stop_price and position.stop_price > position.initial_stop + 1e-9:
        return "atr_trailing_stop", f"close {close:.2f} <= trailing stop {position.stop_price:.2f}"
    if position.holding_sessions >= int(cfg.get("max_holding_sessions", 30)):
        return (
            "max_holding_period",
            f"{position.holding_sessions} sessions >= max {int(cfg.get('max_holding_sessions', 30))}",
        )
    return "", ""


def market_is_long_enabled(benchmark: pd.DataFrame, date: pd.Timestamp, config: Mapping[str, Any]) -> bool:
    return regime_at(regime_frame(benchmark, config), date)
