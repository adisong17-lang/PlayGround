from __future__ import annotations

from types import SimpleNamespace

import numpy as np
import pandas as pd
import pytest

from conftest import clone_bundle, make_config, make_signal_bundle
from src.backtest import run_backtest
from src.strategy import evaluate_exit
from src.universe import Universe


def test_entry_executes_at_next_open_not_signal_close():
    bundle, config, dates = make_signal_bundle()
    result = run_backtest(bundle, config)
    assert len(result.trades) == 1
    trade = result.trades.iloc[0]
    assert trade["symbol"] == "A1"
    assert pd.Timestamp(trade["signal_date"]) == dates[300]
    assert pd.Timestamp(trade["entry_date"]) == dates[301]
    expected_open = float(bundle.data["A1"].loc[dates[301], "open"])
    assert trade["entry_price"] == pytest.approx(expected_open)
    assert all(
        pd.Timestamp(row.entry_date) > pd.Timestamp(row.signal_date)
        for row in result.trades.itertuples()
    )


def test_gap_up_above_three_percent_is_rejected():
    bundle, config, _ = make_signal_bundle(next_open_factor=1.05)
    result = run_backtest(bundle, config)
    assert result.trades.empty
    assert "gap_up_above_limit" in set(result.rejections["reason"])


def test_gap_through_initial_stop_fills_at_gapped_open():
    bundle, config, dates = make_signal_bundle(gap_after_entry_pct=-0.15)
    result = run_backtest(bundle, config)
    assert len(result.trades) == 1
    trade = result.trades.iloc[0]
    assert trade["exit_reason"] == "gap_through_stop"
    assert pd.Timestamp(trade["exit_date"]) == dates[302]
    expected_open = float(bundle.data["A1"].loc[dates[302], "open"])
    assert trade["exit_price"] == pytest.approx(expected_open)
    assert trade["exit_price"] < trade["initial_stop"]


def test_max_holding_period_exits_at_next_open():
    bundle, config, dates = make_signal_bundle()
    config["strategy"]["max_holding_sessions"] = 3
    result = run_backtest(bundle, config)
    trade = result.trades.iloc[0]
    assert trade["exit_reason"] == "max_holding_period"
    assert int(trade["holding_sessions"]) == 3
    assert pd.Timestamp(trade["exit_date"]) == dates[304]


def test_portfolio_max_positions_and_sector_limits_are_enforced():
    bundle, config, _ = make_signal_bundle(signal_symbols=("A1", "A2"))
    config["risk"]["max_positions"] = 1
    result = run_backtest(bundle, config)
    assert len(result.trades) == 1
    assert result.equity_curve["open_positions"].max() <= 1
    assert "max_positions" in set(result.rejections["reason"])

    bundle, config, _ = make_signal_bundle(signal_symbols=("A1", "A2"))
    config["universe"]["max_positions_per_sector"] = 1
    result = run_backtest(bundle, config)
    assert len(result.trades) == 1
    assert result.equity_curve["open_positions"].max() <= 1
    assert "max_sector_positions" in set(result.rejections["reason"])


def test_exit_rules_close_below_low_ema_trailing_and_holding():
    config = {"strategy": {"ema_fast": 20, "exit_ema_days": 2, "max_holding_sessions": 30}}
    position = SimpleNamespace(stop_price=96.0, initial_stop=90.0, holding_sessions=1, below_ema_days=0)

    row = {"close": 94.0, "ema20": 100.0, "exit_low_prev": 95.0}
    assert evaluate_exit(position, row, config)[0] == "close_below_10day_low"

    position.below_ema_days = 2
    row = {"close": 95.0, "ema20": 100.0, "exit_low_prev": 90.0}
    assert evaluate_exit(position, row, config)[0] == "below_ema20_two_days"

    position.below_ema_days = 0
    row = {"close": 95.0, "ema20": 90.0, "exit_low_prev": 90.0}
    assert evaluate_exit(position, row, config)[0] == "atr_trailing_stop"

    position.stop_price = 80.0
    position.holding_sessions = 30
    row = {"close": 100.0, "ema20": 90.0, "exit_low_prev": 90.0}
    assert evaluate_exit(position, row, config)[0] == "max_holding_period"

    position.holding_sessions = 1
    row = {"close": 100.0, "ema20": 90.0, "exit_low_prev": 90.0}
    assert evaluate_exit(position, row, config)[0] == ""


def test_missing_data_on_signal_date_prevents_entry():
    bundle, config, dates = make_signal_bundle(drop_row=("A1", 300))
    universe = Universe(bundle, config)
    assert universe.check("A1", dates[300]).reason == "missing_data_on_date"
    result = run_backtest(bundle, config)
    assert result.trades.empty or "A1" not in set(result.trades["symbol"])


def test_no_lookahead_from_truncated_or_mutated_future_data():
    bundle, config, dates = make_signal_bundle()
    config["backtest"]["close_positions_at_end"] = False
    cutoff = dates[305]
    full = run_backtest(bundle, config)

    truncated = bundle.slice(end=cutoff)
    truncated_result = run_backtest(truncated, config)
    full_before = full.equity_curve.loc[full.equity_curve["date"] <= cutoff].reset_index(drop=True)
    truncated_equity = truncated_result.equity_curve.reset_index(drop=True)
    pd.testing.assert_series_equal(
        full_before["equity"], truncated_equity["equity"], check_names=False
    )

    mutated = clone_bundle(bundle)
    for frame in mutated.data.values():
        future = frame.index > cutoff
        frame.loc[future, ["open", "high", "low", "close"]] *= 0.4
    mutated_result = run_backtest(mutated, config)
    mutated_before = mutated_result.equity_curve.loc[
        mutated_result.equity_curve["date"] <= cutoff
    ].reset_index(drop=True)
    pd.testing.assert_series_equal(
        full_before["equity"], mutated_before["equity"], check_names=False
    )


def test_signal_uses_close_of_signal_day_only():
    bundle, config, dates = make_signal_bundle()
    result = run_backtest(bundle, config)
    signal_rows = result.signal_log.loc[result.signal_log["event"] == "entry_signal"]
    assert not signal_rows.empty
    assert pd.Timestamp(signal_rows.iloc[0]["date"]) == dates[300]
    assert result.trades.iloc[0]["signal_date"] == dates[300].date().isoformat()
