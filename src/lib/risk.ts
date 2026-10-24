import type { Order, Position, RiskCheck, RiskConfig, RiskDecision, Signal } from '../types'

export interface OrderIntent {
  symbol: string
  entry: number
  stop: number
  target: number
  requestedQty?: number
  liquidityCr: number
}

export interface RiskContext {
  config: RiskConfig
  positions: Position[]
  orders: Order[]
  cash: number
  dailyPnl: number
  monthlyDrawdownPct: number
  entriesPaused: boolean
  mode: 'PAPER' | 'LIVE_DISABLED'
}

export function calculatePositionSize(
  equity: number,
  riskPct: number,
  entry: number,
  stop: number,
  gapBufferPct = 0,
): { qty: number; riskAmount: number; riskPerShare: number } {
  if (entry <= 0 || stop <= 0 || stop >= entry || riskPct <= 0) {
    return { qty: 0, riskAmount: 0, riskPerShare: 0 }
  }
  const riskAmount = (equity * riskPct) / 100
  const riskPerShare = entry - stop + (entry * gapBufferPct) / 100
  return {
    qty: Math.max(0, Math.floor(riskAmount / riskPerShare)),
    riskAmount,
    riskPerShare,
  }
}

export function estimateCharges(
  notional: number,
  config: RiskConfig,
  sides = 1,
): { brokerage: number; taxes: number; slippage: number; total: number } {
  const brokerage = config.brokeragePerOrder * sides
  const taxes = (notional * config.taxesPct) / 100
  const slippage = (notional * config.slippageBps) / 10_000
  return {
    brokerage,
    taxes,
    slippage,
    total: brokerage + taxes + slippage,
  }
}

function netExposure(positions: Position[]): number {
  return positions.reduce((sum, position) => sum + position.lastPrice * position.qty, 0)
}

function symbolExposure(positions: Position[], symbol: string): number {
  return positions
    .filter((position) => position.symbol === symbol)
    .reduce((sum, position) => sum + position.lastPrice * position.qty, 0)
}

