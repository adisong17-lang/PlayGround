"""Stop placement, position sizing and portfolio risk limits."""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Mapping

import numpy as np


@dataclass(frozen=True)
class StopPlan:
    stop_price: float
    distance: float
    distance_pct: float
    valid: bool
    reason: str


@dataclass(frozen=True)
class SizingResult:
    quantity: int
    position_value: float
    risk_amount: float
    risk_pct: float
    stop_distance_pct: float
    valid: bool
    reasons: tuple[str, ...] = field(default_factory=tuple)
    binding_constraint: str = ""

    @property
    def reason(self) -> str:
        return "; ".join(self.reasons) if self.reasons else "ok"


def compute_stop(
    entry_price: float,
    swing_low: float,
    atr_value: float,
    atr_mult: float = 2.0,
    max_stop_distance_pct: float = 0.08,
) -> StopPlan:
    """Stop = min(10-day swing low, entry - N*ATR), rejected if wider than cap."""
    entry_price = float(entry_price)
    if not np.isfinite(entry_price) or entry_price <= 0:
        return StopPlan(np.nan, np.nan, np.nan, False, "invalid_entry_price")
    if not np.isfinite(swing_low) or not np.isfinite(atr_value) or atr_value <= 0:
        return StopPlan(np.nan, np.nan, np.nan, False, "missing_atr_or_swing_low")

    atr_stop = entry_price - float(atr_mult) * float(atr_value)
    stop = min(float(swing_low), atr_stop)
    if stop >= entry_price:
        return StopPlan(stop, 0.0, 0.0, False, "stop_not_below_entry")
    distance = entry_price - stop
    distance_pct = distance / entry_price
    if distance_pct > float(max_stop_distance_pct):
        return StopPlan(
            float(stop),
            float(distance),
            float(distance_pct),
            False,
            "stop_distance_too_wide",
        )
    return StopPlan(float(stop), float(distance), float(distance_pct), True, "ok")


def size_position(
    *,
    equity: float,
    entry_price: float,
    stop_price: float,
    config: Mapping[str, Any],
    cash: float,
    open_positions: int,
    sector_positions: int,
    portfolio_risk_amount: float,
    min_quantity: int = 1,
) -> SizingResult:
    """Size a position so that initial rupee risk equals the configured fraction.

    All limits are hard caps. The function never returns a negative quantity and
    never permits leverage or averaging down (the caller must also reject an
    existing position in the same symbol).
    """
    risk_cfg = config.get("risk", {})
    universe_cfg = config.get("universe", {})
    max_positions = int(risk_cfg.get("max_positions", universe_cfg.get("max_positions", 5)))
    max_sector = int(universe_cfg.get("max_positions_per_sector", 2))
    max_position_pct = float(risk_cfg.get("max_position_pct", 0.20))
    max_portfolio_risk_pct = float(risk_cfg.get("max_portfolio_risk_pct", 0.03))
    risk_per_trade_pct = float(risk_cfg.get("risk_per_trade_pct", 0.005))
    min_qty = int(risk_cfg.get("min_quantity", min_quantity))

    reasons: list[str] = []
    if open_positions >= max_positions:
        reasons.append("max_positions")
    if sector_positions >= max_sector:
        reasons.append("max_sector_positions")
    if not np.isfinite(entry_price) or entry_price <= 0:
        reasons.append("invalid_entry_price")
    if not np.isfinite(stop_price) or stop_price >= entry_price:
        reasons.append("invalid_stop")
    if equity <= 0 or cash <= 0:
        reasons.append("no_equity_or_cash")
    if reasons:
        return SizingResult(0, 0.0, 0.0, 0.0, 0.0, False, tuple(reasons), reasons[0])

    per_share_risk = float(entry_price - stop_price)
    risk_budget = float(equity) * risk_per_trade_pct
    remaining_risk = max(
        0.0, float(equity) * max_portfolio_risk_pct - float(portfolio_risk_amount)
    )

    qty_risk = math.floor(risk_budget / per_share_risk)
    qty_value = math.floor((float(equity) * max_position_pct) / float(entry_price))
    qty_cash = math.floor(float(cash) / float(entry_price))
    qty_portfolio = math.floor(remaining_risk / per_share_risk)
    candidates = {
        "risk_per_trade": qty_risk,
        "max_position_pct": qty_value,
        "cash": qty_cash,
        "max_portfolio_risk": qty_portfolio,
    }
    binding = min(candidates, key=candidates.get)
    quantity = int(max(0, candidates[binding]))

    if quantity < min_qty:
        constraint = "no_cash" if qty_cash < min_qty else binding
        return SizingResult(
            0,
            0.0,
            0.0,
            0.0,
            per_share_risk / float(entry_price),
            False,
            (constraint,),
            constraint,
        )

    position_value = quantity * float(entry_price)
    risk_amount = quantity * per_share_risk
    return SizingResult(
        quantity=quantity,
        position_value=float(position_value),
        risk_amount=float(risk_amount),
        risk_pct=float(risk_amount / equity),
        stop_distance_pct=float(per_share_risk / entry_price),
        valid=True,
        reasons=(),
        binding_constraint=binding,
    )
