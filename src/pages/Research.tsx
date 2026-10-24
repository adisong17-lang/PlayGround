import { useState } from 'react'
import {
  AlertOctagon,
  ArrowDownRight,
  ArrowUpRight,
  BookOpenCheck,
  CircleAlert,
  Download,
  FlaskConical,
  Info,
  ShieldAlert,
  ShieldX,
  X,
} from 'lucide-react'
import { EQUITY_CURVE, RESEARCH } from '../data/market'
import { useApp } from '../lib/store'
import { pct } from '../lib/format'
import { Button, Modal, PageHeader, Pill, ProgressBar } from '../components/ui'
import { EquityChart } from '../components/charts'

const GAPS = [
  {
    title: 'Kite adapter implementation',
    status: 'BLOCKED',
    tone: 'red',
    detail: 'The private engine at /root/pa-swing-kite is unreadable in this runtime. Adapter code cannot be inspected or exercised.',
  },
  {
    title: 'Kite Connect dependency',
    status: 'UNVERIFIED',
    tone: 'amber',
    detail: 'Dependency installation is not provable without engine access. No broker SDK is bundled in the dashboard.',
  },
  {
    title: 'risk_pct in the main backtest path',
    status: 'RE-VERIFY',
    tone: 'amber',
    detail: 'Previously reported as ineffective. This must be traced through the actual backtest entry path before any result is trusted.',
  },
  {
    title: 'Portfolio risk governance',
    status: 'RE-VERIFY',
    tone: 'amber',
    detail: 'Previously reported as disabled. The dashboard has its own risk engine, but that does not prove the trading engine enforces the same policy.',
  },
  {
    title: 'Daily loss protection',
    status: 'RE-VERIFY',
    tone: 'amber',
    detail: 'A missing daily loss circuit breaker remains an open concern. Runtime demo implements the check, engine integration does not.',
  },
  {
    title: 'Slippage & gap modelling',
    status: 'INCOMPLETE',
    tone: 'red',
    detail: 'The demo models 8 bps slippage and a 0.5% gap buffer. This is not a validated execution model and may understate real impact.',
  },
  {
    title: 'Historical drawdown & qualification',
    status: 'FAILED',
    tone: 'red',
    detail: 'Illustrative max drawdown is -14.8%, beyond the -12% gate. The fixture does not qualify for live allocation.',
  },
]

const EVIDENCE_ROWS = [
  { period: 'In-sample fixture', cagr: '18.4%', sharpe: '1.12', maxDd: '-14.8%', trades: '138', status: 'Illustrative only' },
  { period: 'Out-of-sample', cagr: 'Not run', sharpe: 'Not run', maxDd: 'Not run', trades: '0', status: 'Blocked' },
  { period: 'Walk-forward', cagr: 'Not run', sharpe: 'Not run', maxDd: 'Not run', trades: '0', status: 'Insufficient data' },
  { period: 'NIFTY 50 benchmark', cagr: '11.2%', sharpe: '0.78', maxDd: '-9.4%', trades: '—', status: 'Fixture' },
]

