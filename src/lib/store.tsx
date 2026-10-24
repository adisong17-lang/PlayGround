import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { computePortfolio, INITIAL_STATE, type ComputedPortfolio } from '../data/market'
import type { DashboardState, JournalDraft, Order, OrderDraft, RiskConfig, Toast } from '../types'
import { probeBackend, type BackendConnection } from './api'
import { estimateCharges, evaluateOrder, signalToIntent, validateRiskConfig } from './risk'

const STORAGE_KEY = 'gulshan-command-center-v3'

interface AppContextValue {
  state: DashboardState
  portfolio: ComputedPortfolio
  toasts: Toast[]
  backend: BackendConnection
  refreshBackend: () => Promise<void>
  addToast: (toast: Omit<Toast, 'id'>) => void
  dismissToast: (id: string) => void
  toggleWatchlist: (symbol: string) => void
  placePaperOrder: (draft: OrderDraft) => { ok: boolean; message: string }
  cancelOrder: (orderId: string) => void
  closePosition: (positionId: string) => void
  setEntriesPaused: (paused: boolean) => void
  updateRisk: (config: RiskConfig) => { ok: boolean; errors: string[] }
  addJournalNote: (draft: JournalDraft) => void
  runScan: () => Promise<void>
  runSystemAction: (actionId: string, label: string) => void
  toggleNotifications: () => void
  resetDemo: () => void
  lockSession: () => void
  unlockSession: (passphrase: string) => boolean
}

const AppContext = createContext<AppContextValue | null>(null)

function loadState(): DashboardState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return INITIAL_STATE
    const parsed = JSON.parse(raw) as DashboardState
    if (parsed.version !== INITIAL_STATE.version) return INITIAL_STATE
    return { ...INITIAL_STATE, ...parsed, sessionLocked: false }
  } catch {
    return INITIAL_STATE
  }
}

function uid(prefix: string): string {
  const token =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10)
  return `${prefix}-${token}`
}

