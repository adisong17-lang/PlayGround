"""Point-in-time scanner for the latest available session."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Mapping

import numpy as np
import pandas as pd

from .data_loader import load_data
from .momentum import index_return, score_frame, sector_strength, top_fraction
from .regime import regime_at, regime_frame
from .risk import compute_stop, size_position
from .strategy import (
    build_candidates,
    prepare_data,
    pullback_status,
    stock_trend,
)
from .universe import Universe


SCANNER_COLUMNS = [
    "symbol",
    "sector",
    "eligible",
    "rejection_reason",
    "momentum_score",
    "return_6m",
    "return_12m",
    "volatility_6m",
    "volatility_12m",
    "relative_strength",
    "trend_status",
    "pullback_status",
    "volume_ratio",
    "entry_price",
    "stop_price",
    "stop_distance_pct",
    "quantity",
    "position_value",
    "risk_amount",
    "regime_ok",
    "sector_eligible",
]


def _resolve_date(benchmark: pd.DataFrame, as_of: str | pd.Timestamp | None) -> pd.Timestamp:
    if as_of is None:
        return pd.Timestamp(benchmark.index.max())
    target = pd.Timestamp(as_of)
    candidates = benchmark.index[benchmark.index <= target]
    if len(candidates) == 0:
        raise ValueError(f"No benchmark data at or before {target.date()}")
    return pd.Timestamp(candidates[-1])


def scan(
    config: Mapping[str, Any],
    *,
    capital: float | None = None,
    as_of: str | pd.Timestamp | None = None,
    bundle: Any | None = None,
    output_dir: str | Path | None = None,
) -> tuple[pd.DataFrame, dict[str, Any]]:
    bundle = bundle if bundle is not None else load_data(config)
    capital = float(
        capital
        if capital is not None
        else config.get("backtest", {}).get("initial_capital", 1_000_000)
    )
    prepared = prepare_data(bundle.data, config)
    universe = Universe(bundle, config)
    date = _resolve_date(bundle.benchmark, as_of)
    regime_ok = regime_at(regime_frame(bundle.benchmark, config), date)

    eligibility = universe.eligibility_table(date)
    eligible_symbols = sorted(eligibility.loc[eligibility["eligible"], "symbol"]) if len(eligibility) else []
    scores = score_frame(prepared, eligible_symbols, date, config)
    sectors = sector_strength(universe, bundle.benchmark, date, config)
    top = top_fraction(scores, config.get("universe", {}).get("top_momentum_pct", 0.20)) if not scores.empty else scores
    top_symbols = set(top["symbol"]) if not top.empty else set()

    candidates, _ = build_candidates(
        prepared,
        universe,
        bundle.benchmark,
        date,
        config,
        sector_cache=sectors,
        scores_cache=scores,
    )
    candidate_map = (
        {row["symbol"]: row for row in candidates.to_dict("records")} if not candidates.empty else {}
    )
    sector_ok = set(sectors.loc[sectors["eligible"], "sector"]) if not sectors.empty else set()
    nifty_63 = index_return(bundle.benchmark, date, int(config.get("strategy", {}).get("rs_window", 63)))
    atr_window = int(config.get("strategy", {}).get("atr_window", 14))
    strategy_cfg = config.get("strategy", {})

    rows: list[dict[str, Any]] = []
    for symbol in eligibility["symbol"]:
        base = eligibility.loc[eligibility["symbol"] == symbol].iloc[0]
        sector = universe.sector_of(symbol)
        reasons: list[str] = []
        row = {
            "symbol": symbol,
            "sector": sector,
            "eligible": False,
            "rejection_reason": "",
            "momentum_score": np.nan,
            "return_6m": np.nan,
            "return_12m": np.nan,
            "volatility_6m": np.nan,
            "volatility_12m": np.nan,
            "relative_strength": np.nan,
            "trend_status": "unknown",
            "pullback_status": "unknown",
            "volume_ratio": np.nan,
            "entry_price": np.nan,
            "stop_price": np.nan,
            "stop_distance_pct": np.nan,
            "quantity": 0,
            "position_value": 0.0,
            "risk_amount": 0.0,
            "regime_ok": bool(regime_ok),
            "sector_eligible": sector in sector_ok,
        }
        if not bool(base["eligible"]):
            reasons.append(str(base["reason"]))
            row["rejection_reason"] = "|".join(reasons)
            rows.append(row)
            continue

        score_row = scores.loc[scores["symbol"] == symbol] if not scores.empty else pd.DataFrame()
        if len(score_row):
            item = score_row.iloc[0]
            row.update(
                {
                    "momentum_score": float(item["score"]),
                    "return_6m": float(item["return_6m"]),
                    "return_12m": float(item["return_12m"]),
                    "volatility_6m": float(item["volatility_6m"]),
                    "volatility_12m": float(item["volatility_12m"]),
                }
            )

        df = prepared.get(symbol)
        if df is None or date not in df.index:
            reasons.append("missing_data_on_date")
            row["rejection_reason"] = "|".join(reasons)
            rows.append(row)
            continue
        data_row = df.loc[date]
        trend_ok = stock_trend(data_row, config)
        pull_ok, pull_distance = pullback_status(data_row, config)
        stock_ret = float(data_row.get(f"ret{int(strategy_cfg.get('rs_window', 63))}", np.nan))
        row.update(
            {
                "relative_strength": stock_ret - nifty_63 if np.isfinite(stock_ret) else np.nan,
                "trend_status": "up" if trend_ok else "not_up",
                "pullback_status": "near_ema" if pull_ok else "extended",
                "volume_ratio": float(data_row.get("volume_ratio", np.nan)),
                "entry_price": float(data_row["close"]),
            }
        )
        if symbol not in top_symbols:
            reasons.append("not_top_momentum_20pct")
        if not trend_ok:
            reasons.append("trend_filter")
        if not pull_ok:
            reasons.append("not_near_ema")
        if sector not in sector_ok:
            reasons.append("sector_not_eligible")
        if not np.isfinite(stock_ret) or stock_ret <= nifty_63:
            reasons.append("weak_relative_strength")

        candidate = candidate_map.get(symbol)
        if candidate is not None:
            candidate_reasons = str(candidate.get("rejection_reason", ""))
            if candidate_reasons:
                reasons.extend([r for r in candidate_reasons.split("|") if r not in reasons])
            row["entry_price"] = float(candidate.get("entry_reference", row["entry_price"]))
            row["stop_price"] = float(candidate.get("stop_price", np.nan))
            row["stop_distance_pct"] = float(candidate.get("stop_distance_pct", np.nan))
        else:
            stop_plan = compute_stop(
                float(data_row["close"]),
                float(data_row["swing_low"]),
                float(data_row[f"atr{atr_window}"]),
                float(strategy_cfg.get("atr_stop_mult", 2.0)),
                float(strategy_cfg.get("max_stop_distance_pct", 0.08)),
            )
            row["stop_price"] = stop_plan.stop_price
            row["stop_distance_pct"] = stop_plan.distance_pct
            if not stop_plan.valid:
                reasons.append(stop_plan.reason)

        if not regime_ok:
            reasons.append("market_regime_bear")

        if not reasons:
            sizing = size_position(
                equity=capital,
                entry_price=float(row["entry_price"]),
                stop_price=float(row["stop_price"]),
                config=config,
                cash=capital,
                open_positions=0,
                sector_positions=0,
                portfolio_risk_amount=0.0,
            )
            if sizing.valid:
                row["quantity"] = sizing.quantity
                row["position_value"] = sizing.position_value
                row["risk_amount"] = sizing.risk_amount
            else:
                reasons.append(sizing.reason)

        row["eligible"] = len(reasons) == 0
        row["rejection_reason"] = "|".join(dict.fromkeys(reasons))
        rows.append(row)

    frame = pd.DataFrame(rows)
    for column in SCANNER_COLUMNS:
        if column not in frame.columns:
            frame[column] = np.nan
    frame = frame[SCANNER_COLUMNS]
    frame = frame.sort_values(
        ["eligible", "momentum_score"], ascending=[False, False], na_position="last"
    ).reset_index(drop=True)

    summary = {
        "as_of": date.date().isoformat(),
        "regime_ok": bool(regime_ok),
        "capital": capital,
        "universe_members": int(len(frame)),
        "eligible": int(frame["eligible"].sum()),
        "top_momentum_cohort": int(len(top)),
        "sectors_eligible": sorted(sector_ok),
        "rows": frame,
    }

    if output_dir is not None:
        out = Path(output_dir)
        out.mkdir(parents=True, exist_ok=True)
        frame.to_csv(out / f"scanner_{date.strftime('%Y%m%d')}.csv", index=False)
    return frame, summary


def format_scanner_output(frame: pd.DataFrame, summary: Mapping[str, Any], limit: int = 20) -> str:
    lines = [
        f"Scanner as of {summary['as_of']} | regime={'BULL' if summary['regime_ok'] else 'BEAR'} "
        f"| capital={summary['capital']:,.0f}",
        f"Universe members: {summary['universe_members']} | fully eligible: {summary['eligible']} "
        f"| top momentum cohort: {summary['top_momentum_cohort']}",
    ]
    display = frame.loc[frame["eligible"]].copy()
    if display.empty:
        display = frame.head(limit).copy()
        lines.append("No fully eligible entries; showing the highest-ranked rejected names.")
    columns = [
        "symbol",
        "sector",
        "momentum_score",
        "return_6m",
        "return_12m",
        "relative_strength",
        "trend_status",
        "pullback_status",
        "volume_ratio",
        "entry_price",
        "stop_price",
        "quantity",
        "position_value",
        "rejection_reason",
    ]
    display = display[columns].head(limit)
    for column in ("momentum_score", "return_6m", "return_12m", "relative_strength", "volume_ratio"):
        display[column] = display[column].map(
            lambda value: f"{value:.3f}" if pd.notna(value) else "-"
        )
    for column in ("entry_price", "stop_price", "position_value"):
        display[column] = display[column].map(
            lambda value: f"{value:,.2f}" if pd.notna(value) else "-"
        )
    lines.append(display.to_string(index=False))
    return "\n".join(lines)
