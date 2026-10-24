from __future__ import annotations

import pytest

from src.costs import CostModel

COSTS = {
    "brokerage_bps": 10.0,
    "brokerage_flat": 20.0,
    "stt_buy_bps": 0.0,
    "stt_sell_bps": 100.0,
    "exchange_bps": 2.0,
    "sebi_bps": 1.0,
    "gst_pct": 0.18,
    "stamp_duty_buy_bps": 5.0,
    "slippage_bps": 10.0,
    "spread_bps": 4.0,
}


def test_fill_price_applies_slippage_and_half_spread():
    model = CostModel(COSTS)
    assert model.fill_price("buy", 100.0) == pytest.approx(100.12)
    assert model.fill_price("sell", 100.0) == pytest.approx(99.88)
    assert model.impact_cost(100.0, 10) == pytest.approx(1.2)


def test_charges_buy_and_sell_breakdown():
    model = CostModel(COSTS)
    buy = model.charges("buy", 100.0, 10)
    assert buy.brokerage == pytest.approx(21.0)
    assert buy.stt == pytest.approx(0.0)
    assert buy.exchange == pytest.approx(0.2)
    assert buy.sebi == pytest.approx(0.1)
    assert buy.gst == pytest.approx((21.0 + 0.2 + 0.1) * 0.18)
    assert buy.stamp_duty == pytest.approx(0.5)
    assert buy.total == pytest.approx(25.634)

    sell = model.charges("sell", 100.0, 10)
    assert sell.brokerage == pytest.approx(21.0)
    assert sell.stt == pytest.approx(10.0)
    assert sell.stamp_duty == pytest.approx(0.0)
    assert sell.total == pytest.approx(35.134)


def test_round_trip_cost_includes_explicit_and_impact():
    model = CostModel(COSTS)
    total = model.round_trip_cost(100.0, 100.0, 10)
    assert total == pytest.approx(25.634 + 35.134 + 1.2 + 1.2)


def test_invalid_side_raises():
    model = CostModel(COSTS)
    with pytest.raises(ValueError):
        model.fill_price("hold", 100.0)
    with pytest.raises(ValueError):
        model.charges("hold", 100.0, 10)