function nowIso(): string {
  return new Date().toISOString()
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DashboardState>(loadState)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [backend, setBackend] = useState<BackendConnection>({ status: 'checking' })
  const timers = useRef<Map<string, number>>(new Map())

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      // Local persistence is optional; the app remains usable without it.
    }
  }, [state])

  useEffect(() => {
    const current = timers.current
    return () => {
      current.forEach((timer) => window.clearTimeout(timer))
      current.clear()
    }
  }, [])

  const refreshBackend = useCallback(async () => {
    setBackend({ status: 'checking' })
    setBackend(await probeBackend())
  }, [])

  useEffect(() => {
    void refreshBackend()
  }, [refreshBackend])

  const addToast = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = uid('toast')
    setToasts((current) => [...current.slice(-2), { ...toast, id }])
    const timer = window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id))
      timers.current.delete(id)
    }, 4600)
    timers.current.set(id, timer)
  }, [])

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
    const timer = timers.current.get(id)
    if (timer) window.clearTimeout(timer)
    timers.current.delete(id)
  }, [])

  const portfolio = useMemo(() => computePortfolio(state), [state])

  const toggleWatchlist = useCallback((symbol: string) => {
    setState((current) => {
      const watching = current.watchlist.includes(symbol)
      return {
        ...current,
        watchlist: watching
          ? current.watchlist.filter((item) => item !== symbol)
          : [...current.watchlist, symbol],
        logs: [
          {
            id: uid('log'),
            at: nowIso(),
            level: 'INFO' as const,
            source: 'scanner',
            message: `${symbol} ${watching ? 'removed from' : 'added to'} watchlist`,
          },
          ...current.logs,
        ].slice(0, 80),
      }
    })
  }, [])

  const placePaperOrder = useCallback(
    (draft: OrderDraft): { ok: boolean; message: string } => {
      const intent = {
        ...signalToIntent(draft.signal),
        entry: draft.entry,
        stop: draft.stop,
        target: draft.target,
        requestedQty: draft.qty,
      }
      const decision = evaluateOrder(intent, {
        config: state.risk,
        positions: state.positions,
        orders: state.orders,
        cash: portfolio.cash,
        dailyPnl: portfolio.dayPnl,
        monthlyDrawdownPct: -2.1,
        entriesPaused: state.entriesPaused,
        mode: state.mode,
      })

      if (!decision.allowed) {
        const failed = decision.checks.find((check) => !check.passed && check.severity === 'hard')
        const message = failed?.detail ?? 'Risk governor rejected the order.'
        setState((current) => ({
          ...current,
          logs: [
            {
              id: uid('log'),
              at: nowIso(),
              level: 'WARN' as const,
              source: 'risk',
              message: `Paper order blocked · ${draft.signal.symbol} · ${message}`,
            },
            ...current.logs,
          ].slice(0, 80),
        }))
        addToast({
          tone: 'danger',
          title: 'Order blocked by risk governor',
          message,
        })
        return { ok: false, message }
      }

      const orderId = uid('ord')
      const charges = estimateCharges(decision.notional, state.risk, 2).total
      const order: Order = {
        id: orderId,
        symbol: draft.signal.symbol,
        name: draft.signal.name,
        side: 'BUY',
        qty: decision.qty,
        type: draft.orderType,
        limitPrice: draft.orderType === 'LIMIT' ? draft.limitPrice ?? draft.entry : undefined,
        status: 'EXECUTED',
        createdAt: nowIso(),
        executedAt: nowIso(),
        avgFill: draft.entry,
        mode: 'PAPER',
        signalId: draft.signal.id,
        stop: draft.stop,
        target: draft.target,
        charges,
      }

      setState((current) => {
        const position = {
          id: uid('pos'),
          symbol: draft.signal.symbol,
          name: draft.signal.name,
          sector: draft.signal.sector,
          qty: decision.qty,
          avgPrice: draft.entry,
          lastPrice: draft.signal.price,
          stop: draft.stop,
          target: draft.target,
          openedAt: nowIso(),
          strategy: draft.signal.strategy,
          riskAmount: decision.riskAmount,
        }
        return {
          ...current,
          orders: [order, ...current.orders],
          positions: [position, ...current.positions],
          logs: [
            {
              id: uid('log'),
              at: nowIso(),
              level: 'SUCCESS' as const,
              source: 'paper-broker',
              message: `${draft.signal.symbol} · PAPER BUY ${decision.qty} @ ₹${draft.entry.toFixed(2)} filled`,
            },
            ...current.logs,
          ].slice(0, 80),
        }
      })
      addToast({
        tone: 'success',
        title: 'Paper order filled',
        message: `${draft.signal.symbol} · ${decision.qty} shares @ ₹${draft.entry.toFixed(2)}`,
      })
      return { ok: true, message: 'Paper order filled.' }
    },
    [addToast, portfolio.cash, portfolio.dayPnl, state],
  )

  const cancelOrder = useCallback(
    (orderId: string) => {
      setState((current) => {
        const order = current.orders.find((item) => item.id === orderId)
        if (!order || order.status !== 'PENDING') return current
        return {
          ...current,
          orders: current.orders.map((item) =>
            item.id === orderId ? { ...item, status: 'CANCELLED' } : item,
          ),
          logs: [
            {
              id: uid('log'),
              at: nowIso(),
              level: 'INFO' as const,
              source: 'orders',
              message: `${order.symbol} working order cancelled`,
            },
            ...current.logs,
          ].slice(0, 80),
        }
      })
      addToast({ tone: 'info', title: 'Order cancelled' })
    },
    [addToast],
  )

  const closePosition = useCallback(
    (positionId: string) => {
      setState((current) => {
        const position = current.positions.find((item) => item.id === positionId)
        if (!position) return current
        const charges = estimateCharges(position.lastPrice * position.qty, current.risk, 2).total
        const gross = (position.lastPrice - position.avgPrice) * position.qty
        const pnl = gross - charges
        const order: Order = {
          id: uid('ord'),
          symbol: position.symbol,
          name: position.name,
          side: 'SELL',
          qty: position.qty,
          type: 'MARKET',
          status: 'EXECUTED',
          createdAt: nowIso(),
          executedAt: nowIso(),
          avgFill: position.lastPrice,
          mode: 'PAPER',
          stop: position.stop,
          target: position.target,
          charges,
        }
        const trade = {
          id: uid('tr'),
          symbol: position.symbol,
          name: position.name,
          side: 'LONG' as const,
          qty: position.qty,
          entry: position.avgPrice,
          exit: position.lastPrice,
          pnl,
          pnlPct: (pnl / (position.avgPrice * position.qty)) * 100,
          openedAt: position.openedAt,
          closedAt: nowIso(),
          holdingDays: Math.max(
            1,
            Math.round((Date.now() - new Date(position.openedAt).getTime()) / 86_400_000),
          ),
          strategy: position.strategy,
          setup: position.strategy.includes('Pullback')
            ? ('Pullback' as const)
            : ('Momentum' as const),
          notes: 'Closed from the paper position desk. Add a post-trade review.',
          tags: ['Paper', pnl >= 0 ? 'Winner' : 'Loss'],
          rMultiple:
            (position.lastPrice - position.avgPrice) /
            Math.max(0.01, position.avgPrice - position.stop),
        }
        return {
          ...current,
          positions: current.positions.filter((item) => item.id !== positionId),
          orders: [order, ...current.orders],
          journal: [trade, ...current.journal],
          risk: { ...current.risk, equity: current.risk.equity + pnl },
          logs: [
            {
              id: uid('log'),
              at: nowIso(),
              level: 'SUCCESS' as const,
              source: 'paper-broker',
              message: `${position.symbol} closed · P&L ₹${pnl.toFixed(0)} · journal entry created`,
            },
            ...current.logs,
          ].slice(0, 80),
        }
      })
      addToast({
        tone: 'success',
        title: 'Position closed in paper mode',
        message: 'P&L booked and journal entry created.',
      })
    },
    [addToast],
  )

  const setEntriesPaused = useCallback(
    (paused: boolean) => {
      setState((current) => ({
        ...current,
        entriesPaused: paused,
        logs: [
          {
            id: uid('log'),
            at: nowIso(),
            level: paused ? ('WARN' as const) : ('SUCCESS' as const),
            source: 'risk',
            message: paused
              ? 'Kill switch engaged · new entries suspended, open positions untouched'
              : 'New entries resumed by operator',
          },
          ...current.logs,
        ].slice(0, 80),
      }))
      addToast({
        tone: paused ? 'warning' : 'success',
        title: paused ? 'New entries suspended' : 'New entries resumed',
        message: paused
          ? 'Existing positions and orders were not changed.'
          : 'The risk governor will re-check every order.',
      })
    },
    [addToast],
  )

  const updateRisk = useCallback(
    (config: RiskConfig) => {
      const errors = validateRiskConfig(config)
      if (errors.length > 0) return { ok: false, errors }
      setState((current) => ({
        ...current,
        risk: config,
        logs: [
          {
            id: uid('log'),
            at: nowIso(),
            level: 'INFO' as const,
            source: 'risk',
            message: `Risk configuration updated · ${config.riskPerTradePct.toFixed(2)}% / trade · ${config.maxOpenPositions} positions max`,
          },
          ...current.logs,
        ].slice(0, 80),
      }))
      addToast({ tone: 'success', title: 'Risk policy saved', message: 'New limits apply to every paper order.' })
      return { ok: true, errors: [] }
    },
    [addToast],
  )

  const addJournalNote = useCallback(
    (draft: JournalDraft) => {
      setState((current) => ({
        ...current,
        journal: current.journal.map((trade) =>
          trade.id === draft.tradeId ? { ...trade, notes: draft.notes, tags: draft.tags } : trade,
        ),
      }))
      addToast({ tone: 'success', title: 'Journal review saved' })
    },
    [addToast],
  )

  const runScan = useCallback(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 900))
    setState((current) => ({
      ...current,
      lastScanAt: nowIso(),
      logs: [
        {
          id: uid('log'),
          at: nowIso(),
          level: 'SUCCESS' as const,
          source: 'scanner',
          message: 'Scan completed · 1,842 symbols evaluated · 14 candidates emitted · demo feed',
        },
        ...current.logs,
      ].slice(0, 80),
    }))
    addToast({
      tone: 'success',
      title: 'Demo scan complete',
      message: '1,842 symbols evaluated from the local fixture. No live market feed was used.',
    })
  }, [addToast])

  const runSystemAction = useCallback(
    (actionId: string, label: string) => {
      setState((current) => ({
        ...current,
        logs: [
          {
            id: uid('log'),
            at: nowIso(),
            level: 'INFO' as const,
            source: 'operator',
            message: `${label} requested (${actionId}) · browser simulation only, engine not connected`,
          },
          ...current.logs,
        ].slice(0, 80),
      }))
      addToast({
        tone: 'info',
        title: `${label} recorded`,
        message: 'No trading engine was contacted. This runtime has no authenticated engine bridge.',
      })
    },
    [addToast],
  )

  const toggleNotifications = useCallback(() => {
    setState((current) => ({
      ...current,
      notificationsEnabled: !current.notificationsEnabled,
    }))
  }, [])

  const resetDemo = useCallback(() => {
    setState(INITIAL_STATE)
    addToast({
      tone: 'info',
      title: 'Demo state reset',
      message: 'Paper orders and journal changes were cleared locally.',
    })
  }, [addToast])

  const lockSession = useCallback(() => {
    setState((current) => ({ ...current, sessionLocked: true }))
    addToast({ tone: 'info', title: 'Session locked locally' })
  }, [addToast])

  const unlockSession = useCallback((passphrase: string) => {
    if (passphrase.trim().toLowerCase() !== 'demo') return false
    setState((current) => ({ ...current, sessionLocked: false }))
    addToast({ tone: 'success', title: 'Demo session unlocked' })
    return true
  }, [addToast])

  const value = useMemo<AppContextValue>(
    () => ({
      state,
      portfolio,
      toasts,
      backend,
      refreshBackend,
      addToast,
      dismissToast,
      toggleWatchlist,
      placePaperOrder,
      cancelOrder,
      closePosition,
      setEntriesPaused,
      updateRisk,
      addJournalNote,
      runScan,
      runSystemAction,
      toggleNotifications,
      resetDemo,
      lockSession,
      unlockSession,
    }),
    [
      state,
      portfolio,
      toasts,
      backend,
      refreshBackend,
      addToast,
      dismissToast,
      toggleWatchlist,
      placePaperOrder,
      cancelOrder,
      closePosition,
      setEntriesPaused,
      updateRisk,
      addJournalNote,
      runScan,
      runSystemAction,
      toggleNotifications,
      resetDemo,
      lockSession,
      unlockSession,
    ],
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp(): AppContextValue {
  const context = useContext(AppContext)
  if (!context) throw new Error('useApp must be used inside AppProvider')
  return context
}