export function Research() {
  const { addToast } = useApp()
  const [auditOpen, setAuditOpen] = useState(false)
  const passedGates = RESEARCH.gates.filter((gate) => gate.passed).length

  return (
    <>
      <PageHeader
        eyebrow="Strategy research · Unvalidated fixture"
        title="Strategy research"
        subtitle="Research evidence, cost drag and qualification gates for the PA Swing system. No engine audit or out-of-sample result is available in this runtime."
        actions={
          <>
            <Button variant="ghost" onClick={() => setAuditOpen(true)}>
              <ShieldAlert /> Engine audit
            </Button>
            <Button
              variant="primary"
              onClick={() =>
                addToast({
                  tone: 'warning',
                  title: 'Research export blocked',
                  message: 'A verified research package cannot be generated until the engine is audited.',
                })
              }
            >
              <Download /> Export evidence
            </Button>
          </>
        }
      />

      <div className="announce" style={{ borderColor: 'rgba(255,111,134,0.2)', background: 'rgba(255,111,134,0.045)', color: '#d4a2aa' }}>
        <AlertOctagon />
        <span>
          <strong>Do not deploy capital based on this page.</strong> Metrics are demonstration fixtures. The strategy has
          failed its drawdown gate, out-of-sample tests are absent, and the private trading engine could not be inspected.
        </span>
      </div>

      <section className="research-hero">
        <div className="research-hero-top">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <Pill tone="red"><ShieldX size={10} /> {RESEARCH.qualification}</Pill>
              <Pill tone="amber">Demo fixture</Pill>
              <Pill tone="neutral">{RESEARCH.version}</Pill>
            </div>
            <h2>{RESEARCH.strategyName}</h2>
            <p>{RESEARCH.qualificationDetail}</p>
          </div>
          <div style={{ textAlign: 'right', flex: '0 0 auto' }}>
            <div className="mono" style={{ fontSize: 8.5, color: 'var(--muted-dim)', letterSpacing: '0.08em' }}>QUALIFICATION GATES</div>
            <div className="mono" style={{ fontSize: 25, letterSpacing: '-0.05em', marginTop: 2 }}>
              <span style={{ color: 'var(--red)' }}>{passedGates}</span>
              <span style={{ color: 'var(--muted-dim)' }}> / {RESEARCH.gates.length}</span>
            </div>
            <div style={{ color: 'var(--muted-dim)', fontSize: 8 }}>passed</div>
          </div>
        </div>
        <div className="research-metrics">
          {RESEARCH.metrics.map((metric) => (
            <div className="research-metric" key={metric.label}>
              <span>{metric.label}</span>
              <strong className={metric.label === 'Max drawdown' ? 'neg' : metric.label === 'Sharpe' ? 'lime' : ''}>
                {metric.value}
              </strong>
              <small>{metric.note}</small>
            </div>
          ))}
        </div>
      </section>

      <section className="page-grid grid-main-side">
        <div className="card">
          <div className="section-head">
            <div>
              <h2>Illustrative equity path</h2>
              <p>Demo fixture, not the engine's audited backtest</p>
            </div>
            <Pill tone="amber">Simulated</Pill>
          </div>
          <EquityChart data={EQUITY_CURVE} compact />
        </div>

        <div className="card">
          <div className="section-head">
            <div>
              <h2>Qualification gates</h2>
              <p>Promotion requires every gate to pass</p>
            </div>
            <Pill tone="red">Blocked</Pill>
          </div>
          <div className="card-body" style={{ paddingTop: 4 }}>
            <div className="gate-list">
              {RESEARCH.gates.map((gate) => (
                <div className="gate-row" key={gate.label}>
                  <span className={`gate-icon ${gate.passed ? 'pass' : 'fail'}`}>
                    {gate.passed ? <BookOpenCheck /> : <X />}
                  </span>
                  <span className="gate-name">{gate.label}</span>
                  <span className="gate-value">{gate.value}</span>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 13 }}>
              <div className="budget-labels">
                <span>Gate completion</span>
                <strong>{passedGates} / {RESEARCH.gates.length}</strong>
              </div>
              <ProgressBar value={(passedGates / RESEARCH.gates.length) * 100} tone="red" />
            </div>
            <div className="explanation" style={{ marginTop: 13, color: '#c9a0a8' }}>
              <CircleAlert size={11} style={{ display: 'inline', marginRight: 5, verticalAlign: -1 }} />
              The strongest backtest does not auto-deploy. Promotion requires verified out-of-sample evidence and explicit
              operator action.
            </div>
          </div>
        </div>
      </section>

      <section className="page-grid grid-2" style={{ marginTop: 10 }}>
        <div className="card">
          <div className="section-head">
            <div>
              <h2>Evidence matrix</h2>
              <p>Out-of-sample and walk-forward are not available</p>
            </div>
            <Pill tone="amber">Incomplete</Pill>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Period</th>
                  <th>CAGR</th>
                  <th>Sharpe</th>
                  <th>Max DD</th>
                  <th>Trades</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {EVIDENCE_ROWS.map((row) => (
                  <tr key={row.period}>
                    <td style={{ color: 'var(--text-soft)' }}>{row.period}</td>
                    <td className={`num ${row.cagr.includes('Not') ? 'text-dim' : ''}`}>{row.cagr}</td>
                    <td className={`num ${row.sharpe.includes('Not') ? 'text-dim' : ''}`}>{row.sharpe}</td>
                    <td className={`num ${row.maxDd.startsWith('-14') ? 'neg' : row.maxDd.includes('Not') ? 'text-dim' : ''}`}>{row.maxDd}</td>
                    <td className="num">{row.trades}</td>
                    <td>
                      <Pill tone={row.status.includes('Blocked') || row.status.includes('Insufficient') ? 'red' : 'neutral'}>
                        {row.status}
                      </Pill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ padding: '10px 16px', borderTop: '1px solid var(--line-soft)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <span style={{ color: 'var(--muted-dim)', fontSize: 8.5 }}>Benchmark excess CAGR (fixture)</span>
              <span className="mono lime" style={{ fontSize: 9 }}>
                <ArrowUpRight size={10} style={{ verticalAlign: -1 }} /> 7.2%
              </span>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="section-head">
            <div>
              <h2>Cost &amp; turnover impact</h2>
              <p>Modelled, not stress-tested</p>
            </div>
            <Pill tone="amber">Incomplete</Pill>
          </div>
          <div className="card-body" style={{ paddingTop: 5 }}>
            {RESEARCH.costImpact.map((row, index) => (
              <div className={`cost-row ${index === RESEARCH.costImpact.length - 1 ? 'total' : ''}`} key={row.label}>
                <span>{row.label}</span>
                <strong className={row.value.startsWith('-') ? 'neg' : index === RESEARCH.costImpact.length - 1 ? 'pos' : ''}>
                  {row.value}
                </strong>
              </div>
            ))}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12 }}>
              <div className="metric-tile">
                <div className="metric-tile-label">Annual turnover</div>
                <div className="metric-tile-value" style={{ fontSize: 16 }}>6.2×</div>
                <div className="metric-tile-note">Demo estimate</div>
              </div>
              <div className="metric-tile">
                <div className="metric-tile-label">Avg holding period</div>
                <div className="metric-tile-value" style={{ fontSize: 16 }}>9.4d</div>
                <div className="metric-tile-note">138 trades</div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7, marginTop: 12 }}>
              <Info size={12} color="var(--amber)" style={{ marginTop: 1, flex: '0 0 auto' }} />
              <span style={{ color: 'var(--muted-dim)', fontSize: 8.5, lineHeight: 1.5 }}>
                Costs assume 8 bps slippage, ₹20 brokerage per leg, taxes and a 0.5% gap buffer. Real fills may be worse.
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="page-grid grid-2" style={{ marginTop: 10 }}>
        <div className="card">
          <div className="section-head">
            <div>
              <h2>Monthly return fixture</h2>
              <p>Illustrative only · small sample</p>
            </div>
            <Pill tone="amber">Demo</Pill>
          </div>
          <div className="card-body">
            <div className="month-bars">
              {RESEARCH.monthly.map((month) => {
                const max = Math.max(...RESEARCH.monthly.map((item) => Math.abs(item.value)), 1)
                const height = (Math.abs(month.value) / max) * 80
                return (
                  <div className="month-bar" key={month.month}>
                    <div className="month-bar-track">
                      <div className={`month-bar-fill ${month.value < 0 ? 'neg' : ''}`.trim()} style={{ height: `${Math.max(5, height)}%` }} title={`${pct(month.value)}`} />
                    </div>
                    <span className="month-bar-label">{month.month}</span>
                  </div>
                )
              })}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 9 }}>
              <span style={{ color: 'var(--muted-dim)', fontSize: 8.5 }}>
                <ArrowUpRight size={10} color="var(--mint)" style={{ verticalAlign: -1 }} /> 9 positive months
              </span>
              <span style={{ color: 'var(--muted-dim)', fontSize: 8.5 }}>
                <ArrowDownRight size={10} color="var(--red)" style={{ verticalAlign: -1 }} /> 3 negative months
              </span>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="section-head">
            <div>
              <h2>Benchmark &amp; robustness</h2>
              <p>Fixture comparison. Robustness evidence missing.</p>
            </div>
            <Pill tone="red">Not verified</Pill>
          </div>
          <div className="card-body" style={{ paddingTop: 4 }}>
            {[
              { label: 'Strategy CAGR', value: '18.4%', tone: 'lime' },
              { label: 'NIFTY 50 CAGR', value: '11.2%', tone: '' },
              { label: 'Excess return', value: '+7.2%', tone: 'pos' },
              { label: 'Sharpe (strategy)', value: '1.12', tone: '' },
              { label: 'Max drawdown gate', value: 'FAILED', tone: 'neg' },
              { label: 'Monte Carlo / parameter sensitivity', value: 'NOT RUN', tone: 'neg' },
            ].map((row) => (
              <div className="cost-row" key={row.label}>
                <span>{row.label}</span>
                <strong className={row.tone}>{row.value}</strong>
              </div>
            ))}
            <div className="announce" style={{ marginTop: 12, marginBottom: 0 }}>
              <FlaskConical />
              <span>Benchmark and return figures are fixture values, not a verified research result.</span>
            </div>
          </div>
        </div>
      </section>

      <section className="card" style={{ marginTop: 10 }}>
        <div className="section-head">
          <div>
            <h2>Engine audit · known implementation gaps</h2>
            <p>Issues that must be re-verified inside /root/pa-swing-kite before integration</p>
          </div>
          <Button size="small" variant="ghost" onClick={() => setAuditOpen(true)}>
            <ShieldAlert /> Audit detail
          </Button>
        </div>
        <div className="card-body" style={{ paddingTop: 5, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '0 22px' }}>
          {GAPS.map((gap) => (
            <div className="risk-check" key={gap.title}>
              <span className={`check-dot ${gap.tone === 'red' ? 'fail' : 'warn'}`}>
                <CircleAlert />
              </span>
              <div className="check-main">
                <div className="check-label" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  {gap.title}
                  <Pill tone={gap.tone === 'red' ? 'red' : 'amber'}>{gap.status}</Pill>
                </div>
                <div className="check-detail">{gap.detail}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <Modal
        open={auditOpen}
        onClose={() => setAuditOpen(false)}
        title="Engine audit status"
        subtitle="The dashboard will not claim capabilities it could not verify."
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setAuditOpen(false)}>Close</Button>
            <Button
              variant="primary"
              onClick={() => {
                addToast({
                  tone: 'info',
                  title: 'Audit request recorded locally',
                  message: 'Mount /root/pa-swing-kite with read access and supply a documented bridge before integrating.',
                })
                setAuditOpen(false)
              }}
            >
              Record request
            </Button>
          </>
        }
      >
        <div className="announce" style={{ marginTop: 0 }}>
          <ShieldAlert />
          <span>
            <strong>Runtime blocker.</strong> The engine directory /root/pa-swing-kite cannot be read by this process
            (permission denied). No files were modified and none of its behaviour is asserted.
          </span>
        </div>
        <div className="detail-grid">
          <div className="detail-cell">
            <div className="detail-label">Engine path</div>
            <div className="detail-value" style={{ fontSize: 8.5 }}>/root/pa-swing-kite</div>
          </div>
          <div className="detail-cell">
            <div className="detail-label">Read access</div>
            <div className="detail-value neg">Permission denied</div>
          </div>
          <div className="detail-cell">
            <div className="detail-label">Kite session</div>
            <div className="detail-value neg">Not connected</div>
          </div>
          <div className="detail-cell">
            <div className="detail-label">Strategy credentials</div>
            <div className="detail-value">Not present in dashboard</div>
          </div>
        </div>
        <div className="detail-section-title">Required before integration</div>
        <div className="explanation">
          Provide a read-only audit snapshot of the engine and database schema, verify the Kite adapter and dependency,
          prove risk_pct propagation, enable daily loss and portfolio governance, replace the slippage model, then run
          out-of-sample and walk-forward validation. Only after every qualification gate passes may an operator consider
          promotion. Execution must remain in PAPER mode until then.
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 12 }}>
          <Info size={12} color="var(--muted)" />
          <span style={{ color: 'var(--muted-dim)', fontSize: 8.5 }}>
            Account balance and return figures on this page are simulated. Nothing is connected to a real broker.
          </span>
        </div>
      </Modal>
    </>
  )
}
