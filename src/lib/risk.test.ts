import { describe, expect, it } from 'vitest'
import type { Order, Position, RiskConfig } from '../types'
import { calculatePositionSize, estimateCharges, evaluateOrder, validateRiskConfig } from './risk'

const config: RiskConfig = {
  equity: 1_000_000,
  riskPerTradePct: 1,
  maxPortfolioExposurePct: 60,
  dailyLossLimitPct: 2,
  monthlyDrawdownLimitPct: 6,
  maxOpenPositions: 5,
  minLiquidityCr: 25,
  maxConcentrationPct: 20,
  slippageBps: 8,
  brokeragePerOrder: 20,
  taxesPct: 0.12,
  gapRiskBufferPct: 0.5,
}

const positions: Position[] = [
  {
    id: 'p1',
    symbol: 'INFY',
    name: 'Infosys',
    sector: 'IT',
    qty: 30,
    avgPrice: 1400,
    lastPrice: 1500,
    stop: 1400,
    target: 1700,
    openedAt: '2026-10-01T00:00:00.000Z',
    strategy: 'Trend',
    riskAmount: 3000,
  },
]

const orders: Order[] = []

const base = {
  config,
  positions,
  orders,
  cash: 955_000,
  dailyPnl: 0,
  monthlyDrawdownPct: -2,
  entriesPaused: false,
  mode: 'PAPER' as const,
}

describe('calculatePositionSize', () => {
  it('sizes from equity, risk percent and stop distance', () => {
    const result = calculatePositionSize(1_000_000, 1, 500, 480, 0)
    expect(result.riskAmount).toBe(10_000)
    expect(result.qty).toBe(500)
  })

  it('includes a gap-risk buffer in effective risk per share', () => {
    const result = calculatePositionSize(1_000_000, 1, 500, 480, 1)
    expect(result.riskPerShare).toBe(25)
    expect(result.qty).toBe(400)
  })

  it('returns zero for an invalid stop', () => {
    expect(calculatePositionSize(1_000_000, 1, 100, 120).qty).toBe(0)
  })
})

describe('estimateCharges', () => {
  it('models brokerage, taxes and slippage on both sides', () => {
    const result = estimateCharges(100_000, config, 2)
    expect(result.brokerage).toBe(40)
    expect(result.taxes).toBe(120)
    expect(result.slippage).toBe(80)
    expect(result.total).toBe(240)
  })
})

describe('evaluateOrder', () => {
  const intent = {
    symbol: 'TCS',
    entry: 400,
    stop: 360,
    target: 500,
    liquidityCr: 800,
  }

  it('allows a compliant paper order', () => {
    const result = evaluateOrder(intent, base)
    expect(result.allowed).toBe(true)
    expect(result.qty).toBeGreaterThan(0)
    expect(result.riskAmount).toBeLessThanOrEqual(10_000)
    expect(result.checks.every((check) => check.passed || check.severity === 'warning')).toBe(true)
  })

  it('blocks new entries when the governor is paused', () => {
    const result = evaluateOrder(intent, { ...base, entriesPaused: true })
    expect(result.allowed).toBe(false)
    expect(result.checks.find((check) => check.id === 'entries-paused')?.passed).toBe(false)
  })

  it('blocks entries after the daily loss limit', () => {
    const result = evaluateOrder(intent, { ...base, dailyPnl: -25_000 })
    expect(result.allowed).toBe(false)
    expect(result.checks.find((check) => check.id === 'daily-loss')?.passed).toBe(false)
  })

  it('blocks entries during a monthly drawdown breach', () => {
    const result = evaluateOrder(intent, { ...base, monthlyDrawdownPct: -7 })
    expect(result.allowed).toBe(false)
    expect(result.checks.find((check) => check.id === 'monthly-drawdown')?.passed).toBe(false)
  })

  it('blocks illiquid stocks', () => {
    const result = evaluateOrder({ ...intent, liquidityCr: 10 }, base)
    expect(result.allowed).toBe(false)
    expect(result.checks.find((check) => check.id === 'liquidity')?.passed).toBe(false)
  })

  it('blocks duplicate working orders', () => {
    const duplicate: Order = {
      id: 'o1',
      symbol: 'TCS',
      name: 'TCS',
      side: 'BUY',
      qty: 10,
      type: 'LIMIT',
      limitPrice: 4000,
      status: 'PENDING',
      createdAt: '2026-10-01T00:00:00.000Z',
      mode: 'PAPER',
    }
    const result = evaluateOrder(intent, { ...base, orders: [duplicate] })
    expect(result.allowed).toBe(false)
    expect(result.checks.find((check) => check.id === 'duplicate')?.passed).toBe(false)
  })

  it('rejects a position that breaches the exposure cap', () => {
    const result = evaluateOrder(
      { ...intent, requestedQty: 2000 },
      { ...base, cash: 5_000_000, positions: [] },
    )
    expect(result.allowed).toBe(false)
    expect(result.checks.find((check) => check.id === 'exposure')?.passed).toBe(false)
  })
})

describe('validateRiskConfig', () => {
  it('accepts a sane configuration', () => {
    expect(validateRiskConfig(config)).toEqual([])
  })

  it('rejects unsafe per-trade risk', () => {
    expect(validateRiskConfig({ ...config, riskPerTradePct: 10 })).toContain(
      'Per-trade risk must be between 0 and 5%.',
    )
  })
})
