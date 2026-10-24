from __future__ import annotations

import pytest

from src.risk import compute_stop, size_position


def _config(**risk_overrides):
    risk = {
        "risk_per_trade_pct": 0.005,
        "max_positions": 5,
        "max_position_pct": 0.20,
        "max_portfolio_risk_pct": 0.03,
        "min_quantity": 1,
    }
    risk.update(risk_overrides)
    return {
        "risk": risk,
        "universe": {"max_positions_per_sector": 2},
    }


def test_stop_is_min_of_swing_low_and_atr_stop():
    plan = compute_stop(100.0, 95.0, 5.0, atr_mult=2.0, max_stop_distance_pct=0.08)
    assert plan.stop_price == pytest.approx(90.0)
    assert plan.distance_pct == pytest.approx(0.10)
    assert not plan.valid
    assert plan.reason == "stop_distance_too_wide"

    plan = compute_stop(100.0, 94.0, 2.0, atr_mult=2.0, max_stop_distance_pct=0.08)
    assert plan.stop_price == pytest.approx(94.0)
    assert plan.valid


def test_stop_rejects_missing_or_invalid_inputs():
    assert not compute_stop(100.0, 95.0, float("nan")).valid
    assert compute_stop(100.0, 95.0, float("nan")).reason == "missing_atr_or_swing_low"
    assert not compute_stop(0.0, 95.0, 2.0).valid
    assert compute_stop(0.0, 95.0, 2.0).reason == "invalid_entry_price"


def test_position_sizing_uses_half_percent_risk():
    result = size_position(
        equity=1_000_000,
        entry_price=100,
        stop_price=90,
        config=_config(),
        cash=1_000_000,
        open_positions=0,
        sector_positions=0,
        portfolio_risk_amount=0,
    )
    assert result.valid
    assert result.quantity == 500
    assert result.risk_amount == pytest.approx(5_000)
    assert result.position_value == pytest.approx(50_000)
    assert result.binding_constraint == "risk_per_trade"


def test_position_sizing_caps_at_twenty_percent_equity():
    result = size_position(
        equity=1_000_000,
        entry_price=100,
        stop_price=99,
        config=_config(),
        cash=1_000_000,
        open_positions=0,
        sector_positions=0,
        portfolio_risk_amount=0,
    )
    assert result.quantity == 2_000
    assert result.position_value == pytest.approx(200_000)
    assert result.binding_constraint == "max_position_pct"


def test_position_sizing_respects_cash_and_no_leverage():
    result = size_position(
        equity=1_000_000,
        entry_price=100,
        stop_price=90,
        config=_config(),
        cash=5_000,
        open_positions=0,
        sector_positions=0,
        portfolio_risk_amount=0,
    )
    assert result.quantity == 50
    assert result.position_value <= 5_000
    assert result.binding_constraint == "cash"


def test_position_sizing_portfolio_and_count_limits():
    rejected = size_position(
        equity=1_000_000,
        entry_price=100,
        stop_price=90,
        config=_config(),
        cash=1_000_000,
        open_positions=5,
        sector_positions=0,
        portfolio_risk_amount=0,
    )
    assert not rejected.valid
    assert "max_positions" in rejected.reasons

    sector_rejected = size_position(
        equity=1_000_000,
        entry_price=100,
        stop_price=90,
        config=_config(),
        cash=1_000_000,
        open_positions=0,
        sector_positions=2,
        portfolio_risk_amount=0,
    )
    assert not sector_rejected.valid
    assert "max_sector_positions" in sector_rejected.reasons

    risk_rejected = size_position(
        equity=1_000_000,
        entry_price=100,
        stop_price=90,
        config=_config(),
        cash=1_000_000,
        open_positions=0,
        sector_positions=0,
        portfolio_risk_amount=29_999,
    )
    assert not risk_rejected.valid
    assert "max_portfolio_risk" in risk_rejected.reasons


def test_position_sizing_rejects_invalid_stop_and_zero_cash():
    invalid_stop = size_position(
        equity=1_000_000,
        entry_price=100,
        stop_price=100,
        config=_config(),
        cash=1_000_000,
        open_positions=0,
        sector_positions=0,
        portfolio_risk_amount=0,
    )
    assert not invalid_stop.valid
    assert "invalid_stop" in invalid_stop.reasons

    no_cash = size_position(
        equity=1_000_000,
        entry_price=100,
        stop_price=90,
        config=_config(),
        cash=0,
        open_positions=0,
        sector_positions=0,
        portfolio_risk_amount=0,
    )
    assert not no_cash.valid
