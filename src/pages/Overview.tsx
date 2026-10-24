import { useState } from 'react'
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Database,
  LineChart,
  Play,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Target,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import type { PageId, Signal } from '../types'
import { DATA_AS_OF, EQUITY_CURVE, SIGNALS } from '../data/market'
import { useApp } from '../lib/store'
import { inr, pct, shortDateTime, timeAgo } from '../lib/format'
import { Button, MiniSparkline, PageHeader, Pill, ProgressBar, StatusDot } from '../components/ui'
import { EquityChart } from '../components/charts'
import { DemoBanner } from '../components/layout'

export function Overview({
  navigate,
  openSignal,
}: {
  navigate: (page: PageId) => void
  openSignal: (signal: Signal) => void
}) {
  const { state, portfolio, runScan, addToast } = useApp()
  const [scanning, setScanning] = useState(false)

  const topSignals = [...SIGNALS].sort((a, b) => b.score - a.score).slice(0, 4)
  const exposureTone = portfolio.exposurePct > 55 ? 'red' : portfolio.exposurePct > 45 ? 'amber' : 'lime'
  const riskPct = (portfolio.openRisk / portfolio.equity) * 100

  async function scan() {
    setScanning(true)
    await runScan()
    setScanning(false)
  }

  return (
    <>
      <PageHeader
        eyebrow="NSE · Swing desk · Paper account"
        title="Command overview"
        subtitle="One view of capital, risk, scanner output and system health. Every figure below is simulated fixture data until a private engine bridge is configured."
        actions={
          <>
            <Button variant="ghost" onClick={() => addToast({ tone: 'info', title: 'Snapshot pinned', message: 'Demo overview snapshot prepared for review.' })}>
              <BarChart3 /> Snapshot
            </Button>
            <Button variant="primary" onClick={scan} disabled={scanning}>
              {scanning ? <RefreshCw className="spin" style={{ animation: 'spin 1s linear infinite' }} /> : <Play />}
              {scanning ? 'Scanning…' : 'Run demo scan'}
            </Button>
          </>
        }
      />
      <DemoBanner onSystem={() => navigate('system')} />

      <section className="kpi-grid" aria-label="Portfolio summary">
        <div className="card kpi-card featured">
          <div className="kpi-label">
            <Wallet /> Account equity <Pill tone="lime">Paper</Pill>
          </div>
          <div className="kpi-value">{inr(portfolio.equity)}</div>
          <div className="kpi-delta">
            <span className="chip">
              <ArrowUpRight size={10} /> {pct(portfolio.totalPnlPct)}
            </span>
            <span>{inr(portfolio.totalPnl)} total</span>
          </div>
          <div className="kpi-spark" aria-hidden="true">
            <MiniSparkline data={EQUITY_CURVE.slice(-42).map((point) => point.equity)} width={90} height={44} fill />
          </div>
        </div>
        <div className="card kpi-card">
          <div className="kpi-label">
            <TrendingUp /> Today's P&amp;L
          </div>
          <div className="kpi-value pos">{inr(portfolio.dayPnl)}</div>
          <div className="kpi-delta">
            <span className="chip">
              <ArrowUpRight size={10} /> {pct(portfolio.dayPnlPct)}
            </span>
            <span>vs prior close</span>
          </div>
        </div>
        <div className="card kpi-card">
          <div className="kpi-label">
            <CircleDollarSign /> Unrealised P&amp;L
          </div>
          <div className="kpi-value pos">{inr(portfolio.unrealised)}</div>
          <div className="kpi-delta">
            <span className="chip">
              <ArrowUpRight size={10} /> {pct(portfolio.unrealisedPct)}
            </span>
            <span>on {inr(portfolio.invested)} invested</span>
          </div>
        </div>
        <div className="card kpi-card">
          <div className="kpi-label">
            <ShieldAlert /> Open risk
          </div>
          <div className="kpi-value">{inr(portfolio.openRisk)}</div>
          <div className="kpi-delta">
            <span className="chip">{riskPct.toFixed(2)}% of equity</span>
            <span>{portfolio.openPositions} positions</span>
          </div>
        </div>
      </section>

      <section className="dashboard-grid">
        <div className="card chart-card">
          <div className="card-head" style={{ paddingBottom: 0 }}>
            <div>
              <div className="card-title-row">
                <LineChart className="icon-inline" />
                <h2 className="card-title">Equity curve</h2>
                <Pill tone="amber">Simulated</Pill>
              </div>
              <p className="card-sub">
                Strategy {portfolio.cagr.toFixed(1)}% CAGR · max drawdown {pct(portfolio.maxDrawdown)}
              </p>
            </div>
            <button type="button" className="section-link" onClick={() => navigate('research')}>
              Research <ChevronRight />
            </button>
          </div>
          <EquityChart data={EQUITY_CURVE} />
        </div>

        <div className="right-stack">
          <div className="card risk-card">
            <div className="engine-head">
              <div>
                <div className="card-title-row">
                  <ShieldCheck className="icon-inline" />
                  <h2 className="card-title">Risk posture</h2>
                </div>
                <p className="card-sub">Policy enforced before every entry</p>
              </div>
              <Pill tone={state.entriesPaused ? 'red' : 'mint'}>{state.entriesPaused ? 'Paused' : 'Governed'}</Pill>
            </div>
            <div className="risk-gauge-row">
              <div
                className="gauge"
                style={{ background: `conic-gradient(var(--${exposureTone === 'lime' ? 'lime' : exposureTone}) 0 ${portfolio.exposurePct}%, #1b2531 ${portfolio.exposurePct}% 100%)` }}
                aria-label={`Portfolio exposure ${portfolio.exposurePct.toFixed(1)} percent`}
              >
                <div className="gauge-center">
                  <div className="gauge-value">{portfolio.exposurePct.toFixed(0)}%</div>
                  <div className="gauge-label">Exposure</div>
                </div>
              </div>
              <div className="risk-metrics">
                <div className="risk-metric">
                  <span>Exposure limit</span>
                  <strong>{state.risk.maxPortfolioExposurePct}%</strong>
                </div>
                <div className="risk-metric">
                  <span>Open risk</span>
                  <strong>{riskPct.toFixed(2)}%</strong>
                </div>
                <div className="risk-metric">
                  <span>Positions</span>
                  <strong>
                    {portfolio.openPositions} / {state.risk.maxOpenPositions}
                  </strong>
                </div>
              </div>
            </div>
            <div className="budget-row">
              <div className="budget-labels">
                <span>Daily loss budget</span>
                <strong>
                  {inr(state.risk.equity * (state.risk.dailyLossLimitPct / 100))} limit · {inr(portfolio.dayPnl)} used
                </strong>
              </div>
              <ProgressBar value={Math.max(0, (portfolio.dayPnl / (state.risk.equity * (state.risk.dailyLossLimitPct / 100))) * 100)} tone={exposureTone} />
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 13 }}>
              <button type="button" className="section-link" onClick={() => navigate('risk')}>
                Risk center <ChevronRight />
              </button>
              <span style={{ color: 'var(--line-bright)' }}>·</span>
              <span className="mono" style={{ color: 'var(--muted-dim)', fontSize: 8.5 }}>
                {state.entriesPaused ? 'Entries suspended' : 'Entries permitted'}
              </span>
            </div>
          </div>

          <div className="card engine-card">
            <div className="engine-head">
              <div className="card-title-row">
                <Activity className="icon-inline" />
                <h2 className="card-title">System health</h2>
              </div>
              <span className="live-tag">
                <StatusDot tone="warn" pulse /> Fixture
              </span>
            </div>
            <div className="health-list">
              <div className="health-row">
                <span>Scheduler</span>
                <span className="health-state">
                  <StatusDot tone="warn" /> Awaiting bridge
                </span>
              </div>
              <div className="health-row">
                <span>Last demo scan</span>
                <span className="health-state">{shortDateTime(state.lastScanAt)}</span>
              </div>
              <div className="health-row">
                <span>Market data</span>
                <span className="health-state">
                  <StatusDot tone="warn" /> Fixture · 23 Oct
                </span>
              </div>
              <div className="health-row">
                <span>Kite session</span>
                <span className="health-state">
                  <StatusDot tone="bad" /> Not connected
                </span>
              </div>
              <div className="health-row">
                <span>Telegram alerts</span>
                <span className="health-state">
                  <StatusDot tone="warn" /> Not configured
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="overview-bottom">
        <div className="card table-card">
          <div className="section-head">
            <div>
              <h2>Open positions</h2>
              <p>
                {portfolio.openPositions} positions · {inr(portfolio.currentValue)} current value
              </p>
            </div>
            <button type="button" className="section-link" onClick={() => navigate('positions')}>
              View all <ChevronRight />
            </button>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Instrument</th>
                  <th>Qty</th>
                  <th>Avg</th>
                  <th>LTP</th>
                  <th>P&amp;L</th>
                  <th>Stop</th>
                  <th>Risk</th>
                </tr>
              </thead>
              <tbody>
                {state.positions.slice(0, 5).map((position) => {
                  const pnl = (position.lastPrice - position.avgPrice) * position.qty
                  const pnlPct = ((position.lastPrice - position.avgPrice) / position.avgPrice) * 100
                  return (
                    <tr key={position.id}>
                      <td>
                        <div className="symbol-cell">
                          <span className="symbol-avatar">{position.symbol.slice(0, 2)}</span>
                          <div>
                            <div className="symbol-name">{position.symbol}</div>
                            <div className="symbol-company">{position.name}</div>
                          </div>
                        </div>
                      </td>
                      <td className="num">{position.qty}</td>
                      <td className="num">{inr(position.avgPrice, 2)}</td>
                      <td className="num">{inr(position.lastPrice, 2)}</td>
                      <td className={`num ${pnl >= 0 ? 'pos' : 'neg'}`}>
                        {pnl >= 0 ? '+' : ''}
                        {inr(pnl)} <span style={{ fontSize: 8 }}>({pct(pnlPct)})</span>
                      </td>
                      <td className="num neg">{inr(position.stop, 2)}</td>
                      <td className="num">{inr(position.riskAmount)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="section-head">
            <div>
              <h2>Scanner pulse</h2>
              <p>Top-ranked demo setups · {shortDateTime(DATA_AS_OF)}</p>
            </div>
            <button type="button" className="section-link" onClick={() => navigate('scanner')}>
              Scanner <ChevronRight />
            </button>
          </div>
          <div>
            {topSignals.map((signal) => (
              <button
                type="button"
                key={signal.id}
                className="signal-row"
                onClick={() => openSignal(signal)}
                style={{ width: '100%', borderLeft: 0, borderRight: 0, background: 'transparent', textAlign: 'left' }}
              >
                <span className="signal-score">{signal.score}</span>
                <span className="signal-main">
                  <span className="signal-name-row">
                    <span className="signal-symbol">{signal.symbol}</span>
                    <Pill tone={signal.setup === 'Breakout' ? 'lime' : signal.setup === 'Pullback' ? 'cyan' : 'violet'}>
                      {signal.setup}
                    </Pill>
                  </span>
                  <span className="signal-desc">{signal.strategy} · RS {signal.rsRank}</span>
                </span>
                <MiniSparkline data={signal.spark} positive={signal.changePct >= 0} width={47} height={19} />
                <span className="signal-price">
                  {inr(signal.price, 1)}
                  <span className={signal.changePct >= 0 ? 'pos' : 'neg'}>{pct(signal.changePct)}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="page-grid grid-main-side" style={{ marginTop: 10 }}>
        <div className="card">
          <div className="section-head">
            <div>
              <h2>Recent activity</h2>
              <div className="card-sub">Browser demo ledger · latest events</div>
            </div>
            <button type="button" className="section-link" onClick={() => navigate('system')}>
              System logs <ChevronRight />
            </button>
          </div>
          <div className="feed">
            {state.logs.slice(0, 4).map((log) => {
              const tone = log.level === 'SUCCESS' ? 'good' : log.level === 'WARN' ? 'warn' : log.level === 'ERROR' ? 'bad' : ''
              const Icon = log.source === 'scanner' ? Target : log.source === 'market-data' ? Database : log.source === 'kite' ? ShieldAlert : log.source === 'risk' ? ShieldCheck : log.source === 'orders' ? CircleDollarSign : Clock3
              return (
                <div className="feed-row" key={log.id}>
                  <div className={`feed-icon ${tone}`}>
                    <Icon />
                  </div>
                  <div className="feed-main">
                    <div className="feed-title">
                      <strong>{log.source}</strong> · {log.message}
                    </div>
                    <div className="feed-meta">{timeAgo(log.at)} · {shortDateTime(log.at)}</div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
        <div className="card" style={{ padding: 16 }}>
          <div className="card-title-row">
            <Target className="icon-inline" />
            <h2 className="card-title">Today's discipline</h2>
          </div>
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[
              { label: 'Trades inside risk plan', value: '6 / 6', tone: 'pos' as const },
              { label: 'Stop-losses attached', value: '100%', tone: 'pos' as const },
              { label: 'Revenge-trade flags', value: '0', tone: 'pos' as const },
              { label: 'Daily loss budget used', value: '0%', tone: 'muted' as const },
            ].map((item) => (
              <div key={item.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingBottom: 9, borderBottom: '1px solid var(--line-soft)' }}>
                <span style={{ color: 'var(--muted)', fontSize: 9.5 }}>{item.label}</span>
                <span className={`mono ${item.tone}`} style={{ fontSize: 10 }}>{item.value}</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 12 }}>
            <ArrowDownRight size={12} color="var(--amber)" aria-hidden="true" />
            <span style={{ color: 'var(--muted-dim)', fontSize: 8.5 }}>
              Research is not qualified. Do not deploy capital based on this fixture.
            </span>
          </div>
        </div>
      </section>

      <div className="mono" style={{ marginTop: 13, color: 'var(--muted-dim)', fontSize: 8, textAlign: 'center' }}>
        Demo fixture generated locally · not live market data · cash {inr(portfolio.cash)} · invested {inr(portfolio.invested)}
      </div>
    </>
  )
}
