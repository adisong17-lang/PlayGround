from __future__ import annotations

from pathlib import Path

import pytest

from src.synthetic import SCENARIOS, generate_scenario


@pytest.mark.parametrize("scenario", ["clean_uptrend", "gap_down_stop"])
def test_synthetic_generator_produces_valid_ohlcv(scenario):
    bundle = generate_scenario(scenario, sessions=300, stocks_per_sector=2)
    assert bundle.benchmark.index.is_monotonic_increasing
    assert len(bundle.data) == 12
    for frame in bundle.data.values():
        assert not frame.isna().any().any()
        assert (frame["high"] >= frame[["open", "close", "low"]].max(axis=1)).all()
        assert (frame["low"] <= frame[["open", "high", "close"]].min(axis=1)).all()
        assert (frame[["open", "high", "low", "close"]] > 0).all().all()
        assert (frame["volume"] > 0).all()
    assert bundle.membership is not None and not bundle.membership.empty


def test_bundled_synthetic_datasets_exist():
    root = Path("data/synthetic")
    for scenario in SCENARIOS:
        directory = root / scenario
        assert directory.is_dir(), f"missing synthetic dataset {scenario}"
        assert (directory / "NIFTY50.csv").exists()
        assert (directory / "sectors.csv").exists()
        assert (directory / "universe_history.csv").exists()
        assert len(list(directory.glob("*.csv"))) >= 20
