"""Deterministic synthetic OHLCV scenarios.

The generator is intentionally simple but produces realistic candles, volume
clustering, sector dispersion and, for some scenarios, engineered pullback
breakouts and gap-down shocks. It is used only for demonstrations and tests; it
is not a claim about real market behaviour.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from .data_loader import DataBundle, save_bundle
from .indicators import add_indicators, sma

SCENARIOS = (
    "clean_uptrend",
    "sideways_market",
    "false_breakout",
    "gap_down_stop",
    "multiple_signals",
    "losing_streak",
    "sector_concentration",
)

SECTOR_NAMES = ["Technology", "Financials", "Energy", "Healthcare", "Auto", "Consumer"]


@dataclass
class ScenarioSpec:
    market_drift: float
    market_vol: float
    sector_alpha: list[float]
    stock_idio_vol: float
    event_days: list[int]
    event_kind: str = "clean"
    shock_days: list[int] | None = None
    concentrate_sector: bool = False
    benchmark_wave: bool = False


SPECS: dict[str, ScenarioSpec] = {
    "clean_uptrend": ScenarioSpec(
        market_drift=0.00088,
        market_vol=0.0052,
        sector_alpha=[0.00055, 0.00044, 0.00030, 0.00008, -0.00010, -0.00028],
        stock_idio_vol=0.0105,
        event_days=[310, 355, 400, 445, 490, 535, 580, 625, 670, 715],
        event_kind="clean",
    ),
    "sideways_market": ScenarioSpec(
        market_drift=0.00001,
        market_vol=0.0105,
        sector_alpha=[0.00012, 0.00004, -0.00004, 0.00010, -0.00010, -0.00002],
        stock_idio_vol=0.0125,
        event_days=[],
        event_kind="clean",
        benchmark_wave=True,
    ),
    "false_breakout": ScenarioSpec(
        market_drift=0.00070,
        market_vol=0.0062,
        sector_alpha=[0.00045, 0.00030, 0.00018, 0.00002, -0.00012, -0.00025],
        stock_idio_vol=0.0115,
        event_days=[315, 370, 425, 480, 535, 590, 645, 700],
        event_kind="false_breakout",
    ),
    "gap_down_stop": ScenarioSpec(
        market_drift=0.00072,
        market_vol=0.0060,
        sector_alpha=[0.00048, 0.00036, 0.00022, 0.00004, -0.00012, -0.00026],
        stock_idio_vol=0.0110,
        event_days=[330, 390, 450, 510, 570, 630, 690],
        event_kind="gap_stop",
    ),
    "multiple_signals": ScenarioSpec(
        market_drift=0.00074,
        market_vol=0.0060,
        sector_alpha=[0.00050, 0.00038, 0.00026, 0.00008, -0.00008, -0.00022],
        stock_idio_vol=0.0100,
        event_days=[320, 470, 620],
        event_kind="broad",
    ),
    "losing_streak": ScenarioSpec(
        market_drift=0.00068,
        market_vol=0.0064,
        sector_alpha=[0.00040, 0.00028, 0.00016, 0.00000, -0.00014, -0.00028],
        stock_idio_vol=0.0120,
        event_days=[330, 365, 400, 435, 470, 505, 540, 575, 610, 645],
        event_kind="losing",
    ),
    "sector_concentration": ScenarioSpec(
        market_drift=0.00074,
        market_vol=0.0060,
        sector_alpha=[0.00110, 0.00020, 0.00012, 0.00002, -0.00014, -0.00026],
        stock_idio_vol=0.0105,
        event_days=[330, 420, 510, 600, 690],
        event_kind="concentrated",
    ),
}


def _generate_benchmark(
    rng: np.random.Generator,
    dates: pd.DatetimeIndex,
    spec: ScenarioSpec,
) -> pd.DataFrame:
    n = len(dates)
    drift = np.full(n, spec.market_drift)
    if spec.benchmark_wave:
        cycle = 0.00055 * np.sin(np.arange(n) / 18.0)
        drift = drift + cycle
        drift[n // 2 :] -= 0.00018
    returns = rng.normal(drift, spec.market_vol)
    close = 20000.0 * np.exp(np.cumsum(returns))
    gap = rng.normal(0.0, spec.market_vol * 0.18, n)
    open_ = np.empty(n)
    open_[0] = close[0] * (1.0 - gap[0])
    open_[1:] = close[:-1] * (1.0 + gap[1:])
    span = np.abs(rng.normal(0.0, spec.market_vol * 0.35, n))
    high = np.maximum(open_, close) * (1.0 + span)
    low = np.minimum(open_, close) * (1.0 - span)
    volume = rng.lognormal(mean=np.log(5e7), sigma=0.25, size=n)
    return pd.DataFrame(
        {"open": open_, "high": high, "low": low, "close": close, "volume": volume},
        index=dates,
    )


def _generate_stock(
    rng: np.random.Generator,
    dates: pd.DatetimeIndex,
    market_returns: np.ndarray,
    spec: ScenarioSpec,
    sector_index: int,
    stock_index: int,
) -> pd.DataFrame:
    n = len(dates)
    beta = rng.uniform(0.75, 1.25)
    sector_alpha = spec.sector_alpha[sector_index]
    stock_alpha = rng.normal(0.0, 0.00011)
    idio = rng.normal(0.0, spec.stock_idio_vol, n)
    returns = beta * market_returns + sector_alpha + stock_alpha + idio
    start_price = rng.uniform(80.0, 650.0)
    close = start_price * np.exp(np.cumsum(returns))
    gap = rng.normal(0.0, spec.stock_idio_vol * 0.20, n)
    open_ = np.empty(n)
    open_[0] = close[0] * (1.0 - gap[0])
    open_[1:] = close[:-1] * (1.0 + gap[1:])
    span = np.abs(rng.normal(0.0, spec.stock_idio_vol * 0.45, n))
    high = np.maximum(open_, close) * (1.0 + span)
    low = np.minimum(open_, close) * (1.0 - span)
    base_volume = rng.uniform(2.5e5, 1.8e6)
    volume = base_volume * rng.lognormal(mean=0.0, sigma=0.35, size=n)
    volume *= 1.0 + 2.5 * np.abs(returns)
    return pd.DataFrame(
        {"open": open_, "high": high, "low": low, "close": close, "volume": volume},
        index=dates,
    )


def _scale_future(df: pd.DataFrame, start: int, ratio: float) -> None:
    if start >= len(df) or ratio <= 0:
        return
    for column in ("open", "high", "low", "close"):
        df.iloc[start:, df.columns.get_loc(column)] *= ratio


def _inject_breakout(
    df: pd.DataFrame,
    index: int,
    rng: np.random.Generator,
    *,
    shock_next: str | None = None,
) -> None:
    """Create a pullback into the 20-EMA followed by a high-volume breakout."""
    if index < 265 or index >= len(df):
        return
    before = df.iloc[:index]
    enriched = add_indicators(before)
    last = enriched.iloc[-1]
    if not np.isfinite(last.get("ema20", np.nan)) or not np.isfinite(last.get("atr14", np.nan)):
        return
    target = float(last["ema20"] + 0.35 * last["atr14"])
    old_closes = df["close"].iloc[index - 4 : index].to_numpy()
    if np.any(old_closes <= 0):
        return
    for offset in range(4):
        desired = old_closes[offset] + (target - old_closes[-1]) * (offset + 1) / 4.0
        factor = float(np.clip(desired / old_closes[offset], 0.92, 1.08))
        for column in ("open", "high", "low", "close"):
            position = df.columns.get_loc(column)
            df.iloc[index - 4 + offset, position] *= factor

    before = df.iloc[:index]
    enriched = add_indicators(before)
    last = enriched.iloc[-1]
    if not np.isfinite(last.get("atr14", np.nan)):
        return
    old_event_close = float(df["close"].iloc[index])
    breakout_level = max(
        float(last["high"]),
        float(last.get("high_breakout_prev", last["high"])),
        float(last["ema20"] + 0.6 * last["atr14"]),
    )
    event_close = breakout_level * 1.006
    event_open = float(last["close"]) * 1.002
    event_high = event_close * 1.004
    event_low = min(event_open, float(last["close"]) * 0.996)
    average_volume = float(last.get("avg_volume20", df["volume"].iloc[index - 20 : index].mean()))
    df.iloc[index, df.columns.get_loc("open")] = event_open
    df.iloc[index, df.columns.get_loc("high")] = event_high
    df.iloc[index, df.columns.get_loc("low")] = event_low
    df.iloc[index, df.columns.get_loc("close")] = event_close
    df.iloc[index, df.columns.get_loc("volume")] = max(
        average_volume * rng.uniform(2.4, 3.8), float(df["volume"].iloc[index])
    )
    ratio = event_close / old_event_close if old_event_close > 0 else 1.0
    _scale_future(df, index + 1, ratio)

    if shock_next == "gap_down":
        _apply_shock(df, index + 2, gap_pct=-0.085, intraday_pct=-0.015, rng=rng)
    elif shock_next == "reversal":
        _apply_shock(df, index + 2, gap_pct=-0.045, intraday_pct=-0.035, rng=rng)
    elif shock_next == "mild_reversal":
        _apply_shock(df, index + 2, gap_pct=-0.025, intraday_pct=-0.035, rng=rng)


def _apply_shock(
    df: pd.DataFrame,
    index: int,
    *,
    gap_pct: float,
    intraday_pct: float,
    rng: np.random.Generator,
) -> None:
    if index <= 0 or index >= len(df):
        return
    before = df.iloc[:index]
    enriched = add_indicators(before)
    average_volume = float(enriched["volume"].iloc[-20:].mean()) if len(enriched) >= 20 else 1e6
    previous_close = float(df["close"].iloc[index - 1])
    old_close = float(df["close"].iloc[index])
    open_ = previous_close * (1.0 + gap_pct)
    close = open_ * (1.0 + intraday_pct)
    high = max(open_, close) * 1.004
    low = min(open_, close) * 0.996
    df.iloc[index, df.columns.get_loc("open")] = open_
    df.iloc[index, df.columns.get_loc("high")] = high
    df.iloc[index, df.columns.get_loc("low")] = low
    df.iloc[index, df.columns.get_loc("close")] = close
    df.iloc[index, df.columns.get_loc("volume")] = average_volume * rng.uniform(2.5, 4.0)
    ratio = close / old_close if old_close > 0 else 1.0
    _scale_future(df, index + 1, ratio)


def generate_scenario(
    name: str = "clean_uptrend",
    *,
    sessions: int = 760,
    stocks_per_sector: int = 6,
    seed: int = 7,
    start: str = "2020-01-01",
) -> DataBundle:
    if name not in SPECS:
        raise ValueError(f"Unknown synthetic scenario {name!r}. Choose from {SCENARIOS}")
    spec = SPECS[name]
    rng = np.random.default_rng(seed)
    dates = pd.bdate_range(start=start, periods=sessions)
    benchmark = _generate_benchmark(rng, dates, spec)
    market_returns = benchmark["close"].pct_change().fillna(0.0).to_numpy()

    fast = sma(benchmark["close"], 50)
    slow = sma(benchmark["close"], 200)
    bull_mask = ((benchmark["close"] > slow) & (fast > slow)).to_numpy()
    bull_days = set(int(i) for i in np.flatnonzero(bull_mask))

    def next_bull_day(day: int) -> int | None:
        for candidate in range(max(0, day), min(sessions, day + 40)):
            if candidate in bull_days:
                return candidate
        return None

    n_sectors = len(SECTOR_NAMES)
    data: dict[str, pd.DataFrame] = {}
    sectors: dict[str, str] = {}
    sector_members: dict[int, list[str]] = {i: [] for i in range(n_sectors)}
    for sector_index, sector_name in enumerate(SECTOR_NAMES):
        for stock_index in range(stocks_per_sector):
            symbol = f"{sector_name[:3].upper()}{stock_index + 1:02d}"
            frame = _generate_stock(
                rng, dates, market_returns, spec, sector_index, stock_index
            )
            data[symbol] = frame
            sectors[symbol] = sector_name
            sector_members[sector_index].append(symbol)

    # Engineered events ---------------------------------------------------
    def inject(symbols: list[str], day: int, shock: str | None = None) -> None:
        if day < 0 or day >= sessions:
            return
        for symbol in symbols:
            _inject_breakout(data[symbol], day, rng, shock_next=shock)

    resolved_days = [
        day for day in (next_bull_day(raw) for raw in spec.event_days) if day is not None
    ]
    if spec.event_kind == "clean":
        for day in resolved_days:
            inject(sector_members[0][:3] + sector_members[1][:3], day)
        if name == "clean_uptrend" and sessions - 1 in bull_days:
            inject(sector_members[0][:3] + sector_members[1][:3], sessions - 1)
    elif spec.event_kind == "broad":
        for day in resolved_days:
            inject([s for members in sector_members.values() for s in members], day)
    elif spec.event_kind == "concentrated":
        for day in resolved_days:
            inject(sector_members[0], day)
    elif spec.event_kind == "false_breakout":
        for day in resolved_days:
            inject(
                sector_members[0][:3] + sector_members[1][:3],
                day,
                shock="mild_reversal",
            )
    elif spec.event_kind == "losing":
        all_symbols = [symbol for members in sector_members.values() for symbol in members]
        for day in resolved_days:
            inject(all_symbols, day, shock="gap_down")
    elif spec.event_kind == "gap_stop":
        for day in resolved_days:
            inject(
                sector_members[0][:3] + sector_members[1][:3],
                day,
                shock="gap_down",
            )

    if spec.shock_days:
        for day in spec.shock_days:
            for symbol in data:
                _apply_shock(data[symbol], day, gap_pct=-0.095, intraday_pct=-0.02, rng=rng)
            _apply_shock(benchmark, day, gap_pct=-0.055, intraday_pct=-0.01, rng=rng)

    for symbol, frame in data.items():
        frame["open"] = frame["open"].clip(lower=1.0)
        frame["low"] = frame[["low", "open", "close"]].min(axis=1).clip(lower=0.5)
        frame["high"] = frame[["high", "open", "close"]].max(axis=1)
        frame["volume"] = frame["volume"].clip(lower=1000.0)

    membership = pd.DataFrame(
        [
            {"date": date, "symbol": symbol}
            for date in pd.date_range(dates[0], dates[-1], freq="MS")
            for symbol in sorted(data)
        ]
    )
    first = pd.DataFrame([{"date": dates[0], "symbol": s} for s in sorted(data)])
    membership = pd.concat([first, membership], ignore_index=True).drop_duplicates()

    return DataBundle(
        data=data,
        benchmark=benchmark,
        sectors=sectors,
        membership=membership.sort_values(["date", "symbol"]).reset_index(drop=True),
        source=f"synthetic:{name}",
        metadata={
            "scenario": name,
            "benchmark_symbol": "NIFTY50",
            "seed": seed,
            "sessions": sessions,
            "description": "Deterministic synthetic data for research/testing only",
        },
    )


def save_scenario(
    name: str,
    output_root: str | Path,
    *,
    sessions: int = 760,
    stocks_per_sector: int = 6,
    seed: int = 7,
    start: str = "2020-01-01",
) -> Path:
    bundle = generate_scenario(
        name,
        sessions=sessions,
        stocks_per_sector=stocks_per_sector,
        seed=seed,
        start=start,
    )
    output = Path(output_root) / name
    save_bundle(bundle, output)
    return output


def generate_all(
    output_root: str | Path = "data/synthetic",
    *,
    sessions: int = 760,
    stocks_per_sector: int = 6,
    seed: int = 7,
    start: str = "2020-01-01",
) -> list[Path]:
    return [
        save_scenario(
            name,
            output_root,
            sessions=sessions,
            stocks_per_sector=stocks_per_sector,
            seed=seed,
            start=start,
        )
        for name in SCENARIOS
    ]


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate deterministic synthetic datasets")
    parser.add_argument("--output", default="data/synthetic")
    parser.add_argument("--scenarios", default="all", help="comma-separated names or 'all'")
    parser.add_argument("--sessions", type=int, default=760)
    parser.add_argument("--stocks-per-sector", type=int, default=6)
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--start", default="2020-01-01")
    args = parser.parse_args()
    names = SCENARIOS if args.scenarios == "all" else tuple(
        name.strip() for name in args.scenarios.split(",") if name.strip()
    )
    for name in names:
        path = save_scenario(
            name,
            args.output,
            sessions=args.sessions,
            stocks_per_sector=args.stocks_per_sector,
            seed=args.seed,
            start=args.start,
        )
        print(f"Wrote {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
