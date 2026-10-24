import { useMemo, useState } from 'react'
import { AlertTriangle, Check, Minus, Plus, ShieldCheck, Star, X } from 'lucide-react'
import type { Signal } from '../types'
import { useApp } from '../lib/store'
import { evaluateOrder } from '../lib/risk'
import { inr, pct, shortDate } from '../lib/format'
import { Button, Modal, Pill, Toggle } from './ui'
import { SignalChart } from './charts'

export function SignalDetailDrawer({ signal, onClose }: { signal: Signal; onClose: () => void }) {
  const { state, toggleWatchlist } = useApp()
  const [ticketOpen, setTicketOpen] = useState(false)
  const watched = state.watchlist.includes(signal.symbol)
  return (
    <>
      <div className="drawer-overlay" onMouseDown={(event) => event.currentTarget === event.target && onClose()}>
        <aside className="drawer" role="dialog" aria-modal="true" aria-label={`${signal.symbol} signal details`}>
          <div className="drawer-head">
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
                <Pill tone={signal.setup === 'Breakout' ? 'lime' : signal.setup === 'Pullback' ? 'cyan' : 'violet'}>
                  {signal.setup}
                </Pill>
                <Pill tone="amber">Demo signal</Pill>
                {signal.historical && signal.outcome ? <Pill tone="neutral">{signal.outcome}</Pill> : null}
              </div>
              <div className="drawer-title">{signal.symbol}</div>
              <div className="drawer-sub">
                {signal.name} · {signal.sector} · {signal.strategy}
              </div>
            </div>
            <button type="button" className="drawer-close" onClick={onClose} aria-label="Close signal details">
              <X />
            </button>
          </div>
          <div className="drawer-body">
            <div className="drawer-price">
              <div>
                <div className="drawer-price-value">{inr(signal.price, 2)}</div>
                <div className="drawer-price-meta">
                  <span className={signal.changePct >= 0 ? 'pos' : 'neg'}>{pct(signal.changePct)}</span> · signal{' '}
                  {shortDate(signal.signalDate)}
                </div>
              </div>
              <Button size="small" variant="ghost" onClick={() => toggleWatchlist(signal.symbol)}>
                <Star size={13} fill={watched ? 'currentColor' : 'none'} className={watched ? 'lime' : ''} />
                {watched ? 'Watching' : 'Watch'}
              </Button>
            </div>

            <div className="drawer-chart">
              <SignalChart data={signal.spark} positive={signal.changePct >= 0} />
            </div>

            <div className="detail-grid">
              <div className="detail-cell">
                <div className="detail-label">Signal score</div>
                <div className="detail-value">
                  <span className="lime">{signal.score}</span> / 100
                </div>
              </div>
              <div className="detail-cell">
                <div className="detail-label">Relative strength</div>
                <div className="detail-value">{signal.rsRank} / 100</div>
              </div>
              <div className="detail-cell">
                <div className="detail-label">Daily / weekly trend</div>
                <div className="detail-value">
                  {signal.dailyTrend} / {signal.weeklyTrend}
                </div>
              </div>
              <div className="detail-cell">
                <div className="detail-label">Momentum</div>
                <div className="detail-value">{pct(signal.momentum)}</div>
              </div>
              <div className="detail-cell">
                <div className="detail-label">ATR (14D)</div>
                <div className="detail-value">
                  {inr(signal.atr, 2)} · {signal.atrPct}%
                </div>
              </div>
              <div className="detail-cell">
                <div className="detail-label">Volume vs 20D avg</div>
                <div className="detail-value">{(signal.volume / signal.avgVolume).toFixed(2)}×</div>
              </div>
              <div className="detail-cell">
                <div className="detail-label">Median turnover</div>
                <div className="detail-value">₹{signal.liquidityCr}Cr</div>
              </div>
              <div className="detail-cell">
                <div className="detail-label">Risk / reward</div>
                <div className="detail-value">{signal.rr.toFixed(1)}R</div>
              </div>
            </div>

            <div className="detail-section-title">Trade plan</div>
            <div className="detail-grid">
              <div className="detail-cell">
                <div className="detail-label">Entry zone</div>
                <div className="detail-value">
                  {inr(signal.entryLow, 2)} – {inr(signal.entryHigh, 2)}
                </div>
              </div>
              <div className="detail-cell">
                <div className="detail-label">Stop loss</div>
                <div className="detail-value neg">{inr(signal.stop, 2)}</div>
              </div>
              <div className="detail-cell">
                <div className="detail-label">Target 1</div>
                <div className="detail-value pos">{inr(signal.target1, 2)}</div>
              </div>
              <div className="detail-cell">
                <div className="detail-label">Target 2</div>
                <div className="detail-value pos">{inr(signal.target2, 2)}</div>
              </div>
            </div>

            <div className="detail-section-title">Why this setup</div>
            <div className="explanation">{signal.explanation}</div>

            <div className="announce" style={{ marginTop: 14 }}>
              <AlertTriangle />
              <span>
                <strong>Fixture data.</strong> This signal is deterministic demonstration data, not a live NSE quote and
                not evidence of an edge. The strategy is unvalidated for live capital.
              </span>
            </div>
          </div>
          <div className="drawer-foot">
            <Button style={{ flex: 1 }} onClick={() => setTicketOpen(true)} disabled={state.entriesPaused}>
              <ShieldCheck /> Preview paper order
            </Button>
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
          </div>
        </aside>
      </div>
      <PaperOrderModal signal={signal} open={ticketOpen} onClose={() => setTicketOpen(false)} />
    </>
  )
}

