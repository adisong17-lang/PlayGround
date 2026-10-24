import { useState } from 'react'
import {
  ArrowRight,
  Ban,
  CheckCircle2,
  CircleAlert,
  CopyCheck,
  FileCheck2,
  ListOrdered,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react'
import type { Order, PageId } from '../types'
import { useApp } from '../lib/store'
import { inr, shortDateTime } from '../lib/format'
import { Button, EmptyState, PageHeader, Pill } from '../components/ui'

type Tab = 'All' | 'Working' | 'Executed' | 'Rejected' | 'Cancelled'

const STATUS_TONE: Record<Order['status'], 'lime' | 'mint' | 'red' | 'neutral'> = {
  PENDING: 'lime',
  EXECUTED: 'mint',
  REJECTED: 'red',
  CANCELLED: 'neutral',
}

export function Orders({ navigate }: { navigate: (page: PageId) => void }) {
  const { state, cancelOrder, addToast } = useApp()
  const [tab, setTab] = useState<Tab>('All')
  const [selected, setSelected] = useState<Order | null>(null)

  const filtered = state.orders.filter((order) => {
    if (tab === 'All') return true
    if (tab === 'Working') return order.status === 'PENDING'
    if (tab === 'Executed') return order.status === 'EXECUTED'
    if (tab === 'Rejected') return order.status === 'REJECTED'
    return order.status === 'CANCELLED'
  })

  const counts = {
    working: state.orders.filter((order) => order.status === 'PENDING').length,
    executed: state.orders.filter((order) => order.status === 'EXECUTED').length,
    rejected: state.orders.filter((order) => order.status === 'REJECTED').length,
    cancelled: state.orders.filter((order) => order.status === 'CANCELLED').length,
  }

  return (
    <>
      <PageHeader
        eyebrow="Execution desk · Paper ledger"
        title="Orders"
        subtitle="Every order previews, validates and requires explicit confirmation. The live broker route is disabled and cannot be enabled from this interface."
        actions={
          <>
            <Button
              variant="ghost"
              onClick={() =>
                addToast({
                  tone: 'warning',
                  title: 'Order reconciliation unavailable',
                  message: 'No Kite session is connected, so paper orders cannot be reconciled with a broker.',
                })
              }
            >
              <RefreshCw /> Reconcile
            </Button>
            <Button variant="primary" onClick={() => navigate('scanner')}>
              <ListOrdered /> New paper order
            </Button>
          </>
        }
      />

      <section className="summary-strip" aria-label="Order summary">
        <div className="summary-cell">
          <div className="summary-label">Working orders</div>
          <div className="summary-value lime">{counts.working}</div>
          <div className="summary-detail">Paper · pending fill</div>
        </div>
        <div className="summary-cell">
          <div className="summary-label">Executed</div>
          <div className="summary-value">{counts.executed}</div>
          <div className="summary-detail">Paper fills · local ledger</div>
        </div>
        <div className="summary-cell">
          <div className="summary-label">Rejected</div>
          <div className="summary-value neg">{counts.rejected}</div>
          <div className="summary-detail">Blocked by pre-trade policy</div>
        </div>
        <div className="summary-cell">
          <div className="summary-label">Cancelled</div>
          <div className="summary-value">{counts.cancelled}</div>
          <div className="summary-detail">Operator cancelled</div>
        </div>
      </section>

      <div className="card table-card">
        <div className="filter-bar">
          <div className="tab-list" role="tablist" aria-label="Order status filter">
            {(['All', 'Working', 'Executed', 'Rejected', 'Cancelled'] as Tab[]).map((item) => (
              <button
                type="button"
                key={item}
                className={tab === item ? 'active' : ''}
                onClick={() => setTab(item)}
                role="tab"
                aria-selected={tab === item}
              >
                {item}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <Pill tone="cyan">PAPER ONLY</Pill>
            <span className="mono" style={{ color: 'var(--muted-dim)', fontSize: 8 }}>
              Duplicate protection · ON
            </span>
          </div>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            icon={<ListOrdered />}
            title="No orders in this state"
            text="Paper executions and rejected preflights will appear here with their full audit details."
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Placed</th>
                  <th>Instrument</th>
                  <th>Side</th>
                  <th>Qty</th>
                  <th>Type</th>
                  <th>Price</th>
                  <th>Status</th>
                  <th>Avg fill</th>
                  <th>Charges</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((order) => (
                  <tr key={order.id} style={{ cursor: 'pointer' }} onClick={() => setSelected(order)}>
                    <td className="num" style={{ color: 'var(--muted-dim)', fontSize: 9 }}>
                      {shortDateTime(order.createdAt)}
                    </td>
                    <td>
                      <div className="symbol-cell">
                        <span className="symbol-avatar">{order.symbol.slice(0, 2)}</span>
                        <div>
                          <div className="symbol-name">{order.symbol}</div>
                          <div className="symbol-company">{order.name}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <Pill tone={order.side === 'BUY' ? 'lime' : 'amber'}>{order.side}</Pill>
                    </td>
                    <td className="num">{order.qty}</td>
                    <td className="num">{order.type}</td>
                    <td className="num">{order.limitPrice ? inr(order.limitPrice, 2) : '—'}</td>
                    <td>
                      <Pill tone={STATUS_TONE[order.status]}>{order.status}</Pill>
                    </td>
                    <td className="num">{order.avgFill ? inr(order.avgFill, 2) : '—'}</td>
                    <td className="num">{order.charges ? inr(order.charges, 2) : '—'}</td>
                    <td>
                      {order.status === 'PENDING' ? (
                        <Button
                          size="small"
                          variant="danger"
                          onClick={(event) => {
                            event.stopPropagation()
                            cancelOrder(order.id)
                          }}
                        >
                          <Ban /> Cancel
                        </Button>
                      ) : (
                        <Button size="small" variant="ghost" onClick={() => setSelected(order)}>
                          Audit <ArrowRight size={11} />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 17px', borderTop: '1px solid var(--line-soft)', flexWrap: 'wrap' }}>
          <span className="mono" style={{ fontSize: 8, color: 'var(--muted-dim)' }}>
            {filtered.length} orders · local paper ledger
          </span>
          <span className="mono" style={{ fontSize: 8, color: 'var(--muted-dim)' }}>
            Live route: DISABLED · Broker session: NOT CONNECTED
          </span>
        </div>
      </div>

      <section className="page-grid grid-2" style={{ marginTop: 10 }}>
        <div className="card">
          <div className="section-head">
            <div>
              <h2>Execution pipeline</h2>
              <p>Five checkpoints before any paper fill</p>
            </div>
            <Pill tone="mint">Enforced</Pill>
          </div>
          <div className="card-body" style={{ paddingTop: 4 }}>
            {[
              { icon: FileCheck2, title: 'Order preview', text: 'Entry, stop, target, quantity and modelled costs are shown before submission.' },
              { icon: ShieldCheck, title: 'Server-side preflight', text: 'Risk, liquidity, duplicate, cash and exposure checks run in the execution layer.' },
              { icon: LockKeyhole, title: 'Explicit confirmation', text: 'The operator must confirm every order. There is no one-click live route.' },
              { icon: CheckCircle2, title: 'Paper ledger fill', text: 'Only validated PAPER orders reach the local ledger. Live transmission is disabled.' },
              { icon: CopyCheck, title: 'Reconcile', text: 'Positions and orders are compared with the broker when an authenticated session exists.' },
            ].map((step, index) => {
              const Icon = step.icon
              return (
                <div className="feed-row" key={step.title} style={{ paddingLeft: 0, paddingRight: 0 }}>
                  <div className="feed-icon good" style={{ width: 24, height: 24 }}>
                    <Icon />
                  </div>
                  <div className="feed-main">
                    <div className="feed-title">
                      <strong>{String(index + 1).padStart(2, '0')}</strong> · {step.title}
                    </div>
                    <div className="feed-meta" style={{ fontSize: 8.5, lineHeight: 1.5 }}>
                      {step.text}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="card">
          <div className="section-head">
            <div>
              <h2>Safety invariants</h2>
              <p>These cannot be bypassed by a frontend setting</p>
            </div>
            <Pill tone="amber">Read-only demo</Pill>
          </div>
          <div className="card-body" style={{ paddingTop: 5 }}>
            {[
              { title: 'PAPER by default', detail: 'The active execution mode is PAPER. Live mode requires server configuration outside the UI.', good: true },
              { title: 'Duplicate-order guard', detail: 'A symbol with a working buy order cannot receive a second working order.', good: true },
              { title: 'Risk governor authority', detail: 'Frontend controls cannot override a backend risk rejection.', good: true },
              { title: 'No auto-deploy', detail: 'The best backtest never deploys itself. Strategy promotion requires verified gates and explicit action.', good: true },
              { title: 'Kite adapter', detail: 'Not configured in this runtime. Automated live execution is unavailable.', good: false },
            ].map((item) => (
              <div className="risk-check" key={item.title}>
                <span className={`check-dot ${item.good ? 'pass' : 'warn'}`}>
                  {item.good ? <CheckCircle2 /> : <CircleAlert />}
                </span>
                <div className="check-main">
                  <div className="check-label">{item.title}</div>
                  <div className="check-detail">{item.detail}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {selected ? (
        <div className="drawer-overlay" onMouseDown={(event) => event.currentTarget === event.target && setSelected(null)}>
          <aside className="drawer" role="dialog" aria-modal="true" aria-label={`${selected.symbol} order details`} style={{ width: 'min(470px, 100vw)' }}>
            <div className="drawer-head">
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
                  <Pill tone={STATUS_TONE[selected.status]}>{selected.status}</Pill>
                  <Pill tone="cyan">{selected.mode}</Pill>
                </div>
                <div className="drawer-title">
                  {selected.side} {selected.symbol}
                </div>
                <div className="drawer-sub">{selected.name} · order {selected.id}</div>
              </div>
              <button type="button" className="drawer-close" onClick={() => setSelected(null)} aria-label="Close order details">
                <X />
              </button>
            </div>
            <div className="drawer-body">
              <div className="drawer-price">
                <div>
                  <div className="drawer-price-value">{selected.qty} <span style={{ fontSize: 15, color: 'var(--muted)' }}>shares</span></div>
                  <div className="drawer-price-meta">{selected.type} · placed {shortDateTime(selected.createdAt)}</div>
                </div>
                <span className="mono" style={{ fontSize: 12 }}>{selected.limitPrice ? inr(selected.limitPrice, 2) : 'MARKET'}</span>
              </div>

              <div className="detail-grid">
                <div className="detail-cell">
                  <div className="detail-label">Order ID</div>
                  <div className="detail-value" style={{ fontSize: 8.5 }}>{selected.id}</div>
                </div>
                <div className="detail-cell">
                  <div className="detail-label">Mode</div>
                  <div className="detail-value">{selected.mode}</div>
                </div>
                <div className="detail-cell">
                  <div className="detail-label">Average fill</div>
                  <div className="detail-value">{selected.avgFill ? inr(selected.avgFill, 2) : '—'}</div>
                </div>
                <div className="detail-cell">
                  <div className="detail-label">Executed at</div>
                  <div className="detail-value">{selected.executedAt ? shortDateTime(selected.executedAt) : '—'}</div>
                </div>
                <div className="detail-cell">
                  <div className="detail-label">Modelled charges</div>
                  <div className="detail-value">{selected.charges ? inr(selected.charges, 2) : '—'}</div>
                </div>
                <div className="detail-cell">
                  <div className="detail-label">Signal ID</div>
                  <div className="detail-value" style={{ fontSize: 8 }}>{selected.signalId ?? 'Manual / fixture'}</div>
                </div>
              </div>

              {selected.rejection ? (
                <>
                  <div className="detail-section-title">Rejection reason</div>
                  <div className="explanation" style={{ color: 'var(--red)' }}>{selected.rejection}</div>
                </>
              ) : null}

              <div className="detail-section-title">Execution timeline</div>
              <div className="log-row" style={{ paddingLeft: 0, paddingRight: 0 }}>
                <div className="log-time">{shortDateTime(selected.createdAt).split(', ')[1]}</div>
                <div className="log-source">created</div>
                <div className="log-message">Order passed to paper preflight.</div>
              </div>
              <div className="log-row" style={{ paddingLeft: 0, paddingRight: 0 }}>
                <div className="log-time">{shortDateTime(selected.createdAt).split(', ')[1]}</div>
                <div className="log-source">risk</div>
                <div className="log-message">
                  {selected.status === 'REJECTED' ? 'Risk preflight rejected the order.' : 'Risk, duplicate and exposure checks passed.'}
                </div>
              </div>
              <div className="log-row" style={{ paddingLeft: 0, paddingRight: 0 }}>
                <div className="log-time">
                  {selected.executedAt ? shortDateTime(selected.executedAt).split(', ')[1] : '—'}
                </div>
                <div className="log-source">ledger</div>
                <div className="log-message">
                  {selected.status === 'EXECUTED'
                    ? 'Filled in paper mode. Broker was not contacted.'
                    : selected.status === 'PENDING'
                      ? 'Awaiting simulated fill. No broker was contacted.'
                      : 'No fill recorded.'}
                </div>
              </div>

              <div className="announce" style={{ marginTop: 14 }}>
                <CircleAlert />
                <span>
                  <strong>No broker transmission.</strong> This is a local paper audit record. Kite is disconnected in
                  this runtime.
                </span>
              </div>
            </div>
            <div className="drawer-foot">
              {selected.status === 'PENDING' ? (
                <Button
                  variant="danger"
                  style={{ flex: 1 }}
                  onClick={() => {
                    cancelOrder(selected.id)
                    setSelected(null)
                  }}
                >
                  <Ban /> Cancel paper order
                </Button>
              ) : null}
              <Button variant="ghost" style={{ flex: 1 }} onClick={() => setSelected(null)}>
                Close
              </Button>
            </div>
          </aside>
        </div>
      ) : null}
    </>
  )
}
