"""Volatility-adjusted momentum and sector relative strength."""

from __future__ import annotations

import math
from typing import Any, Mapping

import numpy as np
import pandas as pd

from .indicators import annualized_volatility


def _loc_at(df: pd.DataFrame, date: pd.Timestamp) -> int | None:
    loc = int(df.index.searchsorted(pd.Timestamp(date), side="right")) - 1
    if loc < 0 or df.index[loc] != pd.Timestamp(date):
        return None
    return loc


def momentum_metrics(
    df: pd.DataFrame,
    date: pd.Timestamp,
    config: Mapping[str, Any],
) -> dict[str, float]:
    """Return 6M/12M returns, volatility and volatility-adjusted momentum."""
    cfg = config.get("momentum", {})
    short = int(cfg.get("short_window", 126))
    long = int(cfg.get("long_window", 252))
    vol_short = int(cfg.get("vol_window_short", short))
    vol_long = int(cfg.get("vol_window_long", long))
    ppy = int(config.get("backtest", {}).get("periods_per_year", 252))

    result = {
        "return_6m": np.nan,
        "return_12m": np.nan,
        "volatility_6m": np.nan,
        "volatility_12m": np.nan,
        "momentum_6m": np.nan,
        "momentum_12m": np.nan,
    }
    loc = _loc_at(df, date)
    if loc is None:
        return result

    close = df["close"]
    if loc >= short and close.iloc[loc - short] > 0:
        result["return_6m"] = float(close.iloc[loc] / close.iloc[loc - short] - 1.0)
    if loc >= long and close.iloc[loc - long] > 0:
        result["return_12m"] = float(close.iloc[loc] / close.iloc[loc - long] - 1.0)

    if loc + 1 > vol_short:
        vol_s = annualized_volatility(close.iloc[: loc + 1], vol_short, ppy).iloc[-1]
        if pd.notna(vol_s):
            result["volatility_6m"] = float(vol_s)
    if loc + 1 > vol_long:
        vol_l = annualized_volatility(close.iloc[: loc + 1], vol_long, ppy).iloc[-1]
        if pd.notna(vol_l):
            result["volatility_12m"] = float(vol_l)

    if result["volatility_6m"] > 0:
        result["momentum_6m"] = result["return_6m"] / result["volatility_6m"]
    if result["volatility_12m"] > 0:
        result["momentum_12m"] = result["return_12m"] / result["volatility_12m"]
    return result


def score_frame(
    data: Mapping[str, pd.DataFrame],
    symbols: list[str],
    date: pd.Timestamp,
    config: Mapping[str, Any],
) -> pd.DataFrame:
    """Build the cross-sectional momentum ranking for ``symbols`` at ``date``."""
    cfg = config.get("momentum", {})
    w6 = float(cfg.get("rank_weight_6m", 0.5))
    w12 = float(cfg.get("rank_weight_12m", 0.5))
    require_positive = bool(cfg.get("require_positive_momentum", True))

    rows = []
    for symbol in symbols:
        df = data.get(symbol)
        if df is None or df.empty:
            continue
        metrics = momentum_metrics(df, date, config)
        metrics["symbol"] = symbol
        rows.append(metrics)

    columns = [
        "symbol",
        "return_6m",
        "return_12m",
        "volatility_6m",
        "volatility_12m",
        "momentum_6m",
        "momentum_12m",
    ]
    if not rows:
        return pd.DataFrame(columns=[*columns, "rank_6m", "rank_12m", "score"])

    frame = pd.DataFrame(rows, columns=columns)
    valid = frame[["momentum_6m", "momentum_12m"]].notna().all(axis=1)
    if require_positive:
        valid &= (frame["return_6m"] > 0) & (frame["return_12m"] > 0)
    frame = frame.loc[valid].copy()
    if frame.empty:
        return pd.DataFrame(columns=[*columns, "rank_6m", "rank_12m", "score"])

    frame["rank_6m"] = frame["momentum_6m"].rank(pct=True, method="average")
    frame["rank_12m"] = frame["momentum_12m"].rank(pct=True, method="average")
    frame["score"] = w6 * frame["rank_6m"] + w12 * frame["rank_12m"]
    return frame.sort_values("score", ascending=False).reset_index(drop=True)


