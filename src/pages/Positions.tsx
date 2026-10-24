import { useState } from 'react'
import {
  ArrowRight,
  BriefcaseBusiness,
  CheckCircle2,
  CircleAlert,
  RefreshCw,
  ShieldAlert,
  Target,
  X,
} from 'lucide-react'
import type { PageId, Position } from '../types'
import { useApp } from '../lib/store'
import { inr, pct, shortDate, shortDateTime } from '../lib/format'
import { Button, ConfirmDialog, EmptyState, PageHeader, Pill, ProgressBar, StatusDot } from '../components/ui'

export function Positions({ navigate }: { navigate: (page: PageId) => void }) {
  const { state, portfolio, closePosition, addToast } = useApp()
  const [selected, setSelected] = useState<Position | null>(null)
  const [closeOpen, setCloseOpen] = useState(false)
  const [reconcileOpen, setReconcileOpen] = useState(false)

  const selectedPnl = selected ? (selected.lastPrice - selected.avgPrice) * selected.qty : 0
  const selectedPnlPct = selected ? ((selected.lastPrice - selected.avgPrice) / selected.avgPrice) * 100 : 0

  function confirmClose() {
    if (!selected) return
    closePosition(selected.id)
    setCloseOpen(false)
    setSelected(null)
  }

  return (
    <>
      <PageHeader
        eyebrow="Paper ledger · Risk-defined positions"
        title="Positions"
        subtitle="Open exposure, protected stops and capital at risk. Closes execute against the browser paper ledger only; there is no broker bridge in this runtime."
        actions={
          <>
            <Button variant="ghost" onClick={() => setReconcileOpen(true)}>
              <RefreshCw /> Reconcile
            </Button>
            <Button variant="primary" onClick={() => navigate('scanner')}>
              <Target /> Find setups
            </Button>
          </>
        }
      />

      <div className="mode-banner">
        <div>
          <div className="mode-banner-title">
            <span className="dot good pulse" /> Paper portfolio
          </div>
          <p>Positions below were created by the local demo ledger. Kite is not connected and no live order exists.</p>
        </div>
        <Pill tone="amber">Simulated</Pill>
      </div>

      <section className="summary-strip" aria-label="Position summary">
        <div className="summary-cell">
          <div className="summary-label">Invested capital</div>
          <div className="summary-value">{inr(portfolio.invested)}</div>
          <div className="summary-detail">{portfolio.openPositions} open positions</div>
        </div>
        <div className="summary-cell">
          <div className="summary-label">Current value</div>
          <div className="summary-value">{inr(portfolio.currentValue)}</div>
          <div className="summary-detail">{portfolio.exposurePct.toFixed(1)}% of equity</div>
        </div>
        <div className="summary-cell">
          <div className="summary-label">Unrealised P&amp;L</div>
          <div className={`summary-value ${portfolio.unrealised >= 0 ? 'pos' : 'neg'}`}>
            {portfolio.unrealised >= 0 ? '+' : ''}
            {inr(portfolio.unrealised)}
          </div>
          <div className="summary-detail">{pct(portfolio.unrealisedPct)} on invested capital</div>
        </div>
        <div className="summary-cell">
          <div className="summary-label">Total open risk</div>
          <div className="summary-value">{inr(portfolio.openRisk)}</div>
          <div className="summary-detail">{((portfolio.openRisk / portfolio.equity) * 100).toFixed(2)}% of equity at stop</div>
        </div>
      </section>

      <div className="card table-card">
        <div className="section-head">
          <div>
            <h2>Open positions</h2>
            <p>Stop distances and risk are calculated from the paper entry</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Pill tone="cyan">PAPER</Pill>
            <span className="mono" style={{ color: 'var(--muted-dim)', fontSize: 8 }}>
              As of {shortDateTime('2026-10-23T15:30:00+05:30')}
            </span>
          </div>
        </div>

        {state.positions.length === 0 ? (
          <EmptyState
            icon={<BriefcaseBusiness />}
            title="No open positions"
            text="The paper ledger is flat. Open the scanner to preview a risk-defined paper order."
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Instrument</th>
                  <th>Qty</th>
                  <th>Entry</th>
                  <th>LTP</th>
                  <th>P&amp;L</th>
                  <th>Stop</th>
                  <th>Risk</th>
                  <th>Held</th>
                  <th>Exposure</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {state.positions.map((position) => {
                  const pnl = (position.lastPrice - position.avgPrice) * position.qty
                  const pnlPct = ((position.lastPrice - position.avgPrice) / position.avgPrice) * 100
                  const exposure = (position.lastPrice * position.qty) / portfolio.equity * 100
                  return (
                    <tr
                      key={position.id}
                      tabIndex={0}
                      onClick={() => setSelected(position)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') setSelected(position)
                      }}
                      style={{ cursor: 'pointer' }}
                    >
                      <td>
                        <div className="symbol-cell">
                          <span className="symbol-avatar">{position.symbol.slice(0, 2)}</span>
                          <div>
                            <div className="symbol-name">{position.symbol}</div>
                            <div className="symbol-company">{position.strategy}</div>
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
                      <td className="num" style={{ color: 'var(--muted-dim)' }}>{shortDate(position.openedAt)}</td>
                      <td style={{ minWidth: 76 }}>
                        <div className="mono" style={{ fontSize: 8.5, color: 'var(--muted)', marginBottom: 3 }}>
                          {exposure.toFixed(1)}%
                        </div>
                        <ProgressBar value={exposure * 3} tone={exposure > 15 ? 'amber' : 'lime'} />
                      </td>
                      <td>
                        <Button
                          size="small"
                          variant="ghost"
                          onClick={(event) => {
                            event.stopPropagation()
                            setSelected(position)
                          }}
                        >
                          Manage <ArrowRight size={11} />
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 17px', borderTop: '1px solid var(--line-soft)', flexWrap: 'wrap' }}>
          <span className="mono" style={{ fontSize: 8, color: 'var(--muted-dim)' }}>
            {portfolio.openPositions}/{state.risk.maxOpenPositions} positions · {inr(portfolio.currentValue)} exposure
          </span>
          <span className="mono" style={{ fontSize: 8, color: 'var(--muted-dim)' }}>
            Exposure cap {state.risk.maxPortfolioExposurePct}% · risk governor {state.entriesPaused ? 'PAUSED' : 'ACTIVE'}
          </span>
        </div>
      </div>

      {selected ? (
        <div className="drawer-overlay" onMouseDown={(event) => event.currentTarget === event.target && setSelected(null)}>
          <aside className="drawer" role="dialog" aria-modal="true" aria-label={`${selected.symbol} position`}>
            <div className="drawer-head">
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                  <Pill tone="cyan">PAPER LONG</Pill>
                  <Pill tone="neutral">{selected.sector}</Pill>
                </div>
                <div className="drawer-title">{selected.symbol}</div>
                <div className="drawer-sub">{selected.name} · {selected.strategy}</div>
              </div>
              <button type="button" className="drawer-close" onClick={() => setSelected(null)} aria-label="Close position details">
                <X />
              </button>
            </div>
            <div className="drawer-body">
              <div className="drawer-price">
                <div>
                  <div className="drawer-price-value">{inr(selected.lastPrice, 2)}</div>
                  <div className="drawer-price-meta">
                    Last fixture price · position held since {shortDate(selected.openedAt)}
                  </div>
                </div>
                <span className={`mono ${selectedPnl >= 0 ? 'pos' : 'neg'}`} style={{ fontSize: 13 }}>
                  {selectedPnl >= 0 ? '+' : ''}
                  {inr(selectedPnl)} ({pct(selectedPnlPct)})
                </span>
              </div>

              <div className="detail-grid">
                <div className="detail-cell">
                  <div className="detail-label">Quantity</div>
                  <div className="detail-value">{selected.qty} shares</div>
                </div>
                <div className="detail-cell">
                  <div className="detail-label">Average entry</div>
                  <div className="detail-value">{inr(selected.avgPrice, 2)}</div>
                </div>
                <div className="detail-cell">
                  <div className="detail-label">Stop loss</div>
                  <div className="detail-value neg">{inr(selected.stop, 2)}</div>
                </div>
                <div className="detail-cell">
                  <div className="detail-label">Target</div>
                  <div className="detail-value pos">{inr(selected.target, 2)}</div>
                </div>
                <div className="detail-cell">
                  <div className="detail-label">Capital at stop</div>
                  <div className="detail-value">{inr(selected.riskAmount)}</div>
                </div>
                <div className="detail-cell">
                  <div className="detail-label">Current exposure</div>
                  <div className="detail-value">{inr(selected.lastPrice * selected.qty)}</div>
                </div>
              </div>

              <div className="detail-section-title">Risk distance</div>
              <div className="risk-metric" style={{ display: 'flex', gap: 10, marginBottom: 6 }}>
                <span>Stop distance</span>
                <strong>{pct(((selected.stop - selected.lastPrice) / selected.lastPrice) * 100)}</strong>
              </div>
              <ProgressBar value={Math.min(100, Math.abs(((selected.stop - selected.lastPrice) / selected.lastPrice) * 100) * 9)} tone="amber" />
              <div style={{ marginTop: 14 }} className="announce">
                <ShieldAlert />
                <span>
                  A close is a market order in the paper ledger and is not a broker instruction. Closing does not affect
                  any real holding.
                </span>
              </div>

              <div className="detail-section-title">Journal preview</div>
              <div className="explanation">
                On close, a journal entry will be created automatically with realised P&amp;L after modelled charges. You
                can add a post-trade review from the Trade Journal.
              </div>
            </div>
            <div className="drawer-foot">
              <Button variant="danger" style={{ flex: 1 }} onClick={() => setCloseOpen(true)}>
                <X /> Close paper position
              </Button>
              <Button variant="ghost" onClick={() => setSelected(null)}>
                Cancel
              </Button>
            </div>
          </aside>
        </div>
      ) : null}

      <ConfirmDialog
        open={closeOpen}
        onClose={() => setCloseOpen(false)}
        onConfirm={confirmClose}
        title={`Close ${selected?.symbol ?? ''} in paper mode?`}
        subtitle="This books realised P&L and creates a journal record. It cannot place or cancel a live broker order."
        confirmLabel="Close paper position"
        tone="danger"
      >
        {selected ? (
          <>
            <div className="order-summary">
              <div>
                <span>Quantity</span>
                <strong>{selected.qty}</strong>
              </div>
              <div>
                <span>Fill estimate</span>
                <strong>{inr(selected.lastPrice, 2)}</strong>
              </div>
              <div>
                <span>Est. P&amp;L</span>
                <strong className={selectedPnl >= 0 ? 'pos' : 'neg'}>{inr(selectedPnl)}</strong>
              </div>
              <div>
                <span>Mode</span>
                <strong>PAPER</strong>
              </div>
            </div>
            <p style={{ marginTop: 11, color: 'var(--muted)', fontSize: 9.5, lineHeight: 1.55 }}>
              This action closes the entire position at the simulated last price. Charges are estimated using the saved
              cost model.
            </p>
          </>
        ) : null}
      </ConfirmDialog>

      <ConfirmDialog
        open={reconcileOpen}
        onClose={() => setReconcileOpen(false)}
        onConfirm={() => {
          setReconcileOpen(false)
          addToast({
            tone: 'warning',
            title: 'Broker reconciliation unavailable',
            message: 'Kite is not connected. Local paper positions remain unreconciled against a broker.',
          })
        }}
        title="Reconcile broker positions"
        subtitle="Reconciliation requires an authenticated, read-only Kite session."
        confirmLabel="Run local check"
      >
        <div className="risk-check">
          <span className="check-dot pass"><CheckCircle2 /></span>
          <div className="check-main">
            <div className="check-label">Local paper ledger</div>
            <div className="check-detail">{state.positions.length} positions are readable and internally consistent.</div>
          </div>
        </div>
        <div className="risk-check">
          <span className="check-dot warn"><CircleAlert /></span>
          <div className="check-main">
            <div className="check-label">Kite broker session</div>
            <div className="check-detail">Not connected. No broker holdings or positions can be fetched or compared.</div>
          </div>
        </div>
        <div className="risk-check">
          <span className="check-dot warn"><CircleAlert /></span>
          <div className="check-main">
            <div className="check-label">Local trading database</div>
            <div className="check-detail">The private engine database at /root/pa-swing-kite is not readable from this runtime.</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 10 }}>
          <StatusDot tone="bad" />
          <span style={{ color: 'var(--red)', fontSize: 9 }}>Result: UNRECONCILED. No success is claimed.</span>
        </div>
      </ConfirmDialog>
    </>
  )
}
