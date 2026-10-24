import { useMemo, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  BellOff,
  Database,
  Flame,
  KeyRound,
  ListChecks,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Server,
  ShieldAlert,
  Siren,
  Terminal,
  WifiOff,
} from 'lucide-react'
import { useApp } from '../lib/store'
import { RESEARCH } from '../data/market'
import { apiBaseLabel } from '../lib/api'
import { inr, shortDateTime, timeAgo } from '../lib/format'
import { Button, ConfirmDialog, PageHeader, Pill, StatusDot } from '../components/ui'

interface PendingAction {
  id: string
  label: string
  description: string
  confirmLabel: string
}

const HEALTH = [
  {
    label: 'Trading engine',
    value: 'Blocked',
    detail: '/root/pa-swing-kite not readable',
    tone: 'bad' as const,
    icon: Server,
  },
  {
    label: 'Scheduler',
    value: 'Idle',
    detail: 'No authenticated cron bridge',
    tone: 'warn' as const,
    icon: Activity,
  },
  {
    label: 'Private database',
    value: 'Unavailable',
    detail: 'Engine DB not mounted',
    tone: 'bad' as const,
    icon: Database,
  },
  {
    label: 'Market data',
    value: 'Demo fixture',
    detail: 'NSE close · 23 Oct 2026',
    tone: 'warn' as const,
    icon: ListChecks,
  },
  {
    label: 'Kite session',
    value: 'Disconnected',
    detail: 'No request token / API key',
    tone: 'bad' as const,
    icon: KeyRound,
  },
  {
    label: 'Telegram',
    value: 'Off',
    detail: 'Bot token & chat ID absent',
    tone: 'warn' as const,
    icon: BellOff,
  },
]

