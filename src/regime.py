"""Market regime filter based on the benchmark index."""

from __future__ import annotations

from typing import Any, Mapping

import pandas as pd

from .indicators import sma


def regime_frame(benchmark: pd.DataFrame, config: Mapping[str, Any]) -> pd.DataFrame:
    cfg = config.get("regime", {})
    fast = int(cfg.get("fast_sma", 50))
    slow = int(cfg.get("slow_sma", 200))
    out = pd.DataFrame(index=benchmark.index)
    out["close"] = benchmark["close"]
    out[f"sma{fast}"] = sma(out["close"], fast)
    out[f"sma{slow}"] = sma(out["close"], slow)
    out["long_enabled"] = (
        (out["close"] > out[f"sma{slow}"]) & (out[f"sma{fast}"] > out[f"sma{slow}"])
    )
    return out


def regime_at(frame: pd.DataFrame, date: pd.Timestamp) -> bool:
    date = pd.Timestamp(date)
    if date not in frame.index:
        return False
    value = frame.at[date, "long_enabled"]
    return bool(value) if pd.notna(value) else False


def regime_label(frame: pd.DataFrame, date: pd.Timestamp) -> str:
    return "bull" if regime_at(frame, date) else "bear"
