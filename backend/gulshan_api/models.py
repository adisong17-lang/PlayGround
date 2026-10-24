from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator


TradingMode = Literal["PAPER"]


class RiskConfig(BaseModel):
    equity: float = Field(default=1_000_000, gt=0, le=1_000_000_000)
    risk_per_trade_pct: float = Field(default=0.75, gt=0, le=5)
    max_portfolio_exposure_pct: float = Field(default=65, gt=0, le=100)
    daily_loss_limit_pct: float = Field(default=2, gt=0, le=20)
    monthly_drawdown_limit_pct: float = Field(default=8, gt=0, le=30)
    max_open_positions: int = Field(default=6, ge=1, le=50)
    min_liquidity_cr: float = Field(default=5, ge=0, le=100_000)
    max_concentration_pct: float = Field(default=20, gt=0, le=100)
    slippage_bps: float = Field(default=8, ge=0, le=200)
    brokerage_per_order: float = Field(default=20, ge=0, le=10_000)
    taxes_pct: float = Field(default=0.05, ge=0, le=5)
    gap_risk_buffer_pct: float = Field(default=0.5, ge=0, le=10)

    @model_validator(mode="after")
    def enforce_policy(self) -> "RiskConfig":
        if self.max_concentration_pct > self.max_portfolio_exposure_pct:
            raise ValueError(
                "Single-name concentration cannot exceed portfolio exposure."
            )
        if self.equity * self.risk_per_trade_pct / 100 <= 0:
            raise ValueError("Per-trade risk budget must be positive.")
        return self


class OrderIntent(BaseModel):
    symbol: str = Field(min_length=1, max_length=24, pattern=r"^[A-Z0-9&.\-]+$")
    entry: float = Field(gt=0, le=10_000_000)
    stop: float = Field(gt=0, le=10_000_000)
    target: float = Field(gt=0, le=10_000_000)
    liquidity_cr: float = Field(ge=0, le=1_000_000)
    requested_qty: int | None = Field(default=None, ge=1, le=1_000_000)

    @model_validator(mode="after")
    def check_plan(self) -> "OrderIntent":
        if self.stop >= self.entry:
            raise ValueError("Stop must be below entry.")
        if self.target <= self.entry:
            raise ValueError("Target must be above entry.")
        return self


class PaperOrderRequest(OrderIntent):
    name: str = Field(min_length=1, max_length=120)
    order_type: Literal["MARKET", "LIMIT"] = "MARKET"
    limit_price: float | None = Field(default=None, gt=0, le=10_000_000)
    signal_id: str | None = Field(default=None, max_length=80)

    @model_validator(mode="after")
    def check_limit(self) -> "PaperOrderRequest":
        if self.order_type == "LIMIT" and self.limit_price is None:
            raise ValueError("A LIMIT order requires limit_price.")
        return self

    @property
    def intent(self) -> OrderIntent:
        return OrderIntent(
            symbol=self.symbol,
            entry=self.entry,
            stop=self.stop,
            target=self.target,
            liquidity_cr=self.liquidity_cr,
            requested_qty=self.requested_qty,
        )


class RiskCheck(BaseModel):
    id: str
    label: str
    passed: bool
    detail: str
    severity: Literal["hard", "warning"] = "hard"


class RiskDecision(BaseModel):
    allowed: bool
    checks: list[RiskCheck]
    qty: int
    risk_amount: float
    notional: float
    exposure_after: float
    concentration_after: float
    estimated_charges: float
    estimated_slippage: float


class Position(BaseModel):
    id: str
    symbol: str
    name: str
    qty: int
    avg_price: float
    last_price: float
    stop: float
    target: float
    opened_at: str
    signal_id: str | None = None


class Order(BaseModel):
    id: str
    symbol: str
    name: str
    side: Literal["BUY", "SELL"]
    qty: int
    type: Literal["MARKET", "LIMIT"]
    limit_price: float | None = None
    status: Literal["PENDING", "EXECUTED", "CANCELLED", "REJECTED"]
    created_at: str
    executed_at: str | None = None
    avg_fill: float | None = None
    mode: TradingMode = "PAPER"
    signal_id: str | None = None
    stop: float | None = None
    target: float | None = None
    charges: float = 0


class Trade(BaseModel):
    id: str
    symbol: str
    name: str
    side: Literal["LONG"] = "LONG"
    qty: int
    entry: float
    exit: float
    pnl: float
    pnl_pct: float
    opened_at: str
    closed_at: str
    holding_days: int
    signal_id: str | None = None


class LedgerSnapshot(BaseModel):
    version: int = 1
    risk: RiskConfig = Field(default_factory=RiskConfig)
    cash: float = 1_000_000
    realized_pnl: float = 0
    daily_pnl: float = 0
    monthly_drawdown_pct: float = 0
    entries_paused: bool = False
    positions: list[Position] = Field(default_factory=list)
    orders: list[Order] = Field(default_factory=list)
    trades: list[Trade] = Field(default_factory=list)
    idempotency: dict[str, "PaperOrderResponse"] = Field(default_factory=dict)


class LoginRequest(BaseModel):
    passphrase: str = Field(min_length=1, max_length=256)


class SessionResponse(BaseModel):
    authenticated: bool = True
    user: str = "operator"
    csrf_token: str | None = None
    expires_at: int | None = None


class AccountResponse(BaseModel):
    cash: float
    market_value: float
    equity: float
    unrealized_pnl: float
    open_risk: float
    realized_pnl: float
    daily_pnl: float
    monthly_drawdown_pct: float
    entries_paused: bool
    risk: RiskConfig
    positions: list[Position]
    orders: list[Order]


class PaperOrderResponse(BaseModel):
    order: Order
    position: Position | None = None
    decision: RiskDecision
    replayed: bool = False


class ClosePositionResponse(BaseModel):
    order: Order
    trade: Trade


class HealthResponse(BaseModel):
    service: str
    status: Literal["ok"]
    api_version: str
    mode: TradingMode
    live_execution: Literal["DISABLED"]
    broker_connected: bool
    engine_connected: bool
    data_mode: Literal["DEMO_FIXTURE"]
    auth: Literal["enabled"]
    telegram_configured: bool
    time: str


class SystemResponse(BaseModel):
    environment: str
    mode: TradingMode
    live_execution: Literal["DISABLED"]
    broker_connected: bool
    engine_connected: bool
    paper_state_persisted: bool
    session_ttl_minutes: int
    allowed_origins: list[str]
    telegram_configured: bool


class TelegramStatus(BaseModel):
    provider: Literal["telegram"] = "telegram"
    configured: bool
    chat_id: str | None = None


class TelegramDelivery(BaseModel):
    delivered: bool
    detail: str


class CancelResponse(BaseModel):
    order: Order


class JournalResponse(BaseModel):
    trades: list[Trade]


LedgerSnapshot.model_rebuild()
