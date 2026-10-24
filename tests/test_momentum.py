from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from src.indicators import annualized_volatility
from src.momentum import momentum_metrics, score_frame, top_fraction


def _frame(drift: float, n: int = 330, phase: float = 0.0) -> pd.DataFrame:
    noise = 0.003 * np.sin(np.arange(n) * 0.8 + phase)
    close = 100.0 * np.exp(np.cumsum(drift + noise))
    return pd.DataFrame(
        {
            "open": close * 0.999,
            "high": close * 1.006,
            "low": close * 0.994,
            "close": close,
            "volume": 200_000,
        },
        index=pd.bdate_range("2019-01-01", periods=n),
    )


def test_momentum_metrics_returns_and_ratio():
    frame = _frame(0.0008)
    date = frame.index[300]
    config = {"momentum": {"short_window": 126, "long_window": 252}}
    result = momentum_metrics(frame, date, config)
    expected_6m = frame["close"].iloc[300] / frame["close"].iloc[300 - 126] - 1
    expected_12m = frame["close"].iloc[300] / frame["close"].iloc[300 - 252] - 1
    assert result["return_6m"] == pytest.approx(expected_6m)
    assert result["return_12m"] == pytest.approx(expected_12m)
    assert result["volatility_6m"] > 0
    assert result["momentum_6m"] == pytest.approx(
        result["return_6m"] / result["volatility_6m"]
    )
    assert result["momentum_12m"] == pytest.approx(
        result["return_12m"] / result["volatility_12m"]
    )


def test_momentum_insufficient_history_returns_nan():
    frame = _frame(0.001, n=120)
    result = momentum_metrics(frame, frame.index[-1], {"momentum": {}})
    assert np.isnan(result["return_12m"])
    assert np.isnan(result["momentum_12m"])


def test_cross_sectional_ranking_and_weighted_score():
    data = {
        "A": _frame(0.0016, phase=0.0),
        "B": _frame(0.0012, phase=1.0),
        "C": _frame(0.0008, phase=2.0),
        "D": _frame(0.0004, phase=3.0),
        "E": _frame(0.0001, phase=4.0),
    }
    date = next(iter(data.values())).index[300]
    config = {
        "momentum": {
            "short_window": 126,
            "long_window": 252,
            "vol_window_short": 126,
            "vol_window_long": 252,
            "rank_weight_6m": 0.6,
            "rank_weight_12m": 0.4,
        },
        "backtest": {"periods_per_year": 252},
    }
    scores = score_frame(data, list(data), date, config)
    assert len(scores) == 5
    expected_rank_6 = scores["momentum_6m"].rank(pct=True)
    expected_rank_12 = scores["momentum_12m"].rank(pct=True)
    pd.testing.assert_series_equal(scores["rank_6m"].reset_index(drop=True), expected_rank_6.reset_index(drop=True), check_names=False)
    pd.testing.assert_series_equal(scores["rank_12m"].reset_index(drop=True), expected_rank_12.reset_index(drop=True), check_names=False)
    assert scores["score"].iloc[0] == pytest.approx(1.0)
    assert scores["score"].iloc[-1] == pytest.approx(0.2)
    for _, row in scores.iterrows():
        assert row["score"] == pytest.approx(
            0.6 * row["rank_6m"] + 0.4 * row["rank_12m"]
        )
    top = top_fraction(scores, 0.20)
    assert len(top) == 1
    assert top.iloc[0]["symbol"] == scores.iloc[0]["symbol"]


def test_ranking_excludes_negative_momentum_when_required():
    data = {
        "UP": _frame(0.001),
        "DOWN": _frame(-0.001),
        "FLAT": _frame(0.0),
    }
    date = next(iter(data.values())).index[300]
    config = {"momentum": {"require_positive_momentum": True}, "backtest": {}}
    scores = score_frame(data, list(data), date, config)
    assert "DOWN" not in set(scores["symbol"])
    config["momentum"]["require_positive_momentum"] = False
    scores_all = score_frame(data, list(data), date, config)
    assert set(scores_all["symbol"]) == {"UP", "DOWN", "FLAT"}


def test_annualized_volatility_scales_daily_std():
    returns = pd.Series([0.01, -0.01] * 100)
    close = 100 * (1 + returns).cumprod()
    vol = annualized_volatility(close, 20)
    expected = returns.iloc[-20:].std(ddof=0) * np.sqrt(252)
    assert vol.iloc[-1] == pytest.approx(expected)
