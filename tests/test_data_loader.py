from __future__ import annotations

import sqlite3

import numpy as np
import pandas as pd
import pytest

from conftest import make_config
from src.data_loader import DataBundle, load_data, save_bundle


def _frame(symbol: str, n: int = 40, adj: bool = False) -> pd.DataFrame:
    dates = pd.bdate_range("2020-01-01", periods=n)
    close = 100.0 + np.arange(n)
    frame = pd.DataFrame(
        {
            "date": dates,
            "open": close - 0.5,
            "high": close + 1.0,
            "low": close - 1.0,
            "close": close,
            "volume": np.full(n, 200_000),
        }
    )
    if adj:
        frame["adj_close"] = frame["close"] * 0.5
    frame["symbol"] = symbol
    return frame


def _write_csv_dir(path, adj: bool = False) -> None:
    path.mkdir(parents=True, exist_ok=True)
    _frame("NIFTY50").drop(columns="symbol").to_csv(path / "NIFTY50.csv", index=False)
    _frame("AAA", adj=adj).drop(columns="symbol").to_csv(path / "AAA.csv", index=False)
    pd.DataFrame([{"symbol": "AAA", "sector": "Tech"}]).to_csv(path / "sectors.csv", index=False)


def test_csv_provider_and_adjusted_close(tmp_path):
    directory = tmp_path / "csvdata"
    _write_csv_dir(directory, adj=True)
    config = make_config(
        data={"provider": "csv", "path": str(directory), "benchmark_symbol": "NIFTY50"}
    )
    config["universe"]["sector_file"] = str(directory / "sectors.csv")
    bundle = load_data(config)
    assert set(bundle.data) == {"AAA"}
    assert bundle.sectors["AAA"] == "Tech"
    assert bundle.benchmark["close"].iloc[0] == pytest.approx(100.0)
    assert bundle.data["AAA"]["close"].iloc[0] == pytest.approx(50.0)
    assert bundle.data["AAA"]["open"].iloc[0] == pytest.approx(49.75)


def test_long_csv_provider(tmp_path):
    directory = tmp_path / "long"
    directory.mkdir()
    frame = pd.concat([_frame("NIFTY50"), _frame("AAA")], ignore_index=True)
    frame.to_csv(directory / "all.csv", index=False)
    config = make_config(
        data={"provider": "csv", "path": str(directory / "all.csv"), "benchmark_symbol": "NIFTY50"}
    )
    bundle = load_data(config)
    assert set(bundle.data) == {"AAA"}
    assert len(bundle.benchmark) == 40


def test_sqlite_provider(tmp_path):
    path = tmp_path / "market.db"
    frame = pd.concat([_frame("NIFTY50"), _frame("AAA")], ignore_index=True)
    frame["date"] = pd.to_datetime(frame["date"]).dt.strftime("%Y-%m-%d")
    with sqlite3.connect(path) as connection:
        frame.to_sql("ohlcv", connection, index=False, if_exists="replace")
    config = make_config(
        data={"provider": "sqlite", "path": str(path), "benchmark_symbol": "NIFTY50"}
    )
    bundle = load_data(config)
    assert set(bundle.data) == {"AAA"}
    assert len(bundle.benchmark) == 40


def test_parquet_provider(tmp_path):
    pytest.importorskip("pyarrow")
    directory = tmp_path / "parquet"
    directory.mkdir()
    _frame("NIFTY50").drop(columns="symbol").to_parquet(directory / "NIFTY50.parquet", index=False)
    _frame("AAA").drop(columns="symbol").to_parquet(directory / "AAA.parquet", index=False)
    config = make_config(
        data={"provider": "parquet", "path": str(directory), "benchmark_symbol": "NIFTY50"}
    )
    bundle = load_data(config)
    assert set(bundle.data) == {"AAA"}


def test_missing_benchmark_raises(tmp_path):
    directory = tmp_path / "nobench"
    directory.mkdir()
    _frame("AAA").drop(columns="symbol").to_csv(directory / "AAA.csv", index=False)
    config = make_config(
        data={"provider": "csv", "path": str(directory), "benchmark_symbol": "NIFTY50"}
    )
    with pytest.raises(ValueError, match="Benchmark"):
        load_data(config)


def test_save_bundle_round_trip(tmp_path):
    source = tmp_path / "source"
    _write_csv_dir(source)
    config = make_config(
        data={"provider": "csv", "path": str(source), "benchmark_symbol": "NIFTY50"}
    )
    config["universe"]["sector_file"] = str(source / "sectors.csv")
    bundle = load_data(config)
    output = tmp_path / "saved"
    save_bundle(bundle, output)
    assert (output / "NIFTY50.csv").exists()
    assert (output / "AAA.csv").exists()
    assert (output / "sectors.csv").exists()
    assert (output / "manifest.json").exists()
