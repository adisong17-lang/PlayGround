export type PageId =
  | 'overview'
  | 'scanner'
  | 'positions'
  | 'orders'
  | 'journal'
  | 'research'
  | 'risk'
  | 'system'
  | 'settings'

export type Trend = 'Rising' | 'Falling' | 'Sideways'
export type SetupType = 'Breakout' | 'Pullback' | 'Momentum'
export type OrderStatus = 'PENDING' | 'EXECUTED' | 'CANCELLED' | 'REJECTED'
export type OrderSide = 'BUY' | 'SELL'
export type TradingMode = 'PAPER' | 'LIVE_DISABLED'

export interface Signal {
  id: string
  symbol: string
  name: string
  sector: string
  setup: SetupType
  dailyTrend: Trend
  weeklyTrend: Trend
  rsRank: number
  momentum: number
  price: number
  changePct: number
  volume: number
  avgVolume: number
  atr: number
  atrPct: number
  entryLow: number
  entryHigh: number
  stop: number
  target1: number
  target2: number
  rr: number
  signalDate: string
  strategy: string
  score: number
  liquidityCr: number
  explanation: string
  spark: number[]
  historical?: boolean
  outcome?: 'Target hit' | 'Stopped out' | 'Expired' | 'Open'
}

export interface Position {
  id: string
  symbol: string
  name: string
  sector: string
  qty: number
  avgPrice: number
  lastPrice: number
  stop: number
  target: number
  openedAt: string
  strategy: string
  riskAmount: number
}

export interface Order {
  id: string
  symbol: string
  name: string
  side: OrderSide
  qty: number
  type: 'MARKET' | 'LIMIT'
  limitPrice?: number
  status: OrderStatus
  createdAt: string
  executedAt?: string
  avgFill?: number
  rejection?: string
  mode: TradingMode
  signalId?: string
  stop?: number
  target?: number
  charges?: number
}

export interface Trade {
  id: string
  symbol: string
  name: string
  side: 'LONG'
  qty: number
  entry: number
  exit: number
  pnl: number
  pnlPct: number
  openedAt: string
  closedAt: string
  holdingDays: number
  strategy: string
  setup: SetupType
  notes: string
  tags: string[]
  rMultiple: number
}

export interface RiskConfig {
  equity: number
  riskPerTradePct: number
  maxPortfolioExposurePct: number
  dailyLossLimitPct: number
  monthlyDrawdownLimitPct: number
  maxOpenPositions: number
  minLiquidityCr: number
  maxConcentrationPct: number
  slippageBps: number
  brokeragePerOrder: number
  taxesPct: number
  gapRiskBufferPct: number
}

export interface EquityPoint {
  date: string
  equity: number
  benchmark: number
  drawdown: number
}

export interface LogEntry {
  id: string
  at: string
  level: 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS'
  source: string
  message: string
}

export interface JournalDraft {
  tradeId: string
  notes: string
  tags: string[]
}

export interface OrderDraft {
  signal: Signal
  qty: number
  entry: number
  stop: number
  target: number
  riskPct: number
  orderType: 'MARKET' | 'LIMIT'
  limitPrice?: number
}

export interface RiskCheck {
  id: string
  label: string
  passed: boolean
  detail: string
  severity: 'hard' | 'warning'
}

export interface RiskDecision {
  allowed: boolean
  checks: RiskCheck[]
  qty: number
  riskAmount: number
  notional: number
  exposureAfter: number
  concentrationAfter: number
  estimatedCharges: number
  estimatedSlippage: number
}

export interface SystemAction {
  id: string
  label: string
  description: string
  tone: 'safe' | 'caution' | 'danger'
  confirmation: string
}

export interface DashboardState {
  version: number
  mode: TradingMode
  entriesPaused: boolean
  watchlist: string[]
  orders: Order[]
  positions: Position[]
  journal: Trade[]
  risk: RiskConfig
  logs: LogEntry[]
  lastScanAt: string
  notificationsEnabled: boolean
  sessionLocked: boolean
  telegramConfigured: boolean
  kiteConnected: boolean
}

export interface Toast {
  id: string
  tone: 'success' | 'danger' | 'info' | 'warning'
  title: string
  message?: string
}
