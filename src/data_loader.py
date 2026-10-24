"""Data providers and in-memory data bundle.

Supported sources
-----------------
* CSV, either one file per symbol or one long file (date, symbol, OHLCV).
* Parquet, with the same directory/long-file conventions.
* SQLite, one long ``ohlcv`` table.
* yfinance (optional dependency, network required).
* Deterministic synthetic scenarios (used for the bundled examples).

Adjusted prices are expected. If an ``adj_close`` column is supplied, OHLC
prices are scaled by ``adj_close / close`` so splits and dividends do not create
phantom gaps. yfinance is downloaded with ``auto_adjust=True``.
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable, Mapping

import numpy as np
import pandas as pd
import yaml

from .indicators import OHLCV_COLUMNS, ensure_ohlcv

METADATA_FILES = {"sectors.csv", "universe_history.csv", "manifest.json"}
BENCHMARK_ALIASES = {"NIFTY50": "^NSEI", "NIFTY_50": "^NSEI", "NIFTY": "^NSEI"}


@dataclass
class DataBundle:
    data: dict[str, pd.DataFrame]
    benchmark: pd.DataFrame
    sectors: dict[str, str] = field(default_factory=dict)
    membership: pd.DataFrame | None = None
    source: str = "unknown"
    metadata: dict[str, Any] = field(default_factory=dict)

    def symbols(self) -> list[str]:
        return sorted(self.data)

    def trading_dates(self) -> pd.DatetimeIndex:
        dates = self.benchmark.index
        for df in self.data.values():
            dates = dates.union(df.index)
        return pd.DatetimeIndex(dates).sort_values()

    def bench_dates(self) -> pd.DatetimeIndex:
        return pd.DatetimeIndex(self.benchmark.index).sort_values()

    def slice(self, start: str | None = None, end: str | None = None) -> "DataBundle":
        if start is None and end is None:
            return self
        start_ts = pd.Timestamp(start) if start else None
        end_ts = pd.Timestamp(end) if end else None

        def cut(df: pd.DataFrame) -> pd.DataFrame:
            out = df
            if start_ts is not None:
                out = out.loc[out.index >= start_ts]
            if end_ts is not None:
                out = out.loc[out.index <= end_ts]
            return out

        data = {s: cut(df) for s, df in self.data.items() if len(cut(df)) > 0}
        benchmark = cut(self.benchmark)
        if len(benchmark) == 0:
            raise ValueError("Benchmark has no observations in the requested date range")
        return DataBundle(
            data=data,
            benchmark=benchmark,
            sectors=dict(self.sectors),
            membership=self.membership,
            source=self.source,
            metadata=dict(self.metadata),
        )


def load_config(path: str | Path) -> dict[str, Any]:
    with open(path, "r", encoding="utf-8") as handle:
        cfg = yaml.safe_load(handle) or {}
    if not isinstance(cfg, dict):
        raise ValueError(f"Config {path} must contain a YAML mapping")
    return cfg


def _apply_adjustments(df: pd.DataFrame) -> pd.DataFrame:
    if "adj_close" not in df.columns:
        return df
    out = df.copy()
    adj = pd.to_numeric(out["adj_close"], errors="coerce")
    factor = (adj / out["close"]).replace([np.inf, -np.inf], np.nan)
    valid = factor.notna() & (factor > 0)
    for col in ("open", "high", "low"):
        out.loc[valid, col] = out.loc[valid, col] * factor[valid]
    out.loc[valid, "close"] = adj[valid]
    out = out.drop(columns=["adj_close"])
    return out


def _split_long_frame(frame: pd.DataFrame) -> dict[str, pd.DataFrame]:
    frame = frame.copy()
    frame.columns = [str(c).strip().lower() for c in frame.columns]
    if "symbol" not in frame.columns:
        raise ValueError("Long OHLCV data must contain a 'symbol' column")
    if "date" not in frame.columns:
        raise ValueError("Long OHLCV data must contain a 'date' column")
    result: dict[str, pd.DataFrame] = {}
    for symbol, group in frame.groupby("symbol", sort=True):
        group = group.drop(columns=["symbol"])
        result[str(symbol).strip()] = _apply_adjustments(ensure_ohlcv(group, str(symbol)))
    return result


def _read_csv_source(path: Path) -> tuple[dict[str, pd.DataFrame], pd.DataFrame | None]:
    if path.is_dir():
        files = sorted(p for p in path.glob("*.csv") if p.name.lower() not in METADATA_FILES)
        if not files:
            raise FileNotFoundError(f"No CSV files found in {path}")
        data: dict[str, pd.DataFrame] = {}
        metadata = None
        for file in files:
            raw = pd.read_csv(file)
            raw.columns = [str(c).strip().lower() for c in raw.columns]
            if "symbol" in raw.columns:
                metadata = _split_long_frame(raw)
            else:
                data[file.stem] = _apply_adjustments(ensure_ohlcv(raw, file.stem))
        if metadata is not None:
            data.update(metadata)
        return data, None

    raw = pd.read_csv(path)
    raw.columns = [str(c).strip().lower() for c in raw.columns]
    if "symbol" in raw.columns:
        return _split_long_frame(raw), None
    symbol = path.stem
    return {symbol: _apply_adjustments(ensure_ohlcv(raw, symbol))}, None


def _read_parquet_source(path: Path, engine: str | None = None) -> dict[str, pd.DataFrame]:
    data: dict[str, pd.DataFrame] = {}
    if path.is_dir():
        files = sorted(p for p in path.glob("*.parquet"))
        if not files:
            raise FileNotFoundError(f"No Parquet files found in {path}")
        for file in files:
            frame = pd.read_parquet(file, engine=engine)
            frame.columns = [str(c).strip().lower() for c in frame.columns]
            if "symbol" in frame.columns:
                data.update(_split_long_frame(frame))
            else:
                data[file.stem] = _apply_adjustments(ensure_ohlcv(frame, file.stem))
        return data

    frame = pd.read_parquet(path, engine=engine)
    frame.columns = [str(c).strip().lower() for c in frame.columns]
    if "symbol" in frame.columns:
        return _split_long_frame(frame)
    return {path.stem: _apply_adjustments(ensure_ohlcv(frame, path.stem))}


def _read_sqlite_source(path: Path, table: str = "ohlcv") -> dict[str, pd.DataFrame]:
    if not path.exists():
        raise FileNotFoundError(path)
    with sqlite3.connect(path) as connection:
        frame = pd.read_sql_query(f"SELECT * FROM {table}", connection)
    frame.columns = [str(c).strip().lower() for c in frame.columns]
    if "symbol" not in frame.columns:
        raise ValueError("SQLite table must contain date, symbol and OHLCV columns")
    return _split_long_frame(frame)


def _read_yfinance(config: Mapping[str, Any], symbols: Iterable[str] | None) -> dict[str, pd.DataFrame]:
    try:
        import yfinance as yf  # type: ignore
    except ImportError as exc:  # pragma: no cover - optional dependency
        raise ImportError("Install yfinance to use the yfinance provider") from exc

    data_cfg = config.get("data", {})
    tickers = list(symbols or data_cfg.get("yfinance_symbols") or [])
    benchmark = data_cfg.get("benchmark_symbol", "NIFTY50")
    if not tickers:
        raise ValueError(
            "The yfinance provider needs data.yfinance_symbols or an explicit symbol list"
        )
    bench_ticker = data_cfg.get("yfinance_benchmark", BENCHMARK_ALIASES.get(benchmark, benchmark))
    all_tickers = list(dict.fromkeys([*tickers, bench_ticker]))
    start = data_cfg.get("start")
    end = data_cfg.get("end")

    downloaded = yf.download(
        all_tickers,
        start=start,
        end=end,
        auto_adjust=bool(data_cfg.get("auto_adjust", True)),
        group_by="ticker",
        progress=False,
        threads=True,
    )
    result: dict[str, pd.DataFrame] = {}
    for ticker in all_tickers:
        try:
            frame = downloaded[ticker] if isinstance(downloaded.columns, pd.MultiIndex) else downloaded
        except KeyError:
            continue
        if frame is None or frame.dropna(how="all").empty:
            continue
        frame = frame.rename(columns=str.lower)
        if "adj close" in frame.columns:
            frame = frame.rename(columns={"adj close": "adj_close"})
        symbol = benchmark if ticker == bench_ticker else ticker
        result[symbol] = _apply_adjustments(ensure_ohlcv(frame, symbol))
    if benchmark not in result:
        raise ValueError(f"Could not download benchmark {bench_ticker}")
    return result


def _load_sectors(path: str | Path | None) -> dict[str, str]:
    if not path:
        return {}
    path = Path(path)
    if not path.exists():
        return {}
    frame = pd.read_csv(path)
    frame.columns = [str(c).strip().lower() for c in frame.columns]
    required = {"symbol", "sector"}
    if not required.issubset(frame.columns):
        raise ValueError(f"{path} must contain symbol and sector columns")
    return {
        str(row.symbol).strip(): str(row.sector).strip()
        for row in frame[["symbol", "sector"]].dropna().itertuples(index=False)
    }


def _load_membership(path: str | Path | None) -> pd.DataFrame | None:
    if not path:
        return None
    path = Path(path)
    if not path.exists():
        return None
    frame = pd.read_csv(path)
    frame.columns = [str(c).strip().lower() for c in frame.columns]
    if "symbol" not in frame.columns:
        raise ValueError(f"{path} must contain a symbol column")
    if "date" not in frame.columns:
        frame["date"] = pd.Timestamp("1900-01-01")
    frame["date"] = pd.to_datetime(frame["date"], errors="coerce")
    frame["symbol"] = frame["symbol"].astype(str).str.strip()
    frame = frame.dropna(subset=["date", "symbol"])
    return frame[["date", "symbol"]].drop_duplicates().sort_values(["date", "symbol"])


def _attach_metadata(
    data: dict[str, pd.DataFrame],
    config: Mapping[str, Any],
    source: str,
    metadata: dict[str, Any] | None = None,
) -> DataBundle:
    benchmark_symbol = str(config.get("data", {}).get("benchmark_symbol", "NIFTY50"))
    benchmark = data.pop(benchmark_symbol, None)
    if benchmark is None:
        for key in list(data):
            if key.upper() in BENCHMARK_ALIASES or key.upper().replace(" ", "") == benchmark_symbol:
                benchmark = data.pop(key)
                break
    if benchmark is None:
        raise ValueError(
            f"Benchmark {benchmark_symbol!r} was not found in the data source. "
            "Provide <benchmark>.csv / a long-format row with that symbol."
        )

    sectors = _load_sectors(config.get("universe", {}).get("sector_file"))
    if not sectors:
        sectors = {symbol: "UNKNOWN" for symbol in data}

    membership = _load_membership(config.get("universe", {}).get("membership_file"))
    if membership is not None:
        known = set(membership["symbol"])
        data = {symbol: df for symbol, df in data.items() if symbol in known}

    return DataBundle(
        data=data,
        benchmark=benchmark,
        sectors=sectors,
        membership=membership,
        source=source,
        metadata=dict(metadata or {}),
    )


def load_data(
    config: Mapping[str, Any],
    *,
    provider: str | None = None,
    path: str | Path | None = None,
    scenario: str | None = None,
    symbols: Iterable[str] | None = None,
) -> DataBundle:
    """Load an OHLCV bundle using the configured provider."""
    data_cfg = dict(config.get("data", {}))
    provider = (provider or data_cfg.get("provider", "csv")).lower()
    source_path = Path(path or data_cfg.get("path", "data/synthetic/clean_uptrend"))
    metadata: dict[str, Any] = {}

    if provider == "csv":
        data, _ = _read_csv_source(source_path)
        source = f"csv:{source_path}"
    elif provider == "parquet":
        data = _read_parquet_source(source_path, data_cfg.get("parquet_engine"))
        source = f"parquet:{source_path}"
    elif provider == "sqlite":
        data = _read_sqlite_source(source_path, data_cfg.get("sqlite_table", "ohlcv"))
        source = f"sqlite:{source_path}"
    elif provider == "yfinance":
        data = _read_yfinance(config, symbols)
        source = "yfinance"
    elif provider == "synthetic":
        from .synthetic import generate_scenario

        bundle = generate_scenario(scenario or data_cfg.get("scenario", "clean_uptrend"))
        bundle = bundle.slice(data_cfg.get("start"), data_cfg.get("end"))
        return bundle
    else:
        raise ValueError(f"Unsupported data provider: {provider}")

    bundle = _attach_metadata(data, config, source, metadata)
    return bundle.slice(data_cfg.get("start"), data_cfg.get("end"))


def save_bundle(bundle: DataBundle, output_dir: str | Path) -> None:
    """Persist a bundle as one CSV per symbol plus metadata (for examples/tests)."""
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)
    for symbol, frame in bundle.data.items():
        frame.to_csv(out / f"{symbol}.csv", index_label="date")
    benchmark_symbol = bundle.metadata.get("benchmark_symbol", "NIFTY50")
    bundle.benchmark.to_csv(out / f"{benchmark_symbol}.csv", index_label="date")
    if bundle.sectors:
        pd.DataFrame(
            sorted(bundle.sectors.items()), columns=["symbol", "sector"]
        ).to_csv(out / "sectors.csv", index=False)
    if bundle.membership is not None:
        bundle.membership.to_csv(out / "universe_history.csv", index=False)
    (out / "manifest.json").write_text(
        json.dumps({"source": bundle.source, **bundle.metadata}, indent=2),
        encoding="utf-8",
    )


def configure_cli_data(
    config: dict[str, Any],
    *,
    provider: str | None = None,
    data_path: str | Path | None = None,
    scenario: str | None = None,
) -> dict[str, Any]:
    """Apply command-line data overrides consistently for both CLIs.

    A bare ``--scenario`` uses the in-memory synthetic provider. If a directory
    is supplied, its sectors.csv / universe_history.csv files are picked up
    automatically so saved synthetic scenarios remain self-contained.
    """
    data_cfg = config.setdefault("data", {})
    if provider:
        data_cfg["provider"] = provider
    if scenario:
        data_cfg["scenario"] = scenario
        if data_path is None and provider is None:
            data_cfg["provider"] = "synthetic"
        elif provider is not None and provider != "synthetic" and data_path is None:
            candidate = Path("data/synthetic") / scenario
            if candidate.is_dir():
                data_path = candidate

    if data_path is not None:
        path = Path(data_path)
        if scenario and (path / scenario).is_dir():
            path = path / scenario
        data_cfg["path"] = str(path)
        if provider is None:
            data_cfg["provider"] = "csv"
        sectors = path / "sectors.csv"
        membership = path / "universe_history.csv"
        universe_cfg = config.setdefault("universe", {})
        universe_cfg["sector_file"] = str(sectors) if sectors.exists() else None
        universe_cfg["membership_file"] = str(membership) if membership.exists() else None
    return config
