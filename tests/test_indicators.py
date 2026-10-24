from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from src.indicators import (
    add_indicators,
    annualized_volatility,
    atr,
    ema,
    ensure_ohlcv,
    rolling_return,
    sma,
    true_range,
)


def test_sma_and_ema_are_causal_and_match_pandas():
    series = pd.Series([1.0, 2.0, 3.0, 4.0, 5.0, 6.0])
    result = sma(series, 3)
    assert np.isnan(result.iloc[0]) and np.isnan(result.iloc[1])
    assert result.iloc[2] == pytest.approx(2.0)
    assert result.iloc[5] == pytest.approx(5.0)

    expected = series.ewm(span=3, adjust=False, min_periods=3).mean()
    pd.testing.assert_series_equal(ema(series, 3), expected)


def test_true_range_uses_previous_close_for_gaps():
    df = pd.DataFrame(
        {
            "open": [100.0, 115.0],
            "high": [101.0, 120.0],
            "low": [99.0, 110.0],
            "close": [100.0, 115.0],
            "volume": [1000, 1000],
        },
        index=pd.bdate_range("2020-01-01", periods=2),
    )
    tr = true_range(df)
    assert tr.iloc[0] == pytest.approx(2.0)
    assert tr.iloc[1] == pytest.approx(20.0)


def test_atr_constant_range_and_gap():
    n = 30
    close = np.full(n, 100.0)
    df = pd.DataFrame(
        {
            "open": close,
            "high": close + 1.0,
            "low": close - 1.0,
            "close": close,
            "volume": 1000,
        },
        index=pd.bdate_range("2020-01-01", periods=n),
    )
    result = atr(df, 14)
    assert np.isnan(result.iloc[12])
    assert result.iloc[13] == pytest.approx(2.0)
    assert result.iloc[-1] == pytest.approx(2.0)

    gapped = df.copy()
    gapped.iloc[-1, gapped.columns.get_loc("open")] = 115.0
    gapped.iloc[-1, gapped.columns.get_loc("high")] = 120.0
    gapped.iloc[-1, gapped.columns.get_loc("low")] = 110.0
    gapped.iloc[-1, gapped.columns.get_loc("close")] = 115.0
    assert atr(gapped, 14).iloc[-1] > 2.0


def test_rolling_return_and_volatility():
    close = pd.Series(100.0 * np.exp(np.arange(60) * 0.001))
    assert rolling_return(close, 20).iloc[-1] == pytest.approx(
        close.iloc[-1] / close.iloc[-21] - 1.0
    )
    vol = annualized_volatility(close, 20)
    assert vol.iloc[:20].isna().all()
    assert np.isfinite(vol.iloc[-1])


def test_add_indicators_contains_causal_columns_and_pullback_window():
    n = 260
    close = 100.0 * np.exp(np.arange(n) * 0.001 + 0.01 * np.sin(np.arange(n) / 5))
    df = pd.DataFrame(
        {
            "open": close * 0.999,
            "high": close * 1.006,
            "low": close * 0.994,
            "close": close,
            "volume": np.linspace(100_000, 300_000, n),
        },
        index=pd.bdate_range("2020-01-01", periods=n),
    )
    out = add_indicators(df)
    for column in ("ema20", "ema50", "sma200", "atr14", "pullback_ok", "prev_high"):
        assert column in out.columns
    assert out["prev_high"].iloc[0] != out["prev_high"].iloc[0]  # NaN
    assert out["prev_high"].iloc[1] == pytest.approx(df["high"].iloc[0])
    assert out["high_breakout_prev"].iloc[-1] == pytest.approx(
        df["high"].iloc[-11:-1].max()
    )


def test_ensure_ohlcv_repairs_bad_ranges_and_duplicates():
    df = pd.DataFrame(
        {
            "date": ["2020-01-01", "2020-01-01", "2020-01-02"],
            "open": [100, 101, 102],
            "high": [99, 103, 104],
            "low": [101, 98, 99],
            "close": [100, 102, 103],
            "volume": [1000, 2000, 3000],
        }
    )
    out = ensure_ohlcv(df, "TEST")
    assert len(out) == 2
    assert (out["high"] >= out[["open", "close", "low"]].max(axis=1)).all()
    assert (out["low"] <= out[["open", "close", "high"]].min(axis=1)).all()
    assert out["volume"].iloc[0] == 2000
