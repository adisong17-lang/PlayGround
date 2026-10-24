from __future__ import annotations

import pandas as pd
import pytest

from src.portfolio import Portfolio


def _open(portfolio: Portfolio, **overrides):
    values = dict(
        symbol="AAA",
        sector="Tech",
        signal_date=pd.Timestamp("2020-01-01"),
        entry_date=pd.Timestamp("2020-01-02"),
        entry_price=100.0,
        signal_close=99.0,
        quantity=100,
        initial_stop=90.0,
        atr_at_entry=2.0,
        entry_charges=10.0,
        entry_impact=1.0,
        entry_regime="bull",
    )
    values.update(overrides)
    return portfolio.open_position(**values)


def test_open_and_close_position_accounts_for_costs():
    portfolio = Portfolio(100_000)
    position = _open(portfolio)
    assert portfolio.cash == pytest.approx(100_000 - 10_000 - 10)
    assert portfolio.equity() == pytest.approx(99_990)
    assert position.initial_risk_amount == pytest.approx(1_000)

    trade = portfolio.close_position(
        "AAA",
        exit_date=pd.Timestamp("2020-02-01"),
        exit_price=110.0,
        exit_reason="target",
        exit_charges=10.0,
        exit_impact=1.0,
    )
    assert portfolio.cash == pytest.approx(100_980)
    assert trade.pnl == pytest.approx(980)
    assert trade.total_costs == pytest.approx(22)
    assert trade.r_multiple == pytest.approx(0.98)
    assert portfolio.closed_trades == [trade]


def test_no_averaging_down_and_no_leverage():
    portfolio = Portfolio(10_000)
    _open(portfolio, quantity=10)
    with pytest.raises(ValueError):
        _open(portfolio, quantity=10)
    with pytest.raises(ValueError):
        _open(portfolio, symbol="BBB", quantity=10_000)


def test_mark_updates_holding_and_trailing_stop():
    portfolio = Portfolio(100_000)
    position = _open(portfolio)
    portfolio.mark(pd.Timestamp("2020-01-02"), {"AAA": 110.0}, {"AAA": 2.0}, trailing_atr_mult=2.5)
    assert position.holding_sessions == 1
    assert position.highest_close == 110.0
    assert position.stop_price == pytest.approx(105.0)

    portfolio.mark(pd.Timestamp("2020-01-03"), {"AAA": 104.0}, {"AAA": 2.0}, trailing_atr_mult=2.5)
    assert position.holding_sessions == 2
    assert position.highest_close == 110.0
    assert position.stop_price == pytest.approx(105.0)

    portfolio.record_day(pd.Timestamp("2020-01-03"), {"AAA": 104.0})
    row = portfolio.daily_rows[-1]
    assert row["market_value"] == pytest.approx(10_400)
    assert row["exposure"] == pytest.approx(10_400 / portfolio.equity({"AAA": 104.0}))


def test_sector_count_and_open_risk():
    portfolio = Portfolio(100_000)
    _open(portfolio, symbol="AAA", sector="Tech")
    _open(portfolio, symbol="BBB", sector="Tech", entry_price=50.0, initial_stop=45.0)
    assert portfolio.sector_count("Tech") == 2
    assert portfolio.open_risk() == pytest.approx(1_000 + 500)