export function PaperOrderModal({ signal, open, onClose }: { signal: Signal; open: boolean; onClose: () => void }) {
  const { state, portfolio, placePaperOrder, addToast } = useApp()
  const [entry, setEntry] = useState(signal.entryHigh)
  const [stop, setStop] = useState(signal.stop)
  const [target, setTarget] = useState(signal.target1)
  const [qty, setQty] = useState<number | null>(null)
  const [orderType, setOrderType] = useState<'MARKET' | 'LIMIT'>('LIMIT')
  const [confirmed, setConfirmed] = useState(false)

  const intent = useMemo(
    () => ({
      symbol: signal.symbol,
      entry,
      stop,
      target,
      liquidityCr: signal.liquidityCr,
      requestedQty: qty ?? undefined,
    }),
    [signal.symbol, signal.liquidityCr, entry, stop, target, qty],
  )
  const decision = useMemo(
    () =>
      evaluateOrder(intent, {
        config: state.risk,
        positions: state.positions,
        orders: state.orders,
        cash: portfolio.cash,
        dailyPnl: portfolio.dayPnl,
        monthlyDrawdownPct: -2.1,
        entriesPaused: state.entriesPaused,
        mode: state.mode,
      }),
    [intent, state.risk, state.positions, state.orders, portfolio.cash, portfolio.dayPnl, state.entriesPaused, state.mode],
  )
  const effectiveQty = qty ?? decision.qty
  const hardFailures = decision.checks.filter((check) => !check.passed && check.severity === 'hard')
  const canSubmit = decision.allowed && confirmed && effectiveQty > 0

  function submit() {
    const result = placePaperOrder({
      signal,
      qty: effectiveQty,
      entry,
      stop,
      target,
      riskPct: state.risk.riskPerTradePct,
      orderType,
      limitPrice: orderType === 'LIMIT' ? entry : undefined,
    })
    if (result.ok) {
      setConfirmed(false)
      onClose()
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Preview · ${signal.symbol} PAPER BUY`}
      subtitle="Backend-style risk checks run before the ledger accepts the order. Live routing is disabled."
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={!canSubmit}>
            <ShieldCheck /> Place paper order
          </Button>
        </>
      }
    >
      <div className="announce" style={{ marginTop: 0 }}>
        <ShieldCheck />
        <span>
          <strong>Paper only.</strong> No broker order will be transmitted. The order is validated again inside the
          execution layer before it reaches the local paper ledger.
        </span>
      </div>

      <div className="order-summary">
        <div>
          <span>Setup</span>
          <strong>{signal.setup} · {signal.strategy}</strong>
        </div>
        <div>
          <span>Signal score</span>
          <strong>{signal.score} / 100</strong>
        </div>
        <div>
          <span>Entry</span>
          <strong>{inr(entry, 2)}</strong>
        </div>
        <div>
          <span>Stop / target</span>
          <strong>
            {inr(stop, 2)} / {inr(target, 2)}
          </strong>
        </div>
      </div>

      <div className="qty-row">
        <span style={{ fontSize: 9.5, color: 'var(--muted)', marginRight: 4 }}>Quantity</span>
        <button
          type="button"
          className="qty-btn"
          onClick={() => setQty(Math.max(1, effectiveQty - 1))}
          aria-label="Decrease quantity"
        >
          <Minus />
        </button>
        <input
          className="qty-input mono"
          type="number"
          min={1}
          value={effectiveQty}
          onChange={(event) => setQty(Math.max(0, Number(event.target.value)))}
          aria-label="Order quantity"
        />
        <button
          type="button"
          className="qty-btn"
          onClick={() => setQty(effectiveQty + 1)}
          aria-label="Increase quantity"
        >
          <Plus />
        </button>
        <span style={{ fontSize: 8.5, color: 'var(--muted-dim)', marginLeft: 3 }}>
          Risk-sized: {decision.qty} shares @ {state.risk.riskPerTradePct}% risk
        </span>
      </div>

      <div className="form-grid" style={{ marginTop: 13 }}>
        <div className="form-field">
          <label htmlFor="order-entry">Entry price</label>
          <div className="input-wrap with-prefix">
            <span className="prefix">₹</span>
            <input
              id="order-entry"
              type="number"
              value={entry}
              step="0.05"
              onChange={(event) => setEntry(Number(event.target.value))}
            />
          </div>
        </div>
        <div className="form-field">
          <label htmlFor="order-type">Order type</label>
          <div className="input-wrap no-prefix">
            <select
              id="order-type"
              value={orderType}
              onChange={(event) => setOrderType(event.target.value as 'MARKET' | 'LIMIT')}
              style={{ width: '100%', minHeight: 36, border: '1px solid var(--line)', borderRadius: 7, background: '#0a1017', color: 'var(--text)', padding: '0 10px', fontSize: 10 }}
            >
              <option value="LIMIT">LIMIT</option>
              <option value="MARKET">MARKET</option>
            </select>
          </div>
        </div>
        <div className="form-field">
          <label htmlFor="order-stop">Stop loss</label>
          <div className="input-wrap with-prefix">
            <span className="prefix">₹</span>
            <input id="order-stop" type="number" value={stop} step="0.05" onChange={(event) => setStop(Number(event.target.value))} />
          </div>
        </div>
        <div className="form-field">
          <label htmlFor="order-target">Target</label>
          <div className="input-wrap with-prefix">
            <span className="prefix">₹</span>
            <input id="order-target" type="number" value={target} step="0.05" onChange={(event) => setTarget(Number(event.target.value))} />
          </div>
        </div>
      </div>

      <div className="detail-grid" style={{ marginTop: 14, marginBottom: 10 }}>
        <div className="detail-cell">
          <div className="detail-label">Capital at risk</div>
          <div className="detail-value">{inr(decision.riskAmount)}</div>
        </div>
        <div className="detail-cell">
          <div className="detail-label">Order notional</div>
          <div className="detail-value">{inr(decision.notional)}</div>
        </div>
        <div className="detail-cell">
          <div className="detail-label">Est. costs + slippage</div>
          <div className="detail-value">{inr(decision.estimatedCharges, 2)}</div>
        </div>
        <div className="detail-cell">
          <div className="detail-label">Post-trade exposure</div>
          <div className="detail-value">
            {decision.concentrationAfter.toFixed(1)}% single name
          </div>
        </div>
      </div>

      <div className="detail-section-title">Pre-trade checks</div>
      <div className="risk-check" style={{ paddingTop: 0 }}>
        <div style={{ flex: 1 }}>
          {decision.checks.map((check) => {
            const tone = !check.passed ? (check.severity === 'warning' ? 'warn' : 'fail') : 'pass'
            return (
              <div className="risk-check" key={check.id}>
                <span className={`check-dot ${tone}`}>
                  {tone === 'pass' ? <Check /> : <AlertTriangle />}
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

      {hardFailures.length > 0 ? (
        <div className="announce" style={{ borderColor: 'rgba(255,111,134,0.24)', background: 'rgba(255,111,134,0.06)', color: '#e4a0ac' }}>
          <AlertTriangle />
          <span>
            <strong>Blocked by risk governor.</strong> Resolve {hardFailures.length} hard check
            {hardFailures.length > 1 ? 's' : ''} before this order can reach the paper ledger.
          </span>
        </div>
      ) : null}

      <div className="switch-row" style={{ marginTop: 9 }}>
        <div className="switch-main">
          <div className="switch-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
              id="paper-confirm"
              style={{ accentColor: 'var(--lime)' }}
            />
            <label htmlFor="paper-confirm">I reviewed this order and understand it is simulated</label>
          </div>
          <div className="switch-desc" style={{ marginLeft: 23 }}>
            Explicit confirmation is required for every execution. No auto-deploy or live order is possible here.
          </div>
        </div>
        <Toggle checked={true} onChange={() => addToast({ tone: 'info', title: 'Mode locked to paper', message: 'Live trading is disabled until credentials and backend checks are configured.' })} disabled label="Paper mode locked" />
      </div>
    </Modal>
  )
}
