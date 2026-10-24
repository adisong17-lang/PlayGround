from __future__ import annotations

import os
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

from .models import (
    AccountResponse,
    ClosePositionResponse,
    LedgerSnapshot,
    Order,
    OrderIntent,
    PaperOrderRequest,
    PaperOrderResponse,
    Position,
    RiskConfig,
    RiskDecision,
    Trade,
)
from .risk import estimate_charges, evaluate_order


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class DomainError(Exception):
    def __init__(
        self,
        message: str,
        status_code: int = 400,
        checks: list[dict] | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.checks = checks or []


class PaperLedger:
    def __init__(self, state_file: Path | None = None) -> None:
        self.state_file = state_file
        self._lock = threading.RLock()
        self._state = self._load()

    def _load(self) -> LedgerSnapshot:
        if self.state_file and self.state_file.exists():
            try:
                return LedgerSnapshot.model_validate_json(self.state_file.read_text())
            except (ValueError, OSError) as exc:
                raise RuntimeError(f"Cannot read paper ledger state: {exc}") from exc
        return LedgerSnapshot()

    def _persist(self) -> None:
        if not self.state_file:
            return
        self.state_file.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.state_file.with_name(f".{self.state_file.name}.tmp")
        payload = self._state.model_dump_json(indent=2)
        descriptor = os.open(
            temporary,
            os.O_WRONLY | os.O_CREAT | os.O_TRUNC,
            0o600,
        )
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
                handle.write(payload)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, self.state_file)
        finally:
            if temporary.exists():
                temporary.unlink(missing_ok=True)

    def _account_unlocked(self) -> AccountResponse:
        market_value = sum(
            position.last_price * position.qty for position in self._state.positions
        )
        unrealized = sum(
            (position.last_price - position.avg_price) * position.qty
            for position in self._state.positions
        )
        open_risk = sum(
            max(0.0, position.avg_price - position.stop) * position.qty
            for position in self._state.positions
        )
        return AccountResponse(
            cash=self._state.cash,
            market_value=market_value,
            equity=self._state.cash + market_value,
            unrealized_pnl=unrealized,
            open_risk=open_risk,
            realized_pnl=self._state.realized_pnl,
            daily_pnl=self._state.daily_pnl,
            monthly_drawdown_pct=self._state.monthly_drawdown_pct,
            entries_paused=self._state.entries_paused,
            risk=self._state.risk,
            positions=self._state.positions,
            orders=self._state.orders,
        )

    def account(self) -> AccountResponse:
        with self._lock:
            return self._account_unlocked()

    def journal(self) -> list[Trade]:
        with self._lock:
            return list(self._state.trades)

    def orders(self) -> list[Order]:
        with self._lock:
            return list(self._state.orders)

    def positions(self) -> list[Position]:
        with self._lock:
            return list(self._state.positions)

    def risk_config(self) -> RiskConfig:
        with self._lock:
            return self._state.risk

    def update_risk(self, config: RiskConfig) -> RiskConfig:
        with self._lock:
            self._state.risk = config
            self._persist()
            return config

    def evaluate(self, intent: OrderIntent) -> RiskDecision:
        with self._lock:
            return evaluate_order(
                intent=intent,
                config=self._state.risk,
                positions=self._state.positions,
                orders=self._state.orders,
                cash=self._state.cash,
                daily_pnl=self._state.daily_pnl,
                monthly_drawdown_pct=self._state.monthly_drawdown_pct,
                entries_paused=self._state.entries_paused,
            )

    def place_order(
        self,
        request: PaperOrderRequest,
        idempotency_key: str,
    ) -> PaperOrderResponse:
        with self._lock:
            existing = self._state.idempotency.get(idempotency_key)
            if existing is not None:
                return existing.model_copy(update={"replayed": True})

            if request.order_type == "LIMIT" and request.limit_price is not None:
                if request.limit_price < request.entry:
                    raise DomainError(
                        "Buy limit is below the planned entry and cannot be filled.",
                        status_code=400,
                    )

            decision = evaluate_order(
                intent=request.intent,
                config=self._state.risk,
                positions=self._state.positions,
                orders=self._state.orders,
                cash=self._state.cash,
                daily_pnl=self._state.daily_pnl,
                monthly_drawdown_pct=self._state.monthly_drawdown_pct,
                entries_paused=self._state.entries_paused,
            )
            if not decision.allowed:
                raise DomainError(
                    "Risk governor rejected the paper order.",
                    status_code=409,
                    checks=[check.model_dump() for check in decision.checks],
                )
            if decision.qty <= 0:
                raise DomainError(
                    "Risk budget produced no executable quantity.", status_code=409
                )

            timestamp = utc_now()
            order = Order(
                id=f"ord-{uuid.uuid4().hex[:12]}",
                symbol=request.symbol,
                name=request.name,
                side="BUY",
                qty=decision.qty,
                type=request.order_type,
                limit_price=request.limit_price,
                status="EXECUTED",
                created_at=timestamp,
                executed_at=timestamp,
                avg_fill=request.entry,
                signal_id=request.signal_id,
                stop=request.stop,
                target=request.target,
                charges=round(decision.estimated_charges, 2),
            )
            position = Position(
                id=f"pos-{uuid.uuid4().hex[:12]}",
                symbol=request.symbol,
                name=request.name,
                qty=decision.qty,
                avg_price=request.entry,
                last_price=request.entry,
                stop=request.stop,
                target=request.target,
                opened_at=timestamp,
                signal_id=request.signal_id,
            )

            self._state.cash -= decision.notional + order.charges
            self._state.orders.insert(0, order)
            self._state.positions.insert(0, position)
            response = PaperOrderResponse(
                order=order,
                position=position,
                decision=decision,
            )
            self._state.idempotency[idempotency_key] = response
            self._persist()
            return response

    def cancel_order(self, order_id: str) -> Order:
        with self._lock:
            for index, order in enumerate(self._state.orders):
                if order.id != order_id:
                    continue
                if order.status != "PENDING":
                    raise DomainError(
                        "Only pending orders can be cancelled.",
                        status_code=409,
                    )
                cancelled = order.model_copy(update={"status": "CANCELLED"})
                self._state.orders[index] = cancelled
                self._persist()
                return cancelled
            raise DomainError("Order not found.", status_code=404)

    def close_position(self, position_id: str) -> ClosePositionResponse:
        with self._lock:
            position = next(
                (item for item in self._state.positions if item.id == position_id),
                None,
            )
            if position is None:
                raise DomainError("Position not found.", status_code=404)
            if position.qty <= 0:
                raise DomainError(
                    "Position has no closeable quantity.", status_code=409
                )

            timestamp = utc_now()
            notional = position.last_price * position.qty
            brokerage, taxes, slippage = estimate_charges(
                notional,
                self._state.risk,
                sides=2,
            )
            charges = brokerage + taxes + slippage
            gross = (position.last_price - position.avg_price) * position.qty
            pnl = gross - charges
            opened = datetime.fromisoformat(position.opened_at)
            closed = datetime.fromisoformat(timestamp)
            holding_days = max(1, (closed.date() - opened.date()).days)

            order = Order(
                id=f"ord-{uuid.uuid4().hex[:12]}",
                symbol=position.symbol,
                name=position.name,
                side="SELL",
                qty=position.qty,
                type="MARKET",
                status="EXECUTED",
                created_at=timestamp,
                executed_at=timestamp,
                avg_fill=position.last_price,
                signal_id=position.signal_id,
                stop=position.stop,
                target=position.target,
                charges=round(charges, 2),
            )
            trade = Trade(
                id=f"tr-{uuid.uuid4().hex[:12]}",
                symbol=position.symbol,
                name=position.name,
                qty=position.qty,
                entry=position.avg_price,
                exit=position.last_price,
                pnl=round(pnl, 2),
                pnl_pct=round(pnl / (position.avg_price * position.qty) * 100, 2),
                opened_at=position.opened_at,
                closed_at=timestamp,
                holding_days=holding_days,
                signal_id=position.signal_id,
            )

            self._state.positions = [
                item for item in self._state.positions if item.id != position_id
            ]
            self._state.orders.insert(0, order)
            self._state.trades.insert(0, trade)
            self._state.cash += notional - charges
            self._state.realized_pnl += pnl
            self._state.daily_pnl += pnl
            self._state.risk = self._state.risk.model_copy(
                update={"equity": max(1.0, self._state.risk.equity + pnl)}
            )
            self._persist()
            return ClosePositionResponse(order=order, trade=trade)
