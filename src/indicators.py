"""Technical indicators used by the strategy.

Every indicator is causal: the value at row *t* only uses rows <= *t*.
Nothing is centred, shifted backwards, or resampled with future information.
"""

from __future__ import annotations

from typing import Any, Mapping

import numpy as np
import pandas as pd

OHLCV_COLUMNS = ["open", "high", "low", "close", "volume"]


def ensure_ohlcv(df: pd.DataFrame, symbol: str | None = None) -> pd.DataFrame:
    """Return a clean, date-indexed, lower-case OHLCV frame.

    Rows with a missing or non-positive close are dropped. Duplicate dates keep
    the last observation. The input frame is never mutated.
    """
    name = f" for {symbol}" if symbol else ""
    if df is None or len(df) == 0:
        raise ValueError(f"Empty OHLCV frame{name}")

    out = df.copy()
    out.columns = [str(c).strip().lower() for c in out.columns]
    if "date" in out.columns:
        out["date"] = pd.to_datetime(out["date"], errors="coerce")
        out = out.set_index("date")
    elif not isinstance(out.index, pd.DatetimeIndex):
        out.index = pd.to_datetime(out.index, errors="coerce")
    out.index = pd.DatetimeIndex(out.index).tz_localize(None).normalize()
    out = out[~out.index.isna()]

    required = [c for c in OHLCV_COLUMNS if c not in out.columns]
    if required:
        raise ValueError(f"Missing columns{name}: {required}")

    for col in OHLCV_COLUMNS:
        out[col] = pd.to_numeric(out[col], errors="coerce")

    out = out.sort_index()
    out = out[~out.index.duplicated(keep="last")]
    out = out.dropna(subset=["close"])
    out = out[(out["close"] > 0) & (out["high"] > 0) & (out["low"] > 0)]

    # Repair occasional bad vendor rows without inventing prices.
    out["high"] = out[["high", "open", "close", "low"]].max(axis=1)
    out["low"] = out[["low", "open", "close", "high"]].min(axis=1)
    out["volume"] = out["volume"].fillna(0.0).clip(lower=0.0)
    out["open"] = out["open"].fillna(out["close"])
    return out


def sma(series: pd.Series, window: int) -> pd.Series:
    return series.rolling(window=int(window), min_periods=int(window)).mean()


def ema(series: pd.Series, span: int) -> pd.Series:
    return series.ewm(span=int(span), adjust=False, min_periods=int(span)).mean()


def true_range(df: pd.DataFrame) -> pd.Series:
    prev_close = df["close"].shift(1)
    ranges = pd.concat(
        [
            df["high"] - df["low"],
            (df["high"] - prev_close).abs(),
            (df["low"] - prev_close).abs(),
        ],
        axis=1,
    )
    tr = ranges.max(axis=1)
    tr.iloc[:1] = (df["high"] - df["low"]).iloc[:1]
    return tr


def atr(df: pd.DataFrame, window: int = 14) -> pd.Series:
    """Wilder's Average True Range."""
    tr = true_range(df)
    return tr.ewm(alpha=1.0 / int(window), adjust=False, min_periods=int(window)).mean()


def rolling_return(close: pd.Series, window: int) -> pd.Series:
    return close / close.shift(int(window)) - 1.0


def annualized_volatility(
    close: pd.Series,
    window: int,
    periods_per_year: int = 252,
    ddof: int = 0,
) -> pd.Series:
    """Annualised rolling standard deviation of simple daily returns."""
    returns = close.pct_change(fill_method=None)
    return returns.rolling(int(window), min_periods=int(window)).std(ddof=ddof) * np.sqrt(
        periods_per_year
    )


def highest_high(df: pd.DataFrame, window: int, include_today: bool = True) -> pd.Series:
    series = df["high"]
    if not include_today:
        series = series.shift(1)
    return series.rolling(int(window), min_periods=int(window)).max()


def lowest_low(df: pd.DataFrame, window: int, include_today: bool = True) -> pd.Series:
    series = df["low"]
    if not include_today:
        series = series.shift(1)
    return series.rolling(int(window), min_periods=int(window)).min()


def candle_close_position(df: pd.DataFrame) -> pd.Series:
    spread = (df["high"] - df["low"]).replace(0.0, np.nan)
    return ((df["close"] - df["low"]) / spread).fillna(0.0)


