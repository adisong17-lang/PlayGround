"""Cash, positions, closed trades and daily equity accounting (long-only)."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Mapping

import pandas as pd


@dataclass
class Position:
    symbol: str
    sector: str
    signal_date: pd.Timestamp
    entry_date: pd.Timestamp
    entry_price: float
    signal_close: float
    quantity: int
    initial_stop: float
    stop_price: float
    atr_at_entry: float
    initial_risk_amount: float
    entry_charges: float
    entry_impact: float
    entry_regime: str
    highest_close: float
    last_close: float
    holding_sessions: int = 0
    below_ema_days: int = 0
    entry_reason: str = "momentum_pullback"

    @property
    def position_value(self) -> float:
        return self.entry_price * self.quantity

    @property
    def risk_amount(self) -> float:
        return (self.entry_price - self.initial_stop) * self.quantity

    @property
    def market_value(self) -> float:
        return self.last_close * self.quantity


@dataclass
class Trade:
    symbol: str
    sector: str
    signal_date: pd.Timestamp
    entry_date: pd.Timestamp
    exit_date: pd.Timestamp
    entry_price: float
    exit_price: float
    quantity: int
    position_value: float
    pnl: float
    return_pct: float
    initial_stop: float
    initial_risk_amount: float
    r_multiple: float
    holding_sessions: int
    exit_reason: str
    entry_regime: str
    charges: float
    impact_costs: float
    total_costs: float
    entry_charges: float
    exit_charges: float

    def to_dict(self) -> dict:
        row = asdict(self)
        for key in ("signal_date", "entry_date", "exit_date"):
            value = row[key]
            row[key] = pd.Timestamp(value).date().isoformat()
        return row


class Portfolio:
    def __init__(self, initial_capital: float):
        if initial_capital <= 0:
            raise ValueError("initial_capital must be positive")
        self.initial_capital = float(initial_capital)
        self.cash = float(initial_capital)
        self.positions: dict[str, Position] = {}
        self.closed_trades: list[Trade] = []
        self.daily_rows: list[dict] = []
        self._realised_costs = 0.0

    # ------------------------------------------------------------------
    def has_position(self, symbol: str) -> bool:
        return symbol in self.positions

    def sector_count(self, sector: str) -> int:
        return sum(1 for p in self.positions.values() if p.sector == sector)

    def open_risk(self) -> float:
        return float(sum(p.risk_amount for p in self.positions.values()))

    def market_value(self, prices: Mapping[str, float] | None = None) -> float:
        total = 0.0
        for symbol, position in self.positions.items():
            price = prices.get(symbol, position.last_close) if prices else position.last_close
            total += float(price) * position.quantity
        return float(total)

    def equity(self, prices: Mapping[str, float] | None = None) -> float:
        return float(self.cash + self.market_value(prices))

    def exposure_pct(self, prices: Mapping[str, float] | None = None) -> float:
        equity = self.equity(prices)
        return float(self.market_value(prices) / equity) if equity > 0 else 0.0

    # ------------------------------------------------------------------
    def open_position(
        self,
        *,
        symbol: str,
        sector: str,
        signal_date: pd.Timestamp,
        entry_date: pd.Timestamp,
        entry_price: float,
        signal_close: float,
        quantity: int,
        initial_stop: float,
        atr_at_entry: float,
        entry_charges: float,
        entry_impact: float,
        entry_regime: str,
    ) -> Position:
        if quantity <= 0:
            raise ValueError("quantity must be positive")
        if symbol in self.positions:
            raise ValueError(f"Already holding {symbol}; averaging down is forbidden")
        gross = float(entry_price) * int(quantity)
        required = gross + float(entry_charges)
        if required > self.cash + 1e-9:
            raise ValueError(
                f"Insufficient cash for {symbol}: need {required:.2f}, have {self.cash:.2f}"
            )
        self.cash -= required
        self._realised_costs += float(entry_charges)
        position = Position(
            symbol=symbol,
            sector=sector,
            signal_date=pd.Timestamp(signal_date),
            entry_date=pd.Timestamp(entry_date),
            entry_price=float(entry_price),
            signal_close=float(signal_close),
            quantity=int(quantity),
            initial_stop=float(initial_stop),
            stop_price=float(initial_stop),
            atr_at_entry=float(atr_at_entry),
            initial_risk_amount=(float(entry_price) - float(initial_stop)) * int(quantity),
            entry_charges=float(entry_charges),
            entry_impact=float(entry_impact),
            entry_regime=entry_regime,
            highest_close=float(entry_price),
            last_close=float(entry_price),
            holding_sessions=0,
        )
        self.positions[symbol] = position
        return position

    def close_position(
        self,
        symbol: str,
        *,
        exit_date: pd.Timestamp,
        exit_price: float,
        exit_reason: str,
        exit_charges: float,
        exit_impact: float,
    ) -> Trade:
        if symbol not in self.positions:
            raise KeyError(f"No open position in {symbol}")
        position = self.positions.pop(symbol)
        gross_proceeds = float(exit_price) * position.quantity
        self.cash += gross_proceeds - float(exit_charges)
        self._realised_costs += float(exit_charges)

        pnl = (
            (float(exit_price) - position.entry_price) * position.quantity
            - position.entry_charges
            - float(exit_charges)
        )
        entry_value = position.entry_price * position.quantity + position.entry_charges
        return_pct = pnl / entry_value if entry_value > 0 else 0.0
        r_multiple = pnl / position.initial_risk_amount if position.initial_risk_amount > 0 else 0.0
        total_costs = (
            position.entry_charges + float(exit_charges) + position.entry_impact + float(exit_impact)
        )
        trade = Trade(
            symbol=symbol,
            sector=position.sector,
            signal_date=position.signal_date,
            entry_date=position.entry_date,
            exit_date=pd.Timestamp(exit_date),
            entry_price=position.entry_price,
            exit_price=float(exit_price),
            quantity=position.quantity,
            position_value=position.position_value,
            pnl=float(pnl),
            return_pct=float(return_pct),
            initial_stop=position.initial_stop,
            initial_risk_amount=position.initial_risk_amount,
            r_multiple=float(r_multiple),
            holding_sessions=position.holding_sessions,
            exit_reason=exit_reason,
            entry_regime=position.entry_regime,
            charges=position.entry_charges + float(exit_charges),
            impact_costs=position.entry_impact + float(exit_impact),
            total_costs=float(total_costs),
            entry_charges=position.entry_charges,
            exit_charges=float(exit_charges),
        )
        self.closed_trades.append(trade)
        return trade

    def mark(
        self,
        date: pd.Timestamp,
        prices: Mapping[str, float],
        atr_values: Mapping[str, float] | None = None,
        trailing_atr_mult: float = 2.5,
    ) -> None:
        """Mark positions to close and update the close-based trailing stop."""
        for symbol, position in self.positions.items():
            price = prices.get(symbol)
            if price is None or pd.isna(price):
                continue
            position.last_close = float(price)
            position.highest_close = max(position.highest_close, float(price))
            position.holding_sessions += 1
            atr_value = (atr_values or {}).get(symbol)
            if atr_value is not None and pd.notna(atr_value) and atr_value > 0:
                trailing = position.highest_close - trailing_atr_mult * float(atr_value)
                position.stop_price = max(position.stop_price, float(trailing))

    def record_day(self, date: pd.Timestamp, prices: Mapping[str, float]) -> None:
        equity = self.equity(prices)
        market_value = self.market_value(prices)
        self.daily_rows.append(
            {
                "date": pd.Timestamp(date),
                "equity": equity,
                "cash": self.cash,
                "market_value": market_value,
                "exposure": market_value / equity if equity > 0 else 0.0,
                "open_positions": len(self.positions),
                "open_risk": self.open_risk(),
                "open_risk_pct": self.open_risk() / equity if equity > 0 else 0.0,
            }
        )

    def equity_frame(self) -> pd.DataFrame:
        return pd.DataFrame(self.daily_rows)

    def trades_frame(self) -> pd.DataFrame:
        if not self.closed_trades:
            return pd.DataFrame()
        return pd.DataFrame([trade.to_dict() for trade in self.closed_trades])
