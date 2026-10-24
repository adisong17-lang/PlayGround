from __future__ import annotations

from .models import Order, OrderIntent, Position, RiskCheck, RiskConfig, RiskDecision


def calculate_position_size(
    equity: float,
    risk_pct: float,
    entry: float,
    stop: float,
    gap_buffer_pct: float = 0,
) -> tuple[int, float, float]:
    if entry <= 0 or stop <= 0 or stop >= entry or risk_pct <= 0:
        return 0, 0, 0
    risk_amount = equity * risk_pct / 100
    risk_per_share = entry - stop + entry * gap_buffer_pct / 100
    if risk_per_share <= 0:
        return 0, risk_amount, 0
    return max(0, int(risk_amount // risk_per_share)), risk_amount, risk_per_share


def estimate_charges(
    notional: float, config: RiskConfig, sides: int = 1
) -> tuple[float, float, float]:
    brokerage = config.brokerage_per_order * sides
    taxes = notional * config.taxes_pct / 100
    slippage = notional * config.slippage_bps / 10_000
    return brokerage, taxes, slippage


def _position_value(position: Position) -> float:
    return position.last_price * position.qty


def evaluate_order(
    intent: OrderIntent,
    config: RiskConfig,
    positions: list[Position],
    orders: list[Order],
    cash: float,
    daily_pnl: float,
    monthly_drawdown_pct: float,
    entries_paused: bool,
) -> RiskDecision:
    checks: list[RiskCheck] = []

    def push(
        check_id: str,
        label: str,
        passed: bool,
        detail: str,
        severity: str = "hard",
    ) -> None:
        checks.append(
            RiskCheck(
                id=check_id,
                label=label,
                passed=passed,
                detail=detail,
                severity=severity,
            )
        )

    sizing_qty, _, _ = calculate_position_size(
        config.equity,
        config.risk_per_trade_pct,
        intent.entry,
        intent.stop,
        config.gap_risk_buffer_pct,
    )
    qty = intent.requested_qty if intent.requested_qty is not None else sizing_qty

    push(
        "stop-definition",
        "Defined stop below entry",
        intent.stop < intent.entry,
        "Hard stop is below planned entry."
        if intent.stop < intent.entry
        else "Stop must be below entry price.",
    )
    push(
        "entries-paused",
        "New entries enabled",
        not entries_paused,
        "Entries are paused by the risk governor."
        if entries_paused
        else "Entry desk is accepting new risk.",
    )
    daily_limit = config.equity * config.daily_loss_limit_pct / 100
    push(
        "daily-loss",
        "Daily loss limit intact",
        daily_pnl > -daily_limit,
        f"Daily P&L {daily_pnl:+.0f} vs limit -{daily_limit:.0f}.",
    )
    push(
        "monthly-drawdown",
        "Monthly drawdown limit intact",
        monthly_drawdown_pct > -config.monthly_drawdown_limit_pct,
        f"Current drawdown {monthly_drawdown_pct:.2f}% vs {config.monthly_drawdown_limit_pct:.2f}% limit.",
    )
    push(
        "position-count",
        "Concurrent position cap",
        len(positions) < config.max_open_positions,
        f"{len(positions)} open of {config.max_open_positions} allowed.",
    )
    push(
        "liquidity",
        "Liquidity floor",
        intent.liquidity_cr >= config.min_liquidity_cr,
        f"Rs {intent.liquidity_cr:.0f}Cr median turnover vs Rs {config.min_liquidity_cr:.0f}Cr floor.",
    )
    push(
        "qty",
        "Positive position size",
        qty > 0,
        f"{qty} shares calculated from equity and stop distance."
        if qty > 0
        else "Risk budget produces zero shares.",
    )
    push(
        "sizing-cap",
        "Within risk-based size",
        qty <= sizing_qty,
        f"Requested {qty} shares vs {sizing_qty} risk-based maximum."
        if qty > sizing_qty
        else f"{qty} shares within the {sizing_qty}-share risk budget.",
    )
    duplicate = any(position.symbol == intent.symbol for position in positions) or any(
        order.symbol == intent.symbol
        and order.side == "BUY"
        and order.status == "PENDING"
        for order in orders
    )
    push(
        "duplicate",
        "No duplicate working order or position",
        not duplicate,
        "An open position or working BUY order already exists for this symbol."
        if duplicate
        else "No duplicate working order or position detected.",
    )

    notional = qty * intent.entry
    exposure_before = sum(_position_value(position) for position in positions)
    exposure_after = exposure_before + notional
    max_exposure = config.equity * config.max_portfolio_exposure_pct / 100
    push(
        "exposure",
        "Portfolio exposure cap",
        exposure_after <= max_exposure,
        f"Post-trade exposure Rs {exposure_after:,.0f} vs Rs {max_exposure:,.0f} cap.",
    )

    symbol_value = sum(
        _position_value(position)
        for position in positions
        if position.symbol == intent.symbol
    )
    max_concentration = config.equity * config.max_concentration_pct / 100
    push(
        "concentration",
        "Single-name concentration",
        symbol_value + notional <= max_concentration,
        f"Post-trade {intent.symbol} exposure Rs {symbol_value + notional:,.0f} vs Rs {max_concentration:,.0f} cap.",
    )
    push(
        "cash",
        "Available cash",
        notional <= cash,
        f"Required Rs {notional:,.0f} vs available Rs {cash:,.0f}.",
    )

    reward = intent.target - intent.entry
    risk = max(0.01, intent.entry - intent.stop)
    rr = reward / risk
    push(
        "risk-reward",
        "Minimum 1.5R target",
        rr >= 1.5,
        f"Planned reward/risk {rr:.2f}R.",
        "warning",
    )
    push(
        "paper-mode",
        "Paper mode enforced",
        True,
        "Order will route to the server paper ledger only.",
    )

    hard_failure = any(
        not check.passed and check.severity == "hard" for check in checks
    )
    brokerage, taxes, slippage = estimate_charges(notional, config, 2)
    risk_amount = qty * (
        intent.entry - intent.stop + intent.entry * config.gap_risk_buffer_pct / 100
    )

    return RiskDecision(
        allowed=not hard_failure,
        checks=checks,
        qty=qty,
        risk_amount=risk_amount,
        notional=notional,
        exposure_after=exposure_after,
        concentration_after=(
            (symbol_value + notional) / config.equity * 100 if config.equity > 0 else 0
        ),
        estimated_charges=brokerage + taxes + slippage,
        estimated_slippage=slippage,
    )