export function System() {
  const { state, portfolio, backend, runScan, runSystemAction, setEntriesPaused, addToast } = useApp()
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [logFilter, setLogFilter] = useState<'all' | 'errors' | 'risk'>('all')
  const [scanning, setScanning] = useState(false)

  const logs = useMemo(() => {
    if (logFilter === 'errors') return state.logs.filter((log) => log.level === 'ERROR' || log.level === 'WARN')
    if (logFilter === 'risk') return state.logs.filter((log) => log.source === 'risk' || log.message.toLowerCase().includes('risk'))
    return state.logs
  }, [state.logs, logFilter])

  const rejectedOrders = state.orders.filter((order) => order.status === 'REJECTED')
  const riskAlerts = state.logs.filter((log) => log.source === 'risk' && log.level === 'WARN')
  const backendOnline = backend.status === 'online'
  const telegramConfigured = backendOnline && backend.health.telegram_configured
  const healthCards = [
    ...HEALTH.slice(0, 1),
    {
      label: 'Local API',
      value: backend.status === 'online' ? 'Online' : backend.status === 'checking' ? 'Checking' : 'Offline',
      detail: backend.status === 'online' ? `${apiBaseLabel()} · ${backend.latencyMs} ms` : backend.status === 'offline' ? backend.error : 'Probing health endpoint',
      tone: (backend.status === 'online' ? 'good' : backend.status === 'checking' ? 'warn' : 'bad') as 'good' | 'warn' | 'bad',
      icon: Server,
    },
    {
      label: 'Paper ledger',
      value: 'Browser local',
      detail: 'Not routed to server ledger',
      tone: 'warn' as const,
      icon: Database,
    },
    ...HEALTH.slice(1).map((card) =>
      card.label === 'Telegram'
        ? {
            ...card,
            value: telegramConfigured ? 'Configured' : 'Off',
            detail: telegramConfigured ? 'Server-managed bot alerts' : 'Bot token & chat ID absent',
            tone: telegramConfigured ? ('good' as const) : ('warn' as const),
          }
        : card,
    ),
  ]

  async function confirm() {
    if (!pending) return
    if (pending.id === 'toggle-entries') {
      setEntriesPaused(!state.entriesPaused)
    } else if (pending.id === 'scan') {
      setScanning(true)
      await runScan()
      setScanning(false)
    } else {
      runSystemAction(pending.id, pending.label)
    }
    setPending(null)
  }

  return (
    <>
      <PageHeader
        eyebrow="Operations · Diagnostics & controls"
        title="System monitor"
        subtitle="Engine, broker, scheduler and alert health. Controls below are safe-by-default and never claim success without a backend confirmation."
        actions={
          <>
            <Button
              variant="ghost"
              onClick={() =>
                addToast({
                  tone: 'info',
                  title: 'Diagnostics copied',
                  message: 'Demo diagnostics snapshot prepared. No secret values are included.',
                })
              }
            >
              <Terminal /> Diagnostics
            </Button>
            <Button variant="primary" onClick={() => setPending({ id: 'refresh', label: 'Refresh market data', description: 'Record a data refresh request. The engine bridge is unavailable, so no feed will be contacted.', confirmLabel: 'Record request' })}>
              <RefreshCw /> Refresh data
            </Button>
          </>
        }
      />

      <div className="announce" style={{ borderColor: 'rgba(255,111,134,0.2)', background: 'rgba(255,111,134,0.045)', color: '#d4a2aa' }}>
        <WifiOff />
        <span>
          <strong>{backendOnline ? 'Local API is online; the trading engine is still disconnected.' : 'No backend bridge is connected.'}</strong>{' '}
          {backendOnline
            ? 'The health endpoint is reachable, but this UI remains on its browser ledger. It cannot start the Python engine, contact Kite, send Telegram messages, or place real orders.'
            : 'Actions on this page are recorded in the browser demo ledger. They cannot start the Python engine, contact Kite, send Telegram messages, or place/cancel real orders.'}
        </span>
      </div>

      <section className="health-grid" aria-label="System health">
        {healthCards.map((health) => {
          const Icon = health.icon
          return (
            <div className="card health-card" key={health.label}>
              <div className="health-card-top">
                <span className="health-card-label">{health.label}</span>
                <Icon className="icon-inline" />
              </div>
              <div className="health-card-value" style={{ color: health.tone === 'bad' ? 'var(--red)' : health.tone === 'warn' ? 'var(--amber)' : 'var(--mint)' }}>
                <StatusDot tone={health.tone} /> {health.value}
              </div>
              <div className="health-card-detail">{health.detail}</div>
            </div>
          )
        })}
      </section>

      <section className="page-grid grid-main-side">
        <div className="card">
          <div className="section-head">
            <div>
              <h2>Safe actions</h2>
              <p>Each action explains its scope and never implies a guaranteed outcome</p>
            </div>
            <Pill tone="amber">Demo controls</Pill>
          </div>
          <div className="card-body" style={{ paddingTop: 5 }}>
            <div className="action-grid">
              <button
                type="button"
                className="action-tile"
                disabled={scanning}
                onClick={() => setPending({ id: 'scan', label: 'Run scanner', description: 'Runs the browser demo scanner over the local fixture. It will not contact the trading engine or a market-data API.', confirmLabel: 'Run demo scan' })}
              >
                <div className="action-tile-title"><Play /> {scanning ? 'Running…' : 'Run scanner'}</div>
                <div className="action-tile-desc">Browser fixture scan only. Does not start the engine scheduler.</div>
              </button>
              <button
                type="button"
                className="action-tile"
                onClick={() => setPending({ id: 'refresh', label: 'Refresh market data', description: 'Record a data refresh request. No live feed is reachable from this static runtime.', confirmLabel: 'Record request' })}
              >
                <div className="action-tile-title"><RefreshCw /> Refresh market data</div>
                <div className="action-tile-desc">Records the request only. Market-data freshness remains fixture-based.</div>
              </button>
              <button
                type="button"
                className="action-tile"
                onClick={() => setPending({ id: 'backtest', label: 'Run backtest', description: 'Backtest execution requires the Python engine and its database. Nothing will run in this runtime.', confirmLabel: 'Record request' })}
              >
                <div className="action-tile-title"><Terminal /> Run backtest</div>
                <div className="action-tile-desc">Engine required. No backtest will execute and no result will be invented.</div>
              </button>
              <button
                type="button"
                className="action-tile"
                onClick={() => setPending({ id: 'toggle-entries', label: state.entriesPaused ? 'Resume new entries' : 'Pause new entries', description: 'Toggles the local entry desk only. Open positions and working orders are untouched. This is not a close-all command.', confirmLabel: state.entriesPaused ? 'Resume entries' : 'Pause entries' })}
              >
                <div className="action-tile-title">{state.entriesPaused ? <Play /> : <Pause />} {state.entriesPaused ? 'Resume new entries' : 'Pause new entries'}</div>
                <div className="action-tile-desc">Scope: new entries only. Does not cancel orders or close positions.</div>
              </button>
              <button
                type="button"
                className="action-tile"
                onClick={() => setPending({ id: 'reconcile', label: 'Reconcile broker & ledger', description: 'Reconciliation requires an authenticated Kite session. The local ledger can be inspected, but no broker comparison can occur.', confirmLabel: 'Run local check' })}
              >
                <div className="action-tile-title"><RotateCcw /> Reconcile</div>
                <div className="action-tile-desc">Broker disconnected. Result will remain unreconciled.</div>
              </button>
              <button
                type="button"
                className="action-tile"
                onClick={() => addToast({ tone: 'danger', title: 'Engine stop unavailable', message: 'The engine process is not reachable. No stop command was sent.' })}
              >
                <div className="action-tile-title"><Siren /> Stop engine</div>
                <div className="action-tile-desc">Disabled effectively — no engine bridge or process control exists.</div>
              </button>
            </div>

            <div className="detail-section-title">Action scope contract</div>
            <div className="detail-grid">
              <div className="detail-cell">
                <div className="detail-label">Pause entries</div>
                <div className="detail-value">Blocks new risk only</div>
              </div>
              <div className="detail-cell">
                <div className="detail-label">Cancel order</div>
                <div className="detail-value">Working order only</div>
              </div>
              <div className="detail-cell">
                <div className="detail-label">Close position</div>
                <div className="detail-value">Books P&amp;L · separate action</div>
              </div>
              <div className="detail-cell">
                <div className="detail-label">Stop engine</div>
                <div className="detail-value">Process-level · unavailable</div>
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="card">
            <div className="section-head">
              <div>
                <h2>Runtime status</h2>
                <p>Verified values only</p>
              </div>
              <StatusDot tone="warn" pulse />
            </div>
            <div className="card-body" style={{ paddingTop: 5 }}>
              {[
                { label: 'Execution mode', value: 'PAPER', tone: 'lime' },
                { label: 'Entries', value: state.entriesPaused ? 'PAUSED' : 'ACTIVE', tone: state.entriesPaused ? 'neg' : 'pos' },
                { label: 'Strategy version', value: RESEARCH.version, tone: '' },
                { label: 'Last successful scan', value: shortDateTime(state.lastScanAt), tone: '' },
                { label: 'Engine uptime', value: 'Unavailable', tone: 'neg' },
                { label: 'Kite token expiry', value: 'No token', tone: 'neg' },
                { label: 'Local API bind', value: backendOnline ? `${apiBaseLabel()} · ${backend.latencyMs} ms` : backend.status === 'checking' ? 'Checking…' : 'Offline', tone: backendOnline ? 'pos' : 'neg' },
                { label: 'Paper equity', value: inr(portfolio.equity), tone: '' },
              ].map((row) => (
                <div className="cost-row" key={row.label}>
                  <span>{row.label}</span>
                  <strong className={row.tone}>{row.value}</strong>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="section-head">
              <div>
                <h2>Alerts</h2>
                <p>{rejectedOrders.length} rejected orders · {riskAlerts.length} risk alerts</p>
              </div>
              <ShieldAlert className="icon-inline" />
            </div>
            <div className="card-body" style={{ paddingTop: 4 }}>
              <div className="risk-check">
                <span className="check-dot fail"><Flame /></span>
                <div className="check-main">
                  <div className="check-label">Kite disconnected</div>
                  <div className="check-detail">Live execution disabled. No token is stored.</div>
                </div>
              </div>
              <div className="risk-check">
                <span className="check-dot warn"><AlertTriangle /></span>
                <div className="check-main">
                  <div className="check-label">Telegram notifications off</div>
                  <div className="check-detail">Bot credentials are not configured; no alerts can be delivered.</div>
                </div>
              </div>
              <div className="risk-check">
                <span className="check-dot warn"><AlertTriangle /></span>
                <div className="check-main">
                  <div className="check-label">Engine unreadable</div>
                  <div className="check-detail">The private engine directory cannot be inspected from this runtime.</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="page-grid grid-main-side" style={{ marginTop: 10 }}>
        <div className="card">
          <div className="section-head">
            <div>
              <h2>System log</h2>
              <p>Browser demo events · timezone IST</p>
            </div>
            <div className="tab-list" role="tablist" aria-label="Log filter">
              {(['all', 'errors', 'risk'] as const).map((filter) => (
                <button
                  type="button"
                  key={filter}
                  className={logFilter === filter ? 'active' : ''}
                  onClick={() => setLogFilter(filter)}
                  role="tab"
                  aria-selected={logFilter === filter}
                >
                  {filter}
                </button>
              ))}
            </div>
          </div>
          <div className="log-list">
            {logs.map((log) => (
              <div className="log-row" key={log.id}>
                <div className="log-time">{new Date(log.at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })}</div>
                <div className="log-source" style={{ color: log.level === 'ERROR' ? 'var(--red)' : log.level === 'WARN' ? 'var(--amber)' : undefined }}>
                  {log.source}
                </div>
                <div className={`log-message ${log.level === 'ERROR' ? 'error' : ''}`.trim()}>
                  {log.message}
                  <span style={{ color: 'var(--muted-dim)', marginLeft: 7, fontFamily: 'var(--font-mono)', fontSize: 7.5 }}>{timeAgo(log.at)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="section-head">
            <div>
              <h2>Configuration</h2>
              <p>No credential values are displayed</p>
            </div>
            <KeyRound className="icon-inline" />
          </div>
          <div className="card-body" style={{ paddingTop: 5 }}>
            {[
              { label: 'Kite API key', value: 'Not present' },
              { label: 'Kite access token', value: 'Not present' },
              { label: 'Kite token expiry', value: 'N/A' },
              { label: 'Telegram bot token', value: telegramConfigured ? 'Server-managed' : 'Not present' },
              { label: 'Telegram chat ID', value: telegramConfigured ? 'Server-managed' : 'Not present' },
              { label: 'Engine database', value: 'Not mounted' },
              { label: 'Local backend', value: backendOnline ? `${apiBaseLabel()} (online)` : 'Offline' },
              { label: 'Authentication', value: backendOnline ? 'Server auth available · signed out' : 'Local demo session' },
            ].map((row) => (
              <div className="cost-row" key={row.label}>
                <span>{row.label}</span>
                <strong className={row.value === 'Not present' || row.value === 'Not mounted' || row.value.includes('offline') ? 'neg' : ''}>{row.value}</strong>
              </div>
            ))}
            <div className="explanation" style={{ marginTop: 12 }}>
              Secrets belong in backend environment variables with restrictive file permissions. They are never stored in
              the frontend bundle, localStorage, logs or API responses.
            </div>
          </div>
        </div>
      </section>

      <ConfirmDialog
        open={pending !== null}
        onClose={() => setPending(null)}
        onConfirm={confirm}
        title={pending?.label ?? 'Confirm action'}
        subtitle="Review the exact scope before proceeding."
        confirmLabel={pending?.confirmLabel ?? 'Confirm'}
        disabled={scanning}
      >
        <div className="explanation">{pending?.description}</div>
        {pending?.id === 'toggle-entries' ? (
          <div className="announce" style={{ marginTop: 10 }}>
            <AlertTriangle />
            <span>
              <strong>Scope check.</strong> Pausing/resuming entries does not cancel working orders and does not close any
              position. Use Orders and Positions for those actions separately.
            </span>
          </div>
        ) : null}
        {pending?.id === 'reconcile' ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 10 }}>
            <StatusDot tone="bad" />
            <span style={{ color: 'var(--red)', fontSize: 9 }}>Expected result: UNRECONCILED (broker disconnected).</span>
          </div>
        ) : null}
      </ConfirmDialog>
    </>
  )
}
