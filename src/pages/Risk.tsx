import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  Calculator,
  CheckCircle2,
  Gauge,
  Lock,
  RotateCcw,
  Save,
  ShieldCheck,
  ShieldX,
  Siren,
  Wallet,
} from 'lucide-react'
import { SIGNALS } from '../data/market'
import { useApp } from '../lib/store'
import { calculatePositionSize, evaluateOrder, signalToIntent, validateRiskConfig } from '../lib/risk'
import { inr, pct } from '../lib/format'
import type { RiskConfig } from '../types'
import { Button, PageHeader, Pill, ProgressBar, Toggle } from '../components/ui'

export function Risk() {
  const { state, portfolio, updateRisk, setEntriesPaused, addToast } = useApp()
  const [draft, setDraft] = useState<RiskConfig>(state.risk)
  const [errors, setErrors] = useState<string[]>([])
  const [entry, setEntry] = useState(1052)
  const [stop, setStop] = useState(986)

  const calculator = calculatePositionSize(
    draft.equity,
    draft.riskPerTradePct,
    entry,
    stop,
    draft.gapRiskBufferPct,
  )
  const sampleSignal = SIGNALS.find((signal) => signal.symbol === 'JSWSTEEL') ?? SIGNALS[0]
  const sampleDecision = useMemo(
    () =>
      evaluateOrder(signalToIntent(sampleSignal), {
        config: draft,
        positions: state.positions,
        orders: state.orders,
        cash: portfolio.cash,
        dailyPnl: portfolio.dayPnl,
        monthlyDrawdownPct: -2.1,
        entriesPaused: state.entriesPaused,
        mode: state.mode,
      }),
    [sampleSignal, draft, state.positions, state.orders, portfolio.cash, portfolio.dayPnl, state.entriesPaused, state.mode],
  )

  const largest = Math.max(
    ...state.positions.map((position) => (position.lastPrice * position.qty) / portfolio.equity * 100),
    0,
  )
  const gapStress = portfolio.currentValue * 0.03
  const dailyLossLimit = draft.equity * (draft.dailyLossLimitPct / 100)
  const dailyLossUsed = Math.max(0, -portfolio.dayPnl)
  const monthlyDrawdown = 2.1

  function field<K extends keyof RiskConfig>(key: K, value: RiskConfig[K]) {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  function save() {
    const issues = validateRiskConfig(draft)
    setErrors(issues)
    if (issues.length > 0) {
      addToast({ tone: 'danger', title: 'Risk policy not saved', message: issues[0] })
      return
    }
    const result = updateRisk(draft)
    if (!result.ok) {
      addToast({ tone: 'danger', title: 'Risk policy rejected', message: result.errors[0] })
      return
    }
    setErrors([])
  }

  function reset() {
    setDraft(state.risk)
    setErrors([])
    addToast({ tone: 'info', title: 'Draft reset', message: 'Unsaved changes were discarded.' })
  }

  const exposureTone = portfolio.exposurePct > draft.maxPortfolioExposurePct * 0.85 ? 'red' : portfolio.exposurePct > draft.maxPortfolioExposurePct * 0.65 ? 'amber' : 'lime'

  return (
    <>
      <PageHeader
        eyebrow="Risk governance · Server-authoritative in production"
        title="Risk management"
        subtitle="Position sizing and portfolio limits with hard rejection checks. This demo enforces them in the paper execution layer; production enforcement must run server-side."
        actions={
          <>
            <Button variant="ghost" onClick={reset}>
              <RotateCcw /> Revert
            </Button>
            <Button variant="primary" onClick={save}>
              <Save /> Save policy
            </Button>
          </>
        }
      />

      <div className="mode-banner" style={{ borderColor: state.entriesPaused ? 'rgba(255,111,134,0.2)' : 'rgba(199,243,107,0.16)' }}>
        <div>
          <div className="mode-banner-title" style={{ color: state.entriesPaused ? 'var(--red)' : 'var(--lime)' }}>
            <Siren />
            {state.entriesPaused ? 'Kill switch active — new entries suspended' : 'Entry desk active — risk checks enforced'}
          </div>
          <p>
            {state.entriesPaused
              ? 'Open positions and working orders are untouched. Resume only after reviewing the risk breach.'
              : 'Pausing entries never closes positions or cancels working orders. Those are separate actions.'}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="mono" style={{ fontSize: 8.5, color: 'var(--muted)' }}>
            {state.entriesPaused ? 'PAUSED' : 'ACTIVE'}
          </span>
          <Toggle checked={state.entriesPaused} onChange={setEntriesPaused} label="Pause new entries" />
        </div>
      </div>

      <section className="summary-strip" aria-label="Current risk usage">
        <div className="summary-cell">
          <div className="summary-label">Portfolio exposure</div>
          <div className={`summary-value ${exposureTone === 'red' ? 'neg' : exposureTone === 'amber' ? 'lime' : ''}`}>
            {portfolio.exposurePct.toFixed(1)}%
          </div>
          <div className="summary-detail">Cap {draft.maxPortfolioExposurePct}% · {inr(portfolio.currentValue)}</div>
        </div>
        <div className="summary-cell">
          <div className="summary-label">Open risk at stops</div>
          <div className="summary-value">{inr(portfolio.openRisk)}</div>
          <div className="summary-detail">{((portfolio.openRisk / portfolio.equity) * 100).toFixed(2)}% of equity</div>
        </div>
        <div className="summary-cell">
          <div className="summary-label">Daily loss budget</div>
          <div className="summary-value">{inr(dailyLossUsed)} <span className="text-dim" style={{ fontSize: 10 }}>/ {inr(dailyLossLimit)}</span></div>
          <div className="summary-detail">{((dailyLossUsed / Math.max(1, dailyLossLimit)) * 100).toFixed(0)}% consumed</div>
        </div>
        <div className="summary-cell">
          <div className="summary-label">Open positions</div>
          <div className="summary-value">{portfolio.openPositions}<span className="text-dim" style={{ fontSize: 11 }}> / {draft.maxOpenPositions}</span></div>
          <div className="summary-detail">Largest {largest.toFixed(1)}% of equity</div>
        </div>
      </section>

      <div className="risk-layout">
        <div className="card">
          <div className="section-head">
            <div>
              <h2>Risk policy</h2>
              <p>Saved values apply to every preview and paper fill</p>
            </div>
            <Pill tone="mint"><ShieldCheck size={10} /> Governed</Pill>
          </div>
          <div className="card-body">
            {errors.length > 0 ? (
              <div className="announce" style={{ borderColor: 'rgba(255,111,134,0.24)', background: 'rgba(255,111,134,0.05)', color: '#e2a1ac', marginTop: 0 }}>
                <AlertTriangle />
                <span><strong>Validation failed.</strong> {errors.join(' ')}</span>
              </div>
            ) : null}
            <div className="form-grid">
              <div className="form-field">
                <label>Account equity</label>
                <div className="input-wrap with-prefix">
                  <span className="prefix">₹</span>
                  <input value={inr(draft.equity)} readOnly aria-label="Account equity" style={{ color: 'var(--muted)' }} />
                </div>
                <small>Read from the paper ledger, not editable here.</small>
              </div>
              <div className="form-field">
                <label htmlFor="risk-per-trade">Risk per trade</label>
                <div className="input-wrap with-suffix">
                  <input
                    id="risk-per-trade"
                    type="number"
                    step="0.05"
                    min="0"
                    max="5"
                    value={draft.riskPerTradePct}
                    onChange={(event) => field('riskPerTradePct', Number(event.target.value))}
                  />
                  <span className="suffix">%</span>
                </div>
                <small>Capital at risk from entry to stop. Hard maximum 5%.</small>
              </div>
              <div className="form-field">
                <label htmlFor="max-exposure">Max portfolio exposure</label>
                <div className="input-wrap with-suffix">
                  <input id="max-exposure" type="number" min="1" max="100" value={draft.maxPortfolioExposurePct} onChange={(event) => field('maxPortfolioExposurePct', Number(event.target.value))} />
                  <span className="suffix">%</span>
                </div>
                <small>Sum of position value as a share of equity.</small>
              </div>
              <div className="form-field">
                <label htmlFor="daily-loss">Daily loss limit</label>
                <div className="input-wrap with-suffix">
                  <input id="daily-loss" type="number" step="0.1" min="0" max="20" value={draft.dailyLossLimitPct} onChange={(event) => field('dailyLossLimitPct', Number(event.target.value))} />
                  <span className="suffix">%</span>
                </div>
                <small>New entries block when realised + unrealised daily loss breaches this.</small>
              </div>
              <div className="form-field">
                <label htmlFor="monthly-dd">Monthly drawdown limit</label>
                <div className="input-wrap with-suffix">
                  <input id="monthly-dd" type="number" step="0.1" min="0" max="30" value={draft.monthlyDrawdownLimitPct} onChange={(event) => field('monthlyDrawdownLimitPct', Number(event.target.value))} />
                  <span className="suffix">%</span>
                </div>
                <small>Automatic entry suspension at the limit.</small>
              </div>
              <div className="form-field">
                <label htmlFor="max-pos">Maximum concurrent positions</label>
                <div className="input-wrap no-prefix">
                  <input id="max-pos" type="number" min="1" max="50" value={draft.maxOpenPositions} onChange={(event) => field('maxOpenPositions', Number(event.target.value))} />
                </div>
                <small>Independent hard cap on open positions.</small>
              </div>
              <div className="form-field">
                <label htmlFor="liquidity">Minimum daily turnover</label>
                <div className="input-wrap with-prefix">
                  <span className="prefix">₹</span>
                  <input id="liquidity" type="number" min="0" value={draft.minLiquidityCr} onChange={(event) => field('minLiquidityCr', Number(event.target.value))} />
                </div>
                <small>Median traded value in crore.</small>
              </div>
              <div className="form-field">
                <label htmlFor="concentration">Single-name concentration cap</label>
                <div className="input-wrap with-suffix">
                  <input id="concentration" type="number" min="1" max="100" value={draft.maxConcentrationPct} onChange={(event) => field('maxConcentrationPct', Number(event.target.value))} />
                  <span className="suffix">%</span>
                </div>
                <small>No single symbol may exceed this share of equity.</small>
              </div>
              <div className="form-field">
                <label htmlFor="slippage">Slippage assumption</label>
                <div className="input-wrap with-suffix">
                  <input id="slippage" type="number" step="1" min="0" max="200" value={draft.slippageBps} onChange={(event) => field('slippageBps', Number(event.target.value))} />
                  <span className="suffix">bps</span>
                </div>
                <small>Applied to both buy and sell notional in cost estimates.</small>
              </div>
              <div className="form-field">
                <label htmlFor="gap-buffer">Gap-risk buffer</label>
                <div className="input-wrap with-suffix">
                  <input id="gap-buffer" type="number" step="0.1" min="0" value={draft.gapRiskBufferPct} onChange={(event) => field('gapRiskBufferPct', Number(event.target.value))} />
                  <span className="suffix">%</span>
                </div>
                <small>Extra risk per share for overnight gaps in sizing.</small>
              </div>
              <div className="form-field">
                <label htmlFor="brokerage">Brokerage per order</label>
                <div className="input-wrap with-prefix">
                  <span className="prefix">₹</span>
                  <input id="brokerage" type="number" step="1" min="0" value={draft.brokeragePerOrder} onChange={(event) => field('brokeragePerOrder', Number(event.target.value))} />
                </div>
                <small>Per leg. Used in the paper cost model.</small>
              </div>
              <div className="form-field">
                <label htmlFor="taxes">Taxes &amp; charges</label>
                <div className="input-wrap with-suffix">
                  <input id="taxes" type="number" step="0.01" min="0" value={draft.taxesPct} onChange={(event) => field('taxesPct', Number(event.target.value))} />
                  <span className="suffix">%</span>
                </div>
                <small>STT, exchange, stamp, SEBI and GST estimate.</small>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 14 }}>
              <Lock size={11} color="var(--muted-dim)" />
              <span style={{ color: 'var(--muted-dim)', fontSize: 8.5, lineHeight: 1.5 }}>
                Frontend values are inputs only. In production, order rejection is performed by the backend risk service.
              </span>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="card">
            <div className="section-head">
              <div>
                <h2>Position size calculator</h2>
                <p>Equity × risk % ÷ effective stop distance</p>
              </div>
              <Calculator className="icon-inline" />
            </div>
            <div className="card-body" style={{ paddingTop: 4 }}>
              <div className="form-grid">
                <div className="form-field">
                  <label htmlFor="calc-entry">Entry</label>
                  <div className="input-wrap with-prefix">
                    <span className="prefix">₹</span>
                    <input id="calc-entry" type="number" value={entry} onChange={(event) => setEntry(Number(event.target.value))} />
                  </div>
                </div>
                <div className="form-field">
                  <label htmlFor="calc-stop">Stop</label>
                  <div className="input-wrap with-prefix">
                    <span className="prefix">₹</span>
                    <input id="calc-stop" type="number" value={stop} onChange={(event) => setStop(Number(event.target.value))} />
                  </div>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 11 }}>
                <div className="metric-tile">
                  <div className="metric-tile-label">Position size</div>
                  <div className="metric-tile-value lime" style={{ fontSize: 19 }}>{calculator.qty}</div>
                  <div className="metric-tile-note">shares</div>
                </div>
                <div className="metric-tile">
                  <div className="metric-tile-label">Capital at risk</div>
                  <div className="metric-tile-value" style={{ fontSize: 19 }}>{inr(calculator.riskAmount)}</div>
                  <div className="metric-tile-note">budget at {draft.riskPerTradePct}%</div>
                </div>
              </div>
              <div style={{ marginTop: 11 }}>
                <div className="cost-row">
                  <span>Risk per share</span>
                  <strong>{inr(calculator.riskPerShare, 2)}</strong>
                </div>
                <div className="cost-row">
                  <span>Order notional</span>
                  <strong>{inr(calculator.qty * entry)}</strong>
                </div>
                <div className="cost-row">
                  <span>Equity after entry</span>
                  <strong>{inr(draft.equity - calculator.qty * entry)}</strong>
                </div>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="section-head">
              <div>
                <h2>Stress envelope</h2>
                <p>What the current book can lose</p>
              </div>
              <Gauge className="icon-inline" />
            </div>
            <div className="card-body" style={{ paddingTop: 4 }}>
              <div className="cost-row">
                <span>All stops hit</span>
                <strong className="neg">-{inr(portfolio.openRisk)}</strong>
              </div>
              <div className="cost-row">
                <span>3% adverse gap on exposure</span>
                <strong className="neg">-{inr(gapStress)}</strong>
              </div>
              <div className="cost-row">
                <span>Combined stress loss</span>
                <strong className="neg">-{inr(portfolio.openRisk + gapStress)}</strong>
              </div>
              <div className="budget-row" style={{ marginTop: 4 }}>
                <div className="budget-labels">
                  <span>Monthly drawdown usage</span>
                  <strong>{pct(-monthlyDrawdown)} / {pct(-draft.monthlyDrawdownLimitPct)}</strong>
                </div>
                <ProgressBar value={(monthlyDrawdown / draft.monthlyDrawdownLimitPct) * 100} tone={monthlyDrawdown / draft.monthlyDrawdownLimitPct > 0.8 ? 'red' : 'amber'} />
              </div>
              <div className="explanation" style={{ marginTop: 12 }}>
                Stop-losses may slip. Gap risk is modelled separately from the stop distance and does not guarantee a fill
                at the stop price.
              </div>
            </div>
          </div>
        </div>
      </div>

      <section className="page-grid grid-main-side" style={{ marginTop: 10 }}>
        <div className="card">
          <div className="section-head">
            <div>
              <h2>Preflight simulator</h2>
              <p>Example: {sampleSignal.symbol} · paper BUY · evaluated live against this draft policy</p>
            </div>
            <Pill tone={sampleDecision.allowed ? 'mint' : 'red'}>
              {sampleDecision.allowed ? 'ALLOWED' : 'BLOCKED'}
            </Pill>
          </div>
          <div className="card-body" style={{ paddingTop: 5 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '0 24px' }}>
              {sampleDecision.checks.map((check) => {
                const tone = !check.passed ? (check.severity === 'warning' ? 'warn' : 'fail') : 'pass'
                return (
                  <div className="risk-check" key={check.id}>
                    <span className={`check-dot ${tone}`}>
                      {tone === 'pass' ? <CheckCircle2 /> : <AlertTriangle />}
                    </span>
                    <div className="check-main">
                      <div className="check-label">{check.label}</div>
                      <div className="check-detail">{check.detail}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="section-head">
            <div>
              <h2>Policy gaps</h2>
              <p>What still needs backend verification</p>
            </div>
            <ShieldX className="icon-inline" />
          </div>
          <div className="card-body" style={{ paddingTop: 4 }}>
            {[
              { title: 'Broker-side margin', detail: 'Margin and basket limits cannot be verified without Kite.', tone: 'warn' },
              { title: 'Daily loss from live fills', detail: 'Uses fixture P&L. Production must derive this from broker fills.', tone: 'warn' },
              { title: 'Circuit / freeze quantities', detail: 'Exchange freeze limits are not modelled in this demo.', tone: 'warn' },
              { title: 'Backend authority', detail: 'This browser risk engine is not a substitute for server enforcement.', tone: 'fail' },
            ].map((item) => (
              <div className="risk-check" key={item.title}>
                <span className={`check-dot ${item.tone}`}>
                  <AlertTriangle />
                </span>
                <div className="check-main">
                  <div className="check-label">{item.title}</div>
                  <div className="check-detail">{item.detail}</div>
                </div>
              </div>
            ))}
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 10 }}>
              <Wallet size={12} color="var(--muted)" />
              <span style={{ color: 'var(--muted-dim)', fontSize: 8.5 }}>
                Cash available for sizing: {inr(portfolio.cash)}
              </span>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
