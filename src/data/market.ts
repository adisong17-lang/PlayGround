import type {
  DashboardState,
  EquityPoint,
  LogEntry,
  Position,
  RiskConfig,
  SetupType,
  Signal,
  Trade,
} from '../types'

export const DATA_MODE = 'DEMO_FIXTURE' as const
export const DATA_AS_OF = new Date('2026-10-23T15:30:00+05:30').toISOString()
export const MARKET_STATUS = 'CLOSED' as const

const STARTING_EQUITY = 1_000_000
const CURRENT_EQUITY = 1_248_650

export function seededRandom(seedText: string): () => number {
  let seed = 2166136261
  for (let i = 0; i < seedText.length; i += 1) {
    seed ^= seedText.charCodeAt(i)
    seed = Math.imul(seed, 16777619)
  }
  return () => {
    seed += 0x6d2b79f5
    let t = seed
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function tradingDates(count: number): Date[] {
  const dates: Date[] = []
  const cursor = new Date('2026-10-23T10:00:00+05:30')
  while (dates.length < count) {
    const day = cursor.getDay()
    if (day !== 0 && day !== 6) dates.unshift(new Date(cursor))
    cursor.setDate(cursor.getDate() - 1)
  }
  return dates
}

export function buildEquityCurve(): EquityPoint[] {
  const length = 252
  const random = seededRandom('gulshan-equity-curve-v1')
  const dates = tradingDates(length)
  const raw: number[] = [STARTING_EQUITY]
  let benchmark = 100
  const benchmarkSeries: number[] = [100]

  for (let i = 1; i < length; i += 1) {
    const regime = i < 40 ? 0.0007 : i < 92 ? -0.0008 : i < 118 ? 0.0002 : 0.00145
    const shock = (random() - 0.5) * 0.009
    const wave = Math.sin(i / 8.5) * 0.0018 + Math.sin(i / 27) * 0.0012
    const previous = raw[i - 1]
    raw.push(Math.max(100_000, previous * (1 + regime + shock + wave)))
    benchmark *= 1 + 0.00048 + (random() - 0.5) * 0.0075
    benchmarkSeries.push(benchmark)
  }

  const scale = CURRENT_EQUITY / raw[raw.length - 1]
  const benchmarkScale = 24_850 / benchmarkSeries[benchmarkSeries.length - 1]
  let peak = 0
  const points = raw.map((value, index) => {
    const equity = value * scale
    peak = Math.max(peak, equity)
    return {
      date: dates[index].toISOString().slice(0, 10),
      equity: Math.round(equity),
      benchmark: Math.round(benchmarkSeries[index] * benchmarkScale),
      drawdown: Number((((equity - peak) / peak) * 100).toFixed(2)),
    }
  })
  points[0].equity = STARTING_EQUITY
  return points
}

export const EQUITY_CURVE = buildEquityCurve()

export function buildSpark(symbol: string, drift = 1, points = 28): number[] {
  const random = seededRandom(`${symbol}-spark-v2`)
  const values: number[] = [100]
  for (let i = 1; i < points; i += 1) {
    const trend = drift * 0.0025
    values.push(values[i - 1] * (1 + trend + (random() - 0.48) * 0.024))
  }
  return values
}

const SIGNAL_SEEDS: Array<{
  symbol: string
  name: string
  sector: string
  setup: SetupType
  price: number
  change: number
  entry: number
  stop: number
  target: number
  rs: number
  momentum: number
  strategy: string
  score: number
  explanation: string
}> = [
  {
    symbol: 'RELIANCE',
    name: 'Reliance Industries',
    sector: 'Energy',
    setup: 'Breakout',
    price: 2941.2,
    change: 1.84,
    entry: 2915,
    stop: 2798,
    target: 3155,
    rs: 91,
    momentum: 2.8,
    strategy: '52W High Breakout',
    score: 92,
    explanation:
      'Price closed above the 52-week range on 1.7× average volume while weekly structure remains higher-high. Relative strength is in the top decile versus the NSE 500.',
  },
  {
    symbol: 'TATAMOTORS',
    name: 'Tata Motors',
    sector: 'Automobile',
    setup: 'Pullback',
    price: 721.4,
    change: 1.26,
    entry: 716,
    stop: 682,
    target: 792,
    rs: 88,
    momentum: 1.9,
    strategy: 'EMA20 Pullback',
    score: 88,
    explanation:
      'Constructive pullback to the rising 20-day EMA after a volume breakout. Risk is defined below the swing low and weekly momentum remains positive.',
  },
  {
    symbol: 'HDFCBANK',
    name: 'HDFC Bank',
    sector: 'Financials',
    setup: 'Breakout',
    price: 1692.8,
    change: 0.92,
    entry: 1684,
    stop: 1610,
    target: 1804,
    rs: 76,
    momentum: 1.4,
    strategy: 'Range Expansion',
    score: 84,
    explanation:
      'Banking leader is resolving a six-week consolidation with expanding delivery volumes. Sector breadth supports the move but entry is extended from the base.',
  },
  {
    symbol: 'LT',
    name: 'Larsen & Toubro',
    sector: 'Capital Goods',
    setup: 'Momentum',
    price: 3690.5,
    change: 1.08,
    entry: 3665,
    stop: 3540,
    target: 3900,
    rs: 84,
    momentum: 1.7,
    strategy: 'Trend Continuation',
    score: 83,
    explanation:
      'Sustained daily and weekly uptrend with a tight closing range. Momentum rank is improving and volume is above the 20-day average.',
  },
  {
    symbol: 'TITAN',
    name: 'Titan Company',
    sector: 'Consumer',
    setup: 'Pullback',
    price: 3488.1,
    change: 1.42,
    entry: 3460,
    stop: 3300,
    target: 3765,
    rs: 80,
    momentum: 1.5,
    strategy: 'EMA20 Pullback',
    score: 81,
    explanation:
      'Pullback held above the rising 20-day EMA with lower volume on the retracement. Weekly trend filter remains positive.',
  },
  {
    symbol: 'BAJFINANCE',
    name: 'Bajaj Finance',
    sector: 'Financials',
    setup: 'Breakout',
    price: 742.6,
    change: 2.11,
    entry: 733,
    stop: 694,
    target: 805,
    rs: 92,
    momentum: 3.2,
    strategy: 'Cup & Handle',
    score: 89,
    explanation:
      'Multi-week cup-and-handle base completing with strong relative strength. Volume confirmation is present; watch for a close above the pivot.',
  },
  {
    symbol: 'SUNPHARMA',
    name: 'Sun Pharmaceutical',
    sector: 'Healthcare',
    setup: 'Pullback',
    price: 1708.2,
    change: -0.34,
    entry: 1700,
    stop: 1660,
    target: 1785,
    rs: 57,
    momentum: 0.4,
    strategy: 'Higher Low Pullback',
    score: 72,
    explanation:
      'Holding a higher low above the 50-day EMA, though momentum is neutral and the setup is below the preferred ranking threshold.',
  },
  {
    symbol: 'ICICIBANK',
    name: 'ICICI Bank',
    sector: 'Financials',
    setup: 'Momentum',
    price: 1388.4,
    change: 0.76,
    entry: 1380,
    stop: 1328,
    target: 1488,
    rs: 85,
    momentum: 1.2,
    strategy: 'Relative Strength Leader',
    score: 82,
    explanation:
      'Steady trend continuation with leadership versus the banking index. Risk/reward is acceptable but not exceptional.',
  },
  {
    symbol: 'ADANIPORTS',
    name: 'Adani Ports',
    sector: 'Infrastructure',
    setup: 'Breakout',
    price: 1584.9,
    change: 2.47,
    entry: 1571,
    stop: 1478,
    target: 1708,
    rs: 89,
    momentum: 2.4,
    strategy: 'Volatility Expansion',
    score: 86,
    explanation:
      'Volatility contraction resolved to the upside with above-average turnover. Position size must account for wider ATR.',
  },
  {
    symbol: 'MARUTI',
    name: 'Maruti Suzuki',
    sector: 'Automobile',
    setup: 'Pullback',
    price: 12964,
    change: 0.71,
    entry: 12910,
    stop: 12480,
    target: 13820,
    rs: 78,
    momentum: 0.9,
    strategy: 'EMA20 Pullback',
    score: 77,
    explanation:
      'Orderly pullback in a weekly uptrend. Liquidity is strong and gap risk is moderate around monthly derivatives expiry.',
  },
  {
    symbol: 'DIVISLAB',
    name: "Divi's Laboratories",
    sector: 'Healthcare',
    setup: 'Momentum',
    price: 6124.5,
    change: 1.63,
    entry: 6080,
    stop: 5820,
    target: 6550,
    rs: 83,
    momentum: 1.8,
    strategy: 'Trend Continuation',
    score: 80,
    explanation:
      'Momentum rank improved through the week with price holding above a rising 50-day EMA. Volatility is elevated; use wide stops.',
  },
  {
    symbol: 'JSWSTEEL',
    name: 'JSW Steel',
    sector: 'Metals',
    setup: 'Breakout',
    price: 1064.3,
    change: 1.96,
    entry: 1052,
    stop: 986,
    target: 1160,
    rs: 86,
    momentum: 2.1,
    strategy: 'Range Expansion',
    score: 85,
    explanation:
      'Sector rotation is lifting metals and JSW is a relative-strength leader. Breakout volume confirms demand.',
  },
  {
    symbol: 'DMART',
    name: 'Avenue Supermarts',
    sector: 'Consumer',
    setup: 'Pullback',
    price: 4682.9,
    change: -0.18,
    entry: 4655,
    stop: 4460,
    target: 5040,
    rs: 62,
    momentum: 0.2,
    strategy: 'Higher Low Pullback',
    score: 68,
    explanation:
      'Constructive base but relative strength is mediocre and the stock is not yet outperforming the benchmark. Candidate for watchlist only.',
  },
  {
    symbol: 'COALINDIA',
    name: 'Coal India',
    sector: 'Energy',
    setup: 'Momentum',
    price: 412.8,
    change: 1.11,
    entry: 410,
    stop: 392,
    target: 448,
    rs: 71,
    momentum: 1.1,
    strategy: 'Relative Strength Leader',
    score: 74,
    explanation:
      'Improving trend with decent liquidity. Score is capped by a weak weekly momentum rank and limited upside to prior resistance.',
  },
]

function isoDaysAgo(days: number, hour = 15): string {
  const base = new Date('2026-10-23T15:30:00+05:30')
  base.setDate(base.getDate() - days)
  base.setHours(hour, 30, 0, 0)
  return base.toISOString()
}

export const SIGNALS: Signal[] = SIGNAL_SEEDS.map((seed, index) => {
  const random = seededRandom(`${seed.symbol}-market`)
  const entryMid = (seed.entry + seed.entry * 1.005) / 2
  const rr = Number(((seed.target - entryMid) / (entryMid - seed.stop)).toFixed(1))
  const volume = Math.round(1_200_000 + random() * 23_000_000)
  const avgVolume = Math.round(volume / (1.15 + random() * 1.4))
  const atr = Number(((seed.price - seed.stop) / (2.1 + random())).toFixed(2))
  const dailyTrend = seed.setup === 'Pullback' ? 'Rising' : seed.setup === 'Momentum' ? 'Rising' : 'Rising'
  return {
    id: `sig-${seed.symbol.toLowerCase()}-${index}`,
    ...seed,
    rsRank: seed.rs,
    changePct: seed.change,
    entryLow: Number((seed.entry * 0.998).toFixed(2)),
    entryHigh: Number((seed.entry * 1.005).toFixed(2)),
    target1: seed.target,
    target2: Number((seed.target + (seed.target - seed.entry) * 0.8).toFixed(2)),
    rr,
    dailyTrend,
    weeklyTrend: seed.rs > 65 ? 'Rising' : 'Sideways',
    atr,
    atrPct: Number(((atr / seed.price) * 100).toFixed(2)),
    volume,
    avgVolume,
    signalDate: isoDaysAgo(index % 5),
    liquidityCr: Number((120 + random() * 2400).toFixed(0)),
    spark: buildSpark(seed.symbol, seed.momentum / 2, 28),
    historical: false,
  }
})

export const HISTORICAL_SIGNALS: Signal[] = SIGNALS.slice(0, 11).map((signal, index) => ({
  ...signal,
  id: `hist-${signal.symbol.toLowerCase()}-${index}`,
  signalDate: isoDaysAgo(30 + index * 4),
  historical: true,
  outcome: index % 4 === 0 ? 'Stopped out' : index % 3 === 0 ? 'Expired' : 'Target hit',
  spark: buildSpark(`${signal.symbol}-hist-${index}`, index % 4 === 0 ? -0.7 : 0.8, 28),
}))

export const POSITIONS: Position[] = [
  {
    id: 'pos-rel',
    symbol: 'RELIANCE',
    name: 'Reliance Industries',
    sector: 'Energy',
    qty: 32,
    avgPrice: 2874.5,
    lastPrice: 2941.2,
    stop: 2798,
    target: 3155,
    openedAt: isoDaysAgo(6),
    strategy: '52W High Breakout',
    riskAmount: 2448,
  },
  {
    id: 'pos-hdfc',
    symbol: 'HDFCBANK',
    name: 'HDFC Bank',
    sector: 'Financials',
    qty: 45,
    avgPrice: 1668.4,
    lastPrice: 1692.8,
    stop: 1610,
    target: 1804,
    openedAt: isoDaysAgo(9),
    strategy: 'Range Expansion',
    riskAmount: 3690,
  },
  {
    id: 'pos-titan',
    symbol: 'TITAN',
    name: 'Titan Company',
    sector: 'Consumer',
    qty: 18,
    avgPrice: 3420.0,
    lastPrice: 3488.1,
    stop: 3300,
    target: 3765,
    openedAt: isoDaysAgo(4),
    strategy: 'EMA20 Pullback',
    riskAmount: 3384,
  },
  {
    id: 'pos-sun',
    symbol: 'SUNPHARMA',
    name: 'Sun Pharmaceutical',
    sector: 'Healthcare',
    qty: 50,
    avgPrice: 1731.6,
    lastPrice: 1708.2,
    stop: 1660,
    target: 1785,
    openedAt: isoDaysAgo(12),
    strategy: 'Higher Low Pullback',
    riskAmount: 2400,
  },
  {
    id: 'pos-tata',
    symbol: 'TATAMOTORS',
    name: 'Tata Motors',
    sector: 'Automobile',
    qty: 90,
    avgPrice: 703.8,
    lastPrice: 721.4,
    stop: 682,
    target: 792,
    openedAt: isoDaysAgo(3),
    strategy: 'EMA20 Pullback',
    riskAmount: 3510,
  },
  {
    id: 'pos-lt',
    symbol: 'LT',
    name: 'Larsen & Toubro',
    sector: 'Capital Goods',
    qty: 18,
    avgPrice: 3612.4,
    lastPrice: 3690.5,
    stop: 3540,
    target: 3900,
    openedAt: isoDaysAgo(7),
    strategy: 'Trend Continuation',
    riskAmount: 2700,
  },
]

export const TRADES: Trade[] = [
  {
    id: 'tr-1',
    symbol: 'INFY',
    name: 'Infosys',
    side: 'LONG',
    qty: 60,
    entry: 1488,
    exit: 1546.2,
    pnl: 3439.8,
    pnlPct: 3.91,
    openedAt: isoDaysAgo(24),
    closedAt: isoDaysAgo(18),
    holdingDays: 6,
    strategy: 'EMA20 Pullback',
    setup: 'Pullback',
    notes: 'Textbook pullback. Held above 20 EMA, added after volume confirmation.',
    tags: ['A+ setup', 'Tech'],
    rMultiple: 2.1,
  },
  {
    id: 'tr-2',
    symbol: 'TATASTEEL',
    name: 'Tata Steel',
    side: 'LONG',
    qty: 400,
    entry: 168.4,
    exit: 162.15,
    pnl: -2556.4,
    pnlPct: -3.71,
    openedAt: isoDaysAgo(27),
    closedAt: isoDaysAgo(22),
    holdingDays: 5,
    strategy: 'Range Expansion',
    setup: 'Breakout',
    notes: 'Failed breakout. Exit was disciplined at stop; volume faded on day two.',
    tags: ['Loss', 'Metals'],
    rMultiple: -1,
  },
  {
    id: 'tr-3',
    symbol: 'BHARTIARTL',
    name: 'Bharti Airtel',
    side: 'LONG',
    qty: 35,
    entry: 1742,
    exit: 1818.5,
    pnl: 2617.1,
    pnlPct: 4.39,
    openedAt: isoDaysAgo(33),
    closedAt: isoDaysAgo(21),
    holdingDays: 12,
    strategy: 'Trend Continuation',
    setup: 'Momentum',
    notes: 'Let winner run to target 1. Trailed stop after 2R.',
    tags: ['Winner', 'Telecom'],
    rMultiple: 2.8,
  },
  {
    id: 'tr-4',
    symbol: 'CIPLA',
    name: 'Cipla',
    side: 'LONG',
    qty: 55,
    entry: 1442.5,
    exit: 1467.8,
    pnl: 1346.9,
    pnlPct: 1.75,
    openedAt: isoDaysAgo(38),
    closedAt: isoDaysAgo(26),
    holdingDays: 12,
    strategy: 'Higher Low Pullback',
    setup: 'Pullback',
    notes: 'Trimmed at target 1, remaining position trailed out.',
    tags: ['Partial', 'Pharma'],
    rMultiple: 1.4,
  },
  {
    id: 'tr-5',
    symbol: 'AXISBANK',
    name: 'Axis Bank',
    side: 'LONG',
    qty: 50,
    entry: 1188,
    exit: 1177.2,
    pnl: -600.8,
    pnlPct: -1.01,
    openedAt: isoDaysAgo(42),
    closedAt: isoDaysAgo(39),
    holdingDays: 3,
    strategy: 'Range Expansion',
    setup: 'Breakout',
    notes: 'Thesis invalidated quickly. Raised stop to breakeven, then exited on weakness.',
    tags: ['Scratch', 'Banks'],
    rMultiple: -0.3,
  },
  {
    id: 'tr-6',
    symbol: 'POWERGRID',
    name: 'Power Grid',
    side: 'LONG',
    qty: 160,
    entry: 318.2,
    exit: 336.9,
    pnl: 2915.2,
    pnlPct: 5.87,
    openedAt: isoDaysAgo(51),
    closedAt: isoDaysAgo(41),
    holdingDays: 10,
    strategy: 'Relative Strength Leader',
    setup: 'Momentum',
    notes: 'Slow but clean trend. Full exit at target.',
    tags: ['Winner', 'Utilities'],
    rMultiple: 2.4,
  },
  {
    id: 'tr-7',
    symbol: 'HINDUNILVR',
    name: 'Hindustan Unilever',
    side: 'LONG',
    qty: 30,
    entry: 2634,
    exit: 2589.5,
    pnl: -1386.9,
    pnlPct: -1.75,
    openedAt: isoDaysAgo(58),
    closedAt: isoDaysAgo(55),
    holdingDays: 3,
    strategy: 'EMA20 Pullback',
    setup: 'Pullback',
    notes: 'Weak relative strength should have kept this off the list. Process note added.',
    tags: ['Loss', 'FMCG', 'Lesson'],
    rMultiple: -0.8,
  },
  {
    id: 'tr-8',
    symbol: 'NTPC',
    name: 'NTPC',
    side: 'LONG',
    qty: 140,
    entry: 346.8,
    exit: 369.4,
    pnl: 3077.2,
    pnlPct: 6.34,
    openedAt: isoDaysAgo(66),
    closedAt: isoDaysAgo(52),
    holdingDays: 14,
    strategy: 'Trend Continuation',
    setup: 'Momentum',
    notes: 'Followed plan. Partial at 1.5R, trail below 10 EMA.',
    tags: ['Winner', 'Utilities'],
    rMultiple: 2.9,
  },
  {
    id: 'tr-9',
    symbol: 'WIPRO',
    name: 'Wipro',
    side: 'LONG',
    qty: 180,
    entry: 254.6,
    exit: 247.8,
    pnl: -1280.4,
    pnlPct: -2.79,
    openedAt: isoDaysAgo(72),
    closedAt: isoDaysAgo(68),
    holdingDays: 4,
    strategy: 'Range Expansion',
    setup: 'Breakout',
    notes: 'False breakout on soft IT breadth. Stop respected.',
    tags: ['Loss', 'IT'],
    rMultiple: -1,
  },
  {
    id: 'tr-10',
    symbol: 'M&M',
    name: 'Mahindra & Mahindra',
    side: 'LONG',
    qty: 40,
    entry: 2968,
    exit: 3112.5,
    pnl: 5704.6,
    pnlPct: 4.8,
    openedAt: isoDaysAgo(81),
    closedAt: isoDaysAgo(63),
    holdingDays: 18,
    strategy: '52W High Breakout',
    setup: 'Breakout',
    notes: 'Best trade of the quarter. Let the position compound and trailed under structure.',
    tags: ['A+ setup', 'Winner'],
    rMultiple: 3.4,
  },
  {
    id: 'tr-11',
    symbol: 'DRREDDY',
    name: "Dr. Reddy's Labs",
    side: 'LONG',
    qty: 35,
    entry: 1324.2,
    exit: 1292.6,
    pnl: -1157.4,
    pnlPct: -2.5,
    openedAt: isoDaysAgo(88),
    closedAt: isoDaysAgo(84),
    holdingDays: 4,
    strategy: 'Higher Low Pullback',
    setup: 'Pullback',
    notes: 'Sector momentum reversed. Small loss, no rule break.',
    tags: ['Loss', 'Pharma'],
    rMultiple: -0.9,
  },
  {
    id: 'tr-12',
    symbol: 'SBIN',
    name: 'State Bank of India',
    side: 'LONG',
    qty: 75,
    entry: 818.4,
    exit: 847.9,
    pnl: 2114.7,
    pnlPct: 3.44,
    openedAt: isoDaysAgo(95),
    closedAt: isoDaysAgo(82),
    holdingDays: 13,
    strategy: 'Relative Strength Leader',
    setup: 'Momentum',
    notes: 'Held through a broad market pullback, rewarded by sector rotation.',
    tags: ['Winner', 'Banks'],
    rMultiple: 2,
  },
]

export const ORDERS = [
  {
    id: 'ord-1',
    symbol: 'TATAMOTORS',
    name: 'Tata Motors',
    side: 'BUY' as const,
    qty: 90,
    type: 'MARKET' as const,
    status: 'EXECUTED' as const,
    createdAt: isoDaysAgo(3, 9),
    executedAt: isoDaysAgo(3, 9),
    avgFill: 703.8,
    mode: 'PAPER' as const,
    signalId: 'sig-tatamotors-1',
    stop: 682,
    target: 792,
    charges: 42.6,
  },
  {
    id: 'ord-2',
    symbol: 'RELIANCE',
    name: 'Reliance Industries',
    side: 'BUY' as const,
    qty: 32,
    type: 'LIMIT' as const,
    limitPrice: 2874.5,
    status: 'EXECUTED' as const,
    createdAt: isoDaysAgo(6, 9),
    executedAt: isoDaysAgo(6, 9),
    avgFill: 2874.5,
    mode: 'PAPER' as const,
    stop: 2798,
    target: 3155,
    charges: 38.2,
  },
  {
    id: 'ord-3',
    symbol: 'DMART',
    name: 'Avenue Supermarts',
    side: 'BUY' as const,
    qty: 12,
    type: 'LIMIT' as const,
    limitPrice: 4655,
    status: 'REJECTED' as const,
    createdAt: isoDaysAgo(2, 10),
    mode: 'PAPER' as const,
    rejection: 'Signal score below 70 threshold; liquidity gate passed.',
    charges: 0,
  },
  {
    id: 'ord-4',
    symbol: 'ADANIPORTS',
    name: 'Adani Ports',
    side: 'BUY' as const,
    qty: 25,
    type: 'LIMIT' as const,
    limitPrice: 1571,
    status: 'CANCELLED' as const,
    createdAt: isoDaysAgo(1, 11),
    mode: 'PAPER' as const,
    charges: 0,
  },
  {
    id: 'ord-5',
    symbol: 'BAJFINANCE',
    name: 'Bajaj Finance',
    side: 'BUY' as const,
    qty: 12,
    type: 'LIMIT' as const,
    limitPrice: 733,
    status: 'PENDING' as const,
    createdAt: isoDaysAgo(0, 14),
    mode: 'PAPER' as const,
    stop: 694,
    target: 805,
    charges: 0,
  },
]

export const RISK_CONFIG: RiskConfig = {
  equity: CURRENT_EQUITY,
  riskPerTradePct: 0.75,
  maxPortfolioExposurePct: 65,
  dailyLossLimitPct: 2,
  monthlyDrawdownLimitPct: 6,
  maxOpenPositions: 8,
  minLiquidityCr: 25,
  maxConcentrationPct: 20,
  slippageBps: 8,
  brokeragePerOrder: 20,
  taxesPct: 0.12,
  gapRiskBufferPct: 0.5,
}

export const LOGS: LogEntry[] = [
  {
    id: 'log-1',
    at: isoDaysAgo(0, 15),
    level: 'SUCCESS',
    source: 'scanner',
    message: 'Scan completed · 1,842 symbols evaluated · 14 candidates emitted',
  },
  {
    id: 'log-2',
    at: isoDaysAgo(0, 15),
    level: 'INFO',
    source: 'market-data',
    message: 'NSE bhavcopy and corporate actions reconciled for 2026-10-23',
  },
  {
    id: 'log-3',
    at: isoDaysAgo(0, 14),
    level: 'WARN',
    source: 'kite',
    message: 'Broker session not configured · live execution remains disabled',
  },
  {
    id: 'log-4',
    at: isoDaysAgo(0, 13),
    level: 'WARN',
    source: 'risk',
    message: 'Portfolio heat at 78% of configured daily risk budget',
  },
  {
    id: 'log-5',
    at: isoDaysAgo(1, 16),
    level: 'ERROR',
    source: 'orders',
    message: 'DMART paper order rejected · strategy score below entry threshold',
  },
  {
    id: 'log-6',
    at: isoDaysAgo(1, 10),
    level: 'SUCCESS',
    source: 'reconcile',
    message: 'Local positions reconciled with paper broker · 6/6 matched',
  },
]

export const INITIAL_STATE: DashboardState = {
  version: 3,
  mode: 'PAPER',
  entriesPaused: false,
  watchlist: ['TATAMOTORS', 'BAJFINANCE', 'JSWSTEEL', 'DIVISLAB'],
  orders: ORDERS,
  positions: POSITIONS,
  journal: TRADES,
  risk: RISK_CONFIG,
  logs: LOGS,
  lastScanAt: isoDaysAgo(0, 15),
  notificationsEnabled: false,
  sessionLocked: false,
  telegramConfigured: false,
  kiteConnected: false,
}

export interface ComputedPortfolio {
  equity: number
  cash: number
  invested: number
  currentValue: number
  dayPnl: number
  dayPnlPct: number
  monthPnl: number
  monthPnlPct: number
  totalPnl: number
  totalPnlPct: number
  unrealised: number
  unrealisedPct: number
  realised: number
  openRisk: number
  exposurePct: number
  maxDrawdown: number
  cagr: number
  openPositions: number
  pendingOrders: number
}

export function computePortfolio(state: DashboardState): ComputedPortfolio {
  const invested = state.positions.reduce((sum, p) => sum + p.avgPrice * p.qty, 0)
  const currentValue = state.positions.reduce((sum, p) => sum + p.lastPrice * p.qty, 0)
  const unrealised = currentValue - invested
  const equity = state.risk.equity
  const cash = equity - invested
  const dayPnl = 8420.5
  const monthPnl = 19420.8
  const realised = state.journal.reduce((sum, trade) => sum + trade.pnl, 0)
  const totalPnl = equity - STARTING_EQUITY
  const openRisk = state.positions.reduce((sum, p) => sum + p.riskAmount, 0)
  const first = EQUITY_CURVE[0]
  const years = 1
  return {
    equity,
    cash,
    invested,
    currentValue,
    dayPnl,
    dayPnlPct: (dayPnl / equity) * 100,
    monthPnl,
    monthPnlPct: (monthPnl / equity) * 100,
    totalPnl,
    totalPnlPct: ((equity - STARTING_EQUITY) / STARTING_EQUITY) * 100,
    unrealised,
    unrealisedPct: invested > 0 ? (unrealised / invested) * 100 : 0,
    realised,
    openRisk,
    exposurePct: (currentValue / equity) * 100,
    maxDrawdown: Math.min(...EQUITY_CURVE.map((point) => point.drawdown)),
    cagr: (Math.pow(equity / first.equity, 1 / years) - 1) * 100,
    openPositions: state.positions.length,
    pendingOrders: state.orders.filter((order) => order.status === 'PENDING').length,
  }
}

export const RESEARCH = {
  strategyName: 'PA Swing · Relative Strength Pullback',
  version: 'v0.9.3-demo',
  qualification: 'NOT QUALIFIED',
  qualificationDetail:
    'Demonstration fixture only. No engine audit, walk-forward validation or out-of-sample evidence is available in this runtime.',
  metrics: [
    { label: 'CAGR', value: '18.4%', note: 'In-sample fixture' },
    { label: 'Sharpe', value: '1.12', note: 'Daily returns' },
    { label: 'Max drawdown', value: '-14.8%', note: 'Exceeds -12% gate' },
    { label: 'Win rate', value: '47.8%', note: '138 trades' },
    { label: 'Expectancy', value: '+0.34R', note: 'After costs' },
    { label: 'Profit factor', value: '1.38', note: 'In-sample' },
  ],
  gates: [
    { label: 'Minimum 250 trades', passed: false, value: '138 / 250' },
    { label: 'Out-of-sample Sharpe > 0.9', passed: false, value: 'Not run' },
    { label: 'Max drawdown under 12%', passed: false, value: '-14.8%' },
    { label: 'Walk-forward stability', passed: false, value: 'Insufficient windows' },
    { label: 'Cost & slippage stress', passed: false, value: 'Incomplete' },
    { label: 'Live Kite adapter verified', passed: false, value: 'Blocked' },
  ],
  costImpact: [
    { label: 'Gross CAGR', value: '22.1%' },
    { label: 'Brokerage & taxes', value: '-2.4%' },
    { label: 'Slippage & gap model', value: '-1.3%' },
    { label: 'Net CAGR', value: '18.4%' },
  ],
  monthly: [
    { month: 'Nov', value: 1.2 },
    { month: 'Dec', value: -0.8 },
    { month: 'Jan', value: 2.4 },
    { month: 'Feb', value: 1.7 },
    { month: 'Mar', value: -1.9 },
    { month: 'Apr', value: 2.8 },
    { month: 'May', value: 0.9 },
    { month: 'Jun', value: 3.1 },
    { month: 'Jul', value: -0.4 },
    { month: 'Aug', value: 1.8 },
    { month: 'Sep', value: 2.2 },
    { month: 'Oct', value: 1.1 },
  ],
}

export const MODELED_CHARGES = {
  brokerage: 20,
  stt: 0.025,
  exchange: 0.00297,
  gst: 18,
  stamp: 0.003,
  sebi: 0.0001,
}