export function evaluateOrder(intent: OrderIntent, context: RiskContext): RiskDecision {
  const { config } = context
  const checks: RiskCheck[] = []
  const push = (
    id: string,
    label: string,
    passed: boolean,
    detail: string,
    severity: 'hard' | 'warning' = 'hard',
  ) => checks.push({ id, label, passed, detail, severity })

  const sizing = calculatePositionSize(
    config.equity,
    config.riskPerTradePct,
    intent.entry,
    intent.stop,
    config.gapRiskBufferPct,
  )
  const qty = intent.requestedQty ?? sizing.qty

  push(
    'stop-definition',
    'Defined stop below entry',
    intent.stop > 0 && intent.stop < intent.entry,
    intent.stop < intent.entry ? 'Hard stop is below planned entry.' : 'Stop must be below entry price.',
  )
  push(
    'entries-paused',
    'New entries enabled',
    !context.entriesPaused,
    context.entriesPaused ? 'Entries are paused by the risk governor.' : 'Entry desk is accepting new risk.',
  )
  push(
    'daily-loss',
    'Daily loss limit intact',
    context.dailyPnl > -(config.equity * config.dailyLossLimitPct) / 100,
    `Daily P&L ${context.dailyPnl >= 0 ? '+' : ''}${context.dailyPnl.toFixed(0)} vs limit -${((config.equity * config.dailyLossLimitPct) / 100).toFixed(0)}.`,
  )
  push(
    'monthly-drawdown',
    'Monthly drawdown limit intact',
    context.monthlyDrawdownPct > -config.monthlyDrawdownLimitPct,
    `Current drawdown ${context.monthlyDrawdownPct.toFixed(2)}% vs ${config.monthlyDrawdownLimitPct.toFixed(2)}% limit.`,
  )
  push(
    'position-count',
    'Concurrent position cap',
    context.positions.length < config.maxOpenPositions,
    `${context.positions.length} open of ${config.maxOpenPositions} allowed.`,
  )
  push(
    'liquidity',
    'Liquidity floor',
    intent.liquidityCr >= config.minLiquidityCr,
    `₹${intent.liquidityCr.toFixed(0)}Cr median daily turnover vs ₹${config.minLiquidityCr.toFixed(0)}Cr floor.`,
  )
  push(
    'qty',
    'Positive position size',
    Number.isFinite(qty) && qty > 0,
    qty > 0 ? `${qty} shares calculated from equity and stop distance.` : 'Risk budget produces zero shares.',
  )
  push(
    'duplicate',
    'No duplicate working order',
    !context.orders.some(
      (order) =>
        order.symbol === intent.symbol &&
        order.side === 'BUY' &&
        (order.status === 'PENDING' || order.status === 'EXECUTED'),
    ),
    context.orders.some(
      (order) =>
        order.symbol === intent.symbol && order.side === 'BUY' && order.status === 'PENDING',
    )
      ? 'A working BUY order already exists for this symbol.'
      : 'No working duplicate detected.',
  )

  const notional = qty * intent.entry
  const exposureBefore = netExposure(context.positions)
  const exposureAfter = exposureBefore + notional
  const maxExposure = (config.equity * config.maxPortfolioExposurePct) / 100
  push(
    'exposure',
    'Portfolio exposure cap',
    exposureAfter <= maxExposure,
    `Post-trade exposure ₹${Math.round(exposureAfter).toLocaleString('en-IN')} vs ₹${Math.round(maxExposure).toLocaleString('en-IN')} cap.`,
  )

  const symbolValue = symbolExposure(context.positions, intent.symbol)
  const maxConcentration = (config.equity * config.maxConcentrationPct) / 100
  push(
    'concentration',
    'Single-name concentration',
    symbolValue + notional <= maxConcentration,
    `Post-trade ${intent.symbol} exposure ₹${Math.round(symbolValue + notional).toLocaleString('en-IN')} vs ₹${Math.round(maxConcentration).toLocaleString('en-IN')} cap.`,
  )

  push(
    'cash',
    'Available cash',
    notional <= context.cash,
    `Required ₹${Math.round(notional).toLocaleString('en-IN')} vs available ₹${Math.round(context.cash).toLocaleString('en-IN')}.`,
  )

  push(
    'risk-reward',
    'Minimum 1.5R target',
    (intent.target - intent.entry) / Math.max(0.01, intent.entry - intent.stop) >= 1.5,
    `Planned reward/risk ${((intent.target - intent.entry) / Math.max(0.01, intent.entry - intent.stop)).toFixed(2)}R.`,
    'warning',
  )

  push(
    'paper-mode',
    'Paper mode default',
    context.mode === 'PAPER',
    context.mode === 'PAPER' ? 'Order will route to the paper ledger only.' : 'Live execution is disabled.',
  )

  const hardFailure = checks.some((check) => !check.passed && check.severity === 'hard')
  const charges = estimateCharges(notional, config, 2)

  return {
    allowed: !hardFailure,
    checks,
    qty,
    riskAmount: qty * (intent.entry - intent.stop + (intent.entry * config.gapRiskBufferPct) / 100),
    notional,
    exposureAfter,
    concentrationAfter: ((symbolValue + notional) / config.equity) * 100,
    estimatedCharges: charges.total,
    estimatedSlippage: charges.slippage,
  }
}

export function signalToIntent(signal: Signal): OrderIntent {
  return {
    symbol: signal.symbol,
    entry: signal.entryHigh,
    stop: signal.stop,
    target: signal.target1,
    liquidityCr: signal.liquidityCr,
  }
}

export function validateRiskConfig(config: RiskConfig): string[] {
  const errors: string[] = []
  if (config.equity <= 0) errors.push('Account equity must be positive.')
  if (config.riskPerTradePct <= 0 || config.riskPerTradePct > 5)
    errors.push('Per-trade risk must be between 0 and 5%.')
  if (config.maxPortfolioExposurePct <= 0 || config.maxPortfolioExposurePct > 100)
    errors.push('Portfolio exposure must be between 0 and 100%.')
  if (config.dailyLossLimitPct <= 0 || config.dailyLossLimitPct > 20)
    errors.push('Daily loss limit must be between 0 and 20%.')
  if (config.monthlyDrawdownLimitPct <= 0 || config.monthlyDrawdownLimitPct > 30)
    errors.push('Monthly drawdown limit must be between 0 and 30%.')
  if (config.maxOpenPositions < 1 || config.maxOpenPositions > 50)
    errors.push('Concurrent positions must be between 1 and 50.')
  if (config.minLiquidityCr < 0) errors.push('Liquidity floor cannot be negative.')
  if (config.maxConcentrationPct <= 0 || config.maxConcentrationPct > 100)
    errors.push('Concentration limit must be between 0 and 100%.')
  if (config.slippageBps < 0 || config.slippageBps > 200)
    errors.push('Slippage must be between 0 and 200 bps.')
  return errors
}