def top_fraction(frame: pd.DataFrame, pct: float, score_col: str = "score") -> pd.DataFrame:
    """Return roughly the top ``pct`` fraction, at least one row."""
    if frame.empty:
        return frame.copy()
    fraction = min(max(float(pct), 0.0), 1.0)
    count = max(1, int(math.ceil(len(frame) * fraction)))
    return frame.nlargest(count, score_col).reset_index(drop=True)


def index_return(df: pd.DataFrame, date: pd.Timestamp, window: int) -> float:
    loc = _loc_at(df, date)
    if loc is None or loc < window:
        return np.nan
    start = float(df["close"].iloc[loc - window])
    if start <= 0:
        return np.nan
    return float(df["close"].iloc[loc] / start - 1.0)


def _sector_index(
    members: list[str],
    data: Mapping[str, pd.DataFrame],
    dates: pd.DatetimeIndex,
) -> pd.Series | None:
    closes = []
    for symbol in members:
        df = data.get(symbol)
        if df is None or df.empty:
            continue
        series = df["close"].reindex(dates)
        if series.notna().sum() >= 2:
            closes.append(series)
    if not closes:
        return None
    close_frame = pd.concat(closes, axis=1)
    returns = close_frame.pct_change(fill_method=None)
    average_return = returns.mean(axis=1, skipna=True).fillna(0.0)
    index = (1.0 + average_return).cumprod()
    return index


def sector_strength(
    universe: Any,
    benchmark: pd.DataFrame,
    date: pd.Timestamp,
    config: Mapping[str, Any],
) -> pd.DataFrame:
    """Rank sectors by 63-day relative return and 50-day trend.

    The equal-weight sector index is reconstructed from prices up to ``date``
    and the sector's members in the active universe snapshot. The stock
    universe is point-in-time; the sector classification itself is static
    unless a historically accurate mapping is supplied.
    """
    cfg = config.get("sector", {})
    rs_window = int(cfg.get("rs_window", 63))
    sma_window = int(cfg.get("sma_window", 50))
    min_members = int(cfg.get("min_members", 2))
    top_pct = float(config.get("universe", {}).get("top_sector_pct", 0.30))
    date = pd.Timestamp(date)

    benchmark_dates = benchmark.index[benchmark.index <= date]
    if len(benchmark_dates) == 0:
        return pd.DataFrame()
    start_pos = max(0, len(benchmark_dates) - (max(rs_window, sma_window) + 20))
    dates = benchmark_dates[start_pos:]
    nifty_ret = index_return(benchmark, date, rs_window)

    rows = []
    for sector in universe.all_sectors(date):
        members = [s for s in universe.sector_members(sector, date) if s in universe.data]
        if len(members) < min_members:
            continue
        index = _sector_index(members, universe.data, dates)
        if index is None or len(index) < rs_window + 1:
            continue
        sector_ret = float(index.iloc[-1] / index.iloc[-1 - rs_window] - 1.0)
        if len(index) >= sma_window:
            sector_sma = index.rolling(sma_window, min_periods=sma_window).mean().iloc[-1]
            above_sma = bool(index.iloc[-1] > sector_sma) if pd.notna(sector_sma) else False
        else:
            above_sma = False
        rows.append(
            {
                "sector": sector,
                "members": len(members),
                "sector_return_63d": sector_ret,
                "nifty_return_63d": nifty_ret,
                "relative_return": sector_ret - nifty_ret,
                "above_sma": above_sma,
            }
        )

    if not rows:
        return pd.DataFrame(
            columns=[
                "sector",
                "members",
                "sector_return_63d",
                "nifty_return_63d",
                "relative_return",
                "above_sma",
                "sector_rank",
                "eligible",
            ]
        )

    frame = pd.DataFrame(rows)
    frame["sector_rank"] = frame["relative_return"].rank(ascending=False, method="min")
    count = max(1, int(math.ceil(len(frame) * top_pct)))
    top_ranks = set(frame.nlargest(count, "relative_return")["sector"])
    frame["eligible"] = frame["sector"].isin(top_ranks) & frame["above_sma"]
    return frame.sort_values("relative_return", ascending=False).reset_index(drop=True)
