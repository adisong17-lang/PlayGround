from __future__ import annotations

import copy
from typing import Iterable

import numpy as np
import pandas as pd
import pytest

from src.data_loader import DataBundle, load_config


def make_config(**overrides) -> dict:
    config = copy.deepcopy(load_config("config.yaml"))
    config["universe"].update(
        {
            "min_price": 1.0,
            "min_avg_volume": 1_000,
            "min_avg_turnover": 1_000,
            "min_history": 250,
            "liquidity_lookback": 20,
            "limit_move_threshold": 0.5,
            "max_limit_move_fraction": 1.0,
            "membership_file": None,
            "sector_file": None,
            "top_momentum_pct": 0.20,
            "top_sector_pct": 0.30,
            "max_positions": 5,
            "max_positions_per_sector": 2,
        }
    )
    config["sector"].update({"min_members": 2})
    config["costs"].update(
        {
            "brokerage_bps": 0.0,
            "brokerage_flat": 0.0,
            "stt_buy_bps": 0.0,
            "stt_sell_bps": 0.0,
            "exchange_bps": 0.0,
            "sebi_bps": 0.0,
            "gst_pct": 0.0,
            "stamp_duty_buy_bps": 0.0,
            "slippage_bps": 0.0,
            "spread_bps": 0.0,
        }
    )
    config["backtest"].update({"initial_capital": 1_000_000, "close_positions_at_end": True})
    for section, values in overrides.items():
        if isinstance(values, dict):
            config.setdefault(section, {}).update(values)
        else:
            config[section] = values
    return config


def _ohlcv_from_close(
    close: np.ndarray,
    dates: pd.DatetimeIndex,
    *,
    base_volume: float = 250_000.0,
) -> pd.DataFrame:
    n = len(close)
    open_ = np.empty(n)
    open_[0] = close[0]
    open_[1:] = close[:-1] * 1.0005
    high = np.maximum(open_, close) * 1.004
    low = np.minimum(open_, close) * 0.996
    volume = np.full(n, base_volume)
    return pd.DataFrame(
        {"open": open_, "high": high, "low": low, "close": close, "volume": volume},
        index=dates,
    )


def make_signal_bundle(
    *,
    sessions: int = 330,
    event_index: int = 300,
    signal_symbols: Iterable[str] = ("A1",),
    next_open_factor: float | None = None,
    gap_after_entry_pct: float | None = None,
    drop_row: tuple[str, int] | None = None,
) -> tuple[DataBundle, dict, pd.DatetimeIndex]:
    """Build a six-stock, three-sector bundle with an engineered breakout."""
    dates = pd.bdate_range("2018-01-01", periods=sessions)
    signal_symbols = set(signal_symbols)
    benchmark_close = 20_000.0 * np.exp(np.arange(sessions) * 0.0005)
    benchmark = _ohlcv_from_close(benchmark_close, dates, base_volume=5e7)

    drift = {
        "A1": 0.0018,
        "A2": 0.0018,
        "B1": 0.0009,
        "B2": 0.0009,
        "C1": 0.0003,
        "C2": 0.0003,
    }
    sectors = {
        "A1": "Alpha",
        "A2": "Alpha",
        "B1": "Beta",
        "B2": "Beta",
        "C1": "Gamma",
        "C2": "Gamma",
    }
    data: dict[str, pd.DataFrame] = {}
    for position, (symbol, rate) in enumerate(drift.items()):
        phase = position * 0.9
        noise = 0.0025 * np.sin(np.arange(sessions) * 0.9 + phase)
        log_returns = rate + noise
        close = 100.0 * np.exp(np.cumsum(log_returns))
        if symbol in signal_symbols:
            for offset in (3, 2, 1):
                close[event_index - offset] = close[event_index - offset - 1] * 0.996
            event_close = close[event_index - 1] * 1.03
            close[event_index] = event_close
            for index in range(event_index + 1, sessions):
                close[index] = close[index - 1] * np.exp(log_returns[index])
        frame = _ohlcv_from_close(close, dates)
        if symbol in signal_symbols:
            previous_close = float(frame["close"].iloc[event_index - 1])
            event_close = float(frame["close"].iloc[event_index])
            frame.iloc[event_index, frame.columns.get_loc("open")] = previous_close * 1.005
            frame.iloc[event_index, frame.columns.get_loc("high")] = event_close * 1.002
            frame.iloc[event_index, frame.columns.get_loc("low")] = previous_close * 1.001
            frame.iloc[event_index, frame.columns.get_loc("close")] = event_close
            frame.iloc[event_index, frame.columns.get_loc("volume")] = 250_000 * 3.5
        data[symbol] = frame

    if next_open_factor is not None:
        for symbol in signal_symbols:
            frame = data[symbol]
            frame.iloc[event_index + 1, frame.columns.get_loc("open")] = (
                float(frame["close"].iloc[event_index]) * next_open_factor
            )
            frame.iloc[event_index + 1, frame.columns.get_loc("high")] = max(
                float(frame["open"].iloc[event_index + 1]),
                float(frame["close"].iloc[event_index + 1]),
            ) * 1.004
            frame.iloc[event_index + 1, frame.columns.get_loc("low")] = min(
                float(frame["open"].iloc[event_index + 1]),
                float(frame["close"].iloc[event_index + 1]),
            ) * 0.996

    if gap_after_entry_pct is not None:
        shock_index = event_index + 2
        for symbol in signal_symbols:
            frame = data[symbol]
            previous_close = float(frame["close"].iloc[shock_index - 1])
            open_ = previous_close * (1.0 + gap_after_entry_pct)
            close = open_ * 0.985
            frame.iloc[shock_index, frame.columns.get_loc("open")] = open_
            frame.iloc[shock_index, frame.columns.get_loc("close")] = close
            frame.iloc[shock_index, frame.columns.get_loc("high")] = open_ * 1.002
            frame.iloc[shock_index, frame.columns.get_loc("low")] = close * 0.998
            frame.iloc[shock_index, frame.columns.get_loc("volume")] = 900_000

    if drop_row is not None:
        symbol, index = drop_row
        data[symbol] = data[symbol].drop(data[symbol].index[index])

    bundle = DataBundle(
        data=data,
        benchmark=benchmark,
        sectors=sectors,
        membership=None,
        source="test",
        metadata={"benchmark_symbol": "NIFTY50"},
    )
    return bundle, make_config(), dates


@pytest.fixture
def signal_bundle():
    return make_signal_bundle()


def clone_bundle(bundle: DataBundle) -> DataBundle:
    return DataBundle(
        data={symbol: frame.copy() for symbol, frame in bundle.data.items()},
        benchmark=bundle.benchmark.copy(),
        sectors=dict(bundle.sectors),
        membership=bundle.membership.copy() if bundle.membership is not None else None,
        source=bundle.source,
        metadata=dict(bundle.metadata),
    )