def add_indicators(
    df: pd.DataFrame,
    *,
    ema_fast: int = 20,
    ema_mid: int = 50,
    sma_slow: int = 200,
    atr_window: int = 14,
    volume_window: int = 20,
    breakout_lookback: int = 10,
    swing_low_window: int = 10,
    exit_low_window: int = 10,
    slope_lookback: int = 1,
    rs_window: int = 63,
    pullback_atr_mult: float = 1.0,
    pullback_lookback: int = 5,
) -> pd.DataFrame:
    """Add all strategy indicators to a cleaned OHLCV frame."""
    out = ensure_ohlcv(df)
    out[f"ema{ema_fast}"] = ema(out["close"], ema_fast)
    out[f"ema{ema_mid}"] = ema(out["close"], ema_mid)
    out[f"sma{sma_slow}"] = sma(out["close"], sma_slow)
    out[f"atr{atr_window}"] = atr(out, atr_window)
    out[f"avg_volume{volume_window}"] = (
        out["volume"].shift(1).rolling(volume_window, min_periods=volume_window).mean()
    )
    out["prev_high"] = out["high"].shift(1)
    out["high_breakout_prev"] = highest_high(out, breakout_lookback, include_today=False)
    out["swing_low"] = lowest_low(out, swing_low_window, include_today=True)
    out["exit_low_prev"] = lowest_low(out, exit_low_window, include_today=False)
    out["close_position"] = candle_close_position(out)
    out["volume_ratio"] = out["volume"] / out[f"avg_volume{volume_window}"].replace(0, np.nan)
    out[f"ret{rs_window}"] = rolling_return(out["close"], rs_window)

    for window in (ema_fast, ema_mid):
        col = f"ema{window}"
        out[f"{col}_slope"] = out[col] - out[col].shift(int(slope_lookback))

    atr_col = f"atr{atr_window}"
    atr_safe = out[atr_col].replace(0, np.nan)
    distance_fast = (out["close"] - out[f"ema{ema_fast}"]).abs() / atr_safe
    distance_mid = (out["close"] - out[f"ema{ema_mid}"]).abs() / atr_safe
    low_distance_fast = (out["low"] - out[f"ema{ema_fast}"]).abs() / atr_safe
    low_distance_mid = (out["low"] - out[f"ema{ema_mid}"]).abs() / atr_safe
    near_ema = (
        (distance_fast <= float(pullback_atr_mult))
        | (distance_mid <= float(pullback_atr_mult))
        | (low_distance_fast <= float(pullback_atr_mult))
        | (low_distance_mid <= float(pullback_atr_mult))
    )
    out["pullback_ok"] = (
        near_ema.rolling(int(pullback_lookback), min_periods=1).max().fillna(0).astype(bool)
    )
    out["pullback_distance_atr"] = np.minimum.reduce(
        [distance_fast, distance_mid, low_distance_fast, low_distance_mid]
    )

    out["trend_up"] = (
        (out["close"] > out[f"ema{ema_fast}"])
        & (out[f"ema{ema_fast}"] > out[f"ema{ema_mid}"])
        & (out[f"ema{ema_mid}"] > out[f"sma{sma_slow}"])
        & (out[f"ema{ema_fast}_slope"] > 0)
        & (out[f"ema{ema_mid}_slope"] > 0)
    )
    return out


def add_indicators_from_config(df: pd.DataFrame, config: Mapping[str, Any]) -> pd.DataFrame:
    s = config.get("strategy", {})
    return add_indicators(
        df,
        ema_fast=s.get("ema_fast", 20),
        ema_mid=s.get("ema_mid", 50),
        sma_slow=s.get("sma_slow", 200),
        atr_window=s.get("atr_window", 14),
        volume_window=s.get("volume_window", 20),
        breakout_lookback=s.get("breakout_lookback", 10),
        swing_low_window=s.get("swing_low_window", 10),
        exit_low_window=s.get("exit_low_window", 10),
        slope_lookback=s.get("slope_lookback", 1),
        rs_window=s.get("rs_window", 63),
        pullback_atr_mult=s.get("pullback_atr_mult", 1.0),
        pullback_lookback=s.get("pullback_lookback", 5),
    )
