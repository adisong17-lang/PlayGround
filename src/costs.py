"""Configurable Indian cash-equity transaction costs and fill assumptions."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Mapping


@dataclass(frozen=True)
class CostBreakdown:
    brokerage: float = 0.0
    stt: float = 0.0
    exchange: float = 0.0
    sebi: float = 0.0
    gst: float = 0.0
    stamp_duty: float = 0.0
    total: float = 0.0

    def to_dict(self) -> dict[str, float]:
        return asdict(self)


class CostModel:
    """Statutory charges plus an explicit slippage/spread fill adjustment.

    Explicit charges are cash debits. Slippage and half the bid-ask spread are
    embedded in the fill price (see :meth:`fill_price`) and are also reported as
    estimated friction so performance attribution includes them.
    """

    def __init__(self, costs: Mapping[str, Any] | None = None):
        cfg = dict(costs or {})
        self.brokerage_bps = float(cfg.get("brokerage_bps", 0.0))
        self.brokerage_flat = float(cfg.get("brokerage_flat", 0.0))
        self.stt_buy_bps = float(cfg.get("stt_buy_bps", 0.0))
        self.stt_sell_bps = float(cfg.get("stt_sell_bps", 0.0))
        self.exchange_bps = float(cfg.get("exchange_bps", 0.0))
        self.sebi_bps = float(cfg.get("sebi_bps", 0.0))
        self.gst_pct = float(cfg.get("gst_pct", 0.0))
        self.stamp_duty_buy_bps = float(cfg.get("stamp_duty_buy_bps", 0.0))
        self.slippage_bps = float(cfg.get("slippage_bps", 0.0))
        self.spread_bps = float(cfg.get("spread_bps", 0.0))

    @classmethod
    def from_config(cls, config: Mapping[str, Any]) -> "CostModel":
        return cls(config.get("costs", {}))

    @property
    def half_spread_bps(self) -> float:
        return self.spread_bps / 2.0

    def fill_price(self, side: str, reference_price: float) -> float:
        """Apply slippage and half-spread to a buy or sell reference price."""
        if side not in {"buy", "sell"}:
            raise ValueError("side must be 'buy' or 'sell'")
        impact = (self.slippage_bps + self.half_spread_bps) / 10000.0
        if side == "buy":
            return float(reference_price) * (1.0 + impact)
        return float(reference_price) * (1.0 - impact)

    def impact_cost(self, price: float, quantity: float) -> float:
        """Estimated slippage + half-spread cost embedded in the fill."""
        turnover = abs(float(price) * float(quantity))
        return turnover * (self.slippage_bps + self.half_spread_bps) / 10000.0

    def charges(self, side: str, price: float, quantity: float) -> CostBreakdown:
        if side not in {"buy", "sell"}:
            raise ValueError("side must be 'buy' or 'sell'")
        turnover = abs(float(price) * float(quantity))
        brokerage = turnover * self.brokerage_bps / 10000.0 + self.brokerage_flat
        stt_bps = self.stt_buy_bps if side == "buy" else self.stt_sell_bps
        stt = turnover * stt_bps / 10000.0
        exchange = turnover * self.exchange_bps / 10000.0
        sebi = turnover * self.sebi_bps / 10000.0
        gst = (brokerage + exchange + sebi) * self.gst_pct
        stamp = turnover * self.stamp_duty_buy_bps / 10000.0 if side == "buy" else 0.0
        total = brokerage + stt + exchange + sebi + gst + stamp
        return CostBreakdown(
            brokerage=brokerage,
            stt=stt,
            exchange=exchange,
            sebi=sebi,
            gst=gst,
            stamp_duty=stamp,
            total=total,
        )

    def round_trip_cost(self, entry_price: float, exit_price: float, quantity: float) -> float:
        buy = self.charges("buy", entry_price, quantity).total + self.impact_cost(entry_price, quantity)
        sell = self.charges("sell", exit_price, quantity).total + self.impact_cost(exit_price, quantity)
        return buy + sell
