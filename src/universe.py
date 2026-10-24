"""Universe membership and liquidity/quality filters.

When a historical membership file is supplied it is treated as a series of
point-in-time snapshots. Dates before the first snapshot have no members, and
the latest snapshot at or before a given day is used thereafter. This is how the
backtest avoids using future index constituents.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping

import numpy as np
import pandas as pd

from .data_loader import DataBundle


@dataclass(frozen=True)
class Eligibility:
    symbol: str
    eligible: bool
    reason: str

    def __bool__(self) -> bool:
        return self.eligible


class Universe:
    def __init__(self, bundle: DataBundle, config: Mapping[str, Any]):
        self.bundle = bundle
        self.config = config
        self.data = bundle.data
        self.sectors = bundle.sectors or {s: "UNKNOWN" for s in self.data}
        self._membership = bundle.membership
        self._snapshot_dates: list[pd.Timestamp] = []
        self._snapshots: dict[pd.Timestamp, set[str]] = {}
        if self._membership is not None and len(self._membership):
            grouped = self._membership.groupby("date")["symbol"]
            self._snapshots = {pd.Timestamp(d): set(v) for d, v in grouped}
            self._snapshot_dates = sorted(self._snapshots)
        self._static_members = set(self.data)

    # ------------------------------------------------------------------
    # Membership
    # ------------------------------------------------------------------
    def members_on(self, date: pd.Timestamp) -> set[str]:
        date = pd.Timestamp(date)
        if not self._snapshots:
            return set(self.data)
        pos = int(np.searchsorted(np.array(self._snapshot_dates), np.datetime64(date), side="right")) - 1
        if pos < 0:
            return set()
        return set(self._snapshots[self._snapshot_dates[pos]])

    def sector_of(self, symbol: str) -> str:
        return self.sectors.get(symbol, "UNKNOWN")

    def sector_members(self, sector: str, date: pd.Timestamp) -> list[str]:
        return [s for s in self.members_on(date) if self.sector_of(s) == sector and s in self.data]

    def all_sectors(self, date: pd.Timestamp) -> list[str]:
        return sorted({self.sector_of(s) for s in self.members_on(date) if s in self.data})

    # ------------------------------------------------------------------
    # Eligibility
    # ------------------------------------------------------------------
    def check(self, symbol: str, date: pd.Timestamp) -> Eligibility:
        cfg = self.config.get("universe", {})
        date = pd.Timestamp(date)
        df = self.data.get(symbol)
        if df is None or df.empty:
            return Eligibility(symbol, False, "missing_history")

        loc = df.index.searchsorted(date, side="right") - 1
        if loc < 0 or df.index[loc] != date:
            return Eligibility(symbol, False, "missing_data_on_date")

        min_history = int(cfg.get("min_history", 252))
        if loc + 1 < min_history:
            return Eligibility(symbol, False, "insufficient_history")

        window = int(cfg.get("liquidity_lookback", 20))
        recent = df.iloc[max(0, loc - window + 1) : loc + 1]
        if len(recent) < window:
            return Eligibility(symbol, False, "insufficient_history")

        last_close = float(df["close"].iloc[loc])
        if last_close < float(cfg.get("min_price", 0.0)):
            return Eligibility(symbol, False, "penny_stock")

        avg_volume = float(recent["volume"].mean())
        if avg_volume < float(cfg.get("min_avg_volume", 0.0)):
            return Eligibility(symbol, False, "illiquid_volume")

        avg_turnover = float((recent["close"] * recent["volume"]).mean())
        if avg_turnover < float(cfg.get("min_avg_turnover", 0.0)):
            return Eligibility(symbol, False, "illiquid_turnover")

        threshold = float(cfg.get("limit_move_threshold", 0.095))
        max_fraction = float(cfg.get("max_limit_move_fraction", 1.0))
        moves = df["close"].pct_change(fill_method=None).iloc[max(0, loc - window) : loc + 1].abs()
        if len(moves) and float((moves >= threshold).mean()) > max_fraction:
            return Eligibility(symbol, False, "circuit_prone")

        return Eligibility(symbol, True, "eligible")

    def eligible_symbols(self, date: pd.Timestamp) -> list[str]:
        members = self.members_on(date)
        return sorted(s for s in members if s in self.data and self.check(s, date).eligible)

    def eligibility_table(self, date: pd.Timestamp) -> pd.DataFrame:
        rows = []
        for symbol in sorted(self.members_on(date)):
            if symbol not in self.data:
                rows.append({"symbol": symbol, "eligible": False, "reason": "missing_history"})
                continue
            result = self.check(symbol, date)
            rows.append(
                {
                    "symbol": symbol,
                    "eligible": result.eligible,
                    "reason": result.reason,
                    "sector": self.sector_of(symbol),
                }
            )
        return pd.DataFrame(rows, columns=["symbol", "eligible", "reason", "sector"])
