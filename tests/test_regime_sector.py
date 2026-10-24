from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from src.data_loader import DataBundle
from src.momentum import sector_strength
from src.regime import regime_at, regime_frame
from src.universe import Universe


def _ohlcv(close: np.ndarray, dates: pd.DatetimeIndex) -> pd.DataFrame:
    return pd.DataFrame(
        {
            "open": close * 0.999,
            "high": close * 1.004,
            "low": close * 0.996,
            "close": close,
            "volume": 500_000,
        },
        index=dates,
    )


def test_market_regime_requires_price_above_slow_sma_and_fast_above_slow():
    n = 320
    dates = pd.bdate_range("2019-01-01", periods=n)
    rising = 100 * np.exp(np.arange(n) * 0.002)
    config = {"regime": {"fast_sma": 50, "slow_sma": 200}}
    frame = regime_frame(_ohlcv(rising, dates), config)
    assert not regime_at(frame, dates[100])
    assert regime_at(frame, dates[-1])

    falling = 100 * np.exp(-np.arange(n) * 0.002)
    falling_frame = regime_frame(_ohlcv(falling, dates), config)
    assert not regime_at(falling_frame, dates[-1])


def _sector_bundle() -> tuple[DataBundle, dict]:
    n = 180
    dates = pd.bdate_range("2019-01-01", periods=n)
    benchmark = _ohlcv(20_000 * np.exp(np.arange(n) * 0.0002), dates)
    sectors = {}
    data = {}
    drifts = {
        "S0": 0.0020,
        "S1": 0.0014,
        "S2": 0.0005,
        "S3": -0.0003,
        "S4": -0.0012,
        "S5": -0.0020,
    }
    for sector, drift in drifts.items():
        for member in (1, 2):
            symbol = f"{sector}{member}"
            close = 100 * np.exp(np.arange(n) * drift)
            data[symbol] = _ohlcv(close, dates)
            sectors[symbol] = sector
    bundle = DataBundle(data=data, benchmark=benchmark, sectors=sectors, source="test")
    config = {
        "sector": {"rs_window": 63, "sma_window": 50, "min_members": 2},
        "universe": {"top_sector_pct": 0.30},
    }
    return bundle, config


def test_sector_filter_selects_top_relative_sectors_above_sma():
    bundle, config = _sector_bundle()
    universe = Universe(bundle, config)
    date = bundle.benchmark.index[-1]
    strength = sector_strength(universe, bundle.benchmark, date, config)
    assert not strength.empty
    assert strength["eligible"].sum() == 2
    assert set(strength.loc[strength["eligible"], "sector"]) == {"S0", "S1"}
    assert strength.loc[strength["eligible"], "above_sma"].all()
    assert not bool(strength.loc[strength["sector"] == "S5", "above_sma"].iloc[0])


def test_sector_index_does_not_use_future_prices():
    bundle, config = _sector_bundle()
    universe = Universe(bundle, config)
    date = bundle.benchmark.index[120]
    before = sector_strength(universe, bundle.benchmark, date, config)
    mutated = DataBundle(
        data={symbol: frame.copy() for symbol, frame in bundle.data.items()},
        benchmark=bundle.benchmark.copy(),
        sectors=dict(bundle.sectors),
        source="test",
    )
    for frame in mutated.data.values():
        frame.loc[frame.index > date, ["open", "high", "low", "close"]] *= 10
    after = sector_strength(universe, mutated.benchmark, date, config)
    pd.testing.assert_frame_equal(before, after)


def test_universe_missing_data_and_illiquid_rejection():
    n = 320
    dates = pd.bdate_range("2019-01-01", periods=n)
    close = 100 * np.exp(np.arange(n) * 0.001)
    good = _ohlcv(close, dates)
    missing = good.drop(good.index[300])
    illiquid = good.copy()
    illiquid["volume"] = 10
    data = {"GOOD": good, "MISSING": missing, "ILLIQ": illiquid}
    benchmark = _ohlcv(20_000 * np.exp(np.arange(n) * 0.0005), dates)
    bundle = DataBundle(data=data, benchmark=benchmark, sectors={s: "S" for s in data}, source="test")
    config = {
        "universe": {
            "min_history": 250,
            "min_price": 20,
            "min_avg_volume": 100_000,
            "min_avg_turnover": 1_000_000,
            "liquidity_lookback": 20,
            "limit_move_threshold": 0.5,
            "max_limit_move_fraction": 1.0,
        }
    }
    universe = Universe(bundle, config)
    assert universe.check("GOOD", dates[300]).eligible
    assert universe.check("MISSING", dates[300]).reason == "missing_data_on_date"
    assert universe.check("ILLIQ", dates[300]).reason == "illiquid_volume"
