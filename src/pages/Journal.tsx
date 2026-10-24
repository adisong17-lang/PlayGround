import { useMemo, useState } from 'react'
import { BookOpenText, Download, Edit3, FileText, TrendingDown, TrendingUp } from 'lucide-react'
import type { Trade } from '../types'
import { useApp } from '../lib/store'
import { inr, pct, shortDate } from '../lib/format'
import { Button, EmptyState, Modal, PageHeader, Pill } from '../components/ui'

type Filter = 'All' | 'Winners' | 'Losses' | 'A+ setups'

export function Journal() {
  const { state, addJournalNote, addToast } = useApp()
  const [filter, setFilter] = useState<Filter>('All')
  const [selected, setSelected] = useState<Trade | null>(null)
  const [notes, setNotes] = useState('')
  const [tags, setTags] = useState('')

  const stats = useMemo(() => {
    const trades = state.journal
    const wins = trades.filter((trade) => trade.pnl > 0)
    const losses = trades.filter((trade) => trade.pnl < 0)
    const grossProfit = wins.reduce((sum, trade) => sum + trade.pnl, 0)
    const grossLoss = Math.abs(losses.reduce((sum, trade) => sum + trade.pnl, 0))
    const totalPnl = trades.reduce((sum, trade) => sum + trade.pnl, 0)
    const avgR = trades.reduce((sum, trade) => sum + trade.rMultiple, 0) / Math.max(1, trades.length)
    return {
      totalPnl,
      wins: wins.length,
      losses: losses.length,
      winRate: (wins.length / Math.max(1, trades.length)) * 100,
      profitFactor: grossProfit / Math.max(1, grossLoss),
      expectancy: totalPnl / Math.max(1, trades.length),
      avgR,
      avgHold: trades.reduce((sum, trade) => sum + trade.holdingDays, 0) / Math.max(1, trades.length),
      best: Math.max(...trades.map((trade) => trade.pnl)),
      worst: Math.min(...trades.map((trade) => trade.pnl)),
    }
  }, [state.journal])

  const monthly = useMemo(() => {
    const byMonth = new Map<string, number>()
    state.journal.forEach((trade) => {
      const key = new Date(trade.closedAt).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })
      byMonth.set(key, (byMonth.get(key) ?? 0) + trade.pnl)
    })
    return [...byMonth.entries()].slice(0, 6).map(([label, value]) => ({ label, value }))
  }, [state.journal])

  const playbooks = useMemo(() => {
    const groups = new Map<string, { count: number; pnl: number; wins: number }>()
    state.journal.forEach((trade) => {
      const current = groups.get(trade.setup) ?? { count: 0, pnl: 0, wins: 0 }
      groups.set(trade.setup, {
        count: current.count + 1,
        pnl: current.pnl + trade.pnl,
        wins: current.wins + (trade.pnl > 0 ? 1 : 0),
      })
    })
    return [...groups.entries()].map(([name, value]) => ({
      name,
      ...value,
      winRate: (value.wins / value.count) * 100,
    }))
  }, [state.journal])

  const filtered = state.journal.filter((trade) => {
    if (filter === 'Winners') return trade.pnl > 0
    if (filter === 'Losses') return trade.pnl < 0
    if (filter === 'A+ setups') return trade.tags.some((tag) => tag.toLowerCase().includes('a+'))
    return true
  })

  function openReview(trade: Trade) {
    setSelected(trade)
    setNotes(trade.notes)
    setTags(trade.tags.join(', '))
  }

  function saveReview() {
    if (!selected) return
    addJournalNote({
      tradeId: selected.id,
      notes,
      tags: tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
    })
    setSelected(null)
  }

  function exportJournal() {
    const header = 'symbol,entry,exit,qty,pnl,pnl_pct,r_multiple,setup,strategy,opened,closed,tags,notes'
    const rows = state.journal.map((trade) =>
      [
        trade.symbol,
        trade.entry,
        trade.exit,
        trade.qty,
        trade.pnl.toFixed(2),
        trade.pnlPct.toFixed(2),
        trade.rMultiple.toFixed(2),
        trade.setup,
        trade.strategy,
        trade.openedAt,
        trade.closedAt,
        `"${trade.tags.join('|')}"`,
        `"${trade.notes.replaceAll('"', '""')}"`,
      ].join(','),
    )
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'gulshan-trade-journal.csv'
    link.click()
    URL.revokeObjectURL(url)
    addToast({ tone: 'success', title: 'Journal exported', message: 'Demo journal CSV downloaded locally.' })
  }

  return (
    <>
      <PageHeader
        eyebrow="Post-trade review · Closed paper trades"
        title="Trade journal"
        subtitle="Review outcomes, R-multiples and the quality of execution. Notes and tags are stored in this browser only; no real trade history is being presented."
        actions={
          <>
            <Button variant="ghost" onClick={exportJournal}>
              <Download /> Export
            </Button>
            <Button variant="primary" onClick={() => state.journal[0] && openReview(state.journal[0])}>
              <Edit3 /> Review latest
            </Button>
          </>
        }
      />

      <div className="announce">
        <BookOpenText />
        <span>
          <strong>Demo journal.</strong> Closed trades below are fixtures used to demonstrate review workflows. They are
          not Gulshan's live record and are not evidence of profitability.
        </span>
      </div>

      <section className="summary-strip" aria-label="Journal statistics">
        <div className="summary-cell">
          <div className="summary-label">Realised P&amp;L</div>
          <div className={`summary-value ${stats.totalPnl >= 0 ? 'pos' : 'neg'}`}>
            {stats.totalPnl >= 0 ? '+' : ''}
            {inr(stats.totalPnl)}
          </div>
          <div className="summary-detail">{state.journal.length} closed paper trades</div>
        </div>
        <div className="summary-cell">
          <div className="summary-label">Win rate</div>
          <div className="summary-value">{stats.winRate.toFixed(1)}%</div>
          <div className="summary-detail">{stats.wins} wins · {stats.losses} losses</div>
        </div>
        <div className="summary-cell">
          <div className="summary-label">Profit factor</div>
          <div className="summary-value">{stats.profitFactor.toFixed(2)}</div>
          <div className="summary-detail">Average {stats.avgR.toFixed(2)}R per trade</div>
        </div>
        <div className="summary-cell">
          <div className="summary-label">Expectancy</div>
          <div className={`summary-value ${stats.expectancy >= 0 ? 'pos' : 'neg'}`}>
            {stats.expectancy >= 0 ? '+' : ''}
            {inr(stats.expectancy)}
          </div>
          <div className="summary-detail">Avg hold {stats.avgHold.toFixed(1)} days</div>
        </div>
      </section>

      <div className="card table-card">
        <div className="filter-bar">
          <div className="tab-list" role="tablist" aria-label="Trade filter">
            {(['All', 'Winners', 'Losses', 'A+ setups'] as Filter[]).map((item) => (
              <button
                type="button"
                key={item}
                className={filter === item ? 'active' : ''}
                onClick={() => setFilter(item)}
                role="tab"
                aria-selected={filter === item}
              >
                {item}
              </button>
            ))}
          </div>
          <span className="mono" style={{ color: 'var(--muted-dim)', fontSize: 8 }}>
            {filtered.length} reviews · click a row to edit
          </span>
        </div>

        {filtered.length === 0 ? (
          <EmptyState icon={<FileText />} title="No trades in this view" text="Switch the filter or close a paper position from the Positions page." />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Instrument</th>
                  <th>Closed</th>
                  <th>Entry / exit</th>
                  <th>Qty</th>
                  <th>P&amp;L</th>
                  <th>R multiple</th>
                  <th>Setup</th>
                  <th>Hold</th>
                  <th>Review</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((trade) => (
                  <tr key={trade.id} style={{ cursor: 'pointer' }} onClick={() => openReview(trade)}>
                    <td>
                      <div className="symbol-cell">
                        <span className="symbol-avatar">{trade.symbol.slice(0, 2)}</span>
                        <div>
                          <div className="symbol-name">{trade.symbol}</div>
                          <div className="symbol-company">{trade.strategy}</div>
                        </div>
                      </div>
                    </td>
                    <td className="num" style={{ color: 'var(--muted-dim)', fontSize: 9 }}>{shortDate(trade.closedAt)}</td>
                    <td className="num">
                      {inr(trade.entry, 1)} <span className="text-dim">→</span> {inr(trade.exit, 1)}
                    </td>
                    <td className="num">{trade.qty}</td>
                    <td className={`num ${trade.pnl >= 0 ? 'pos' : 'neg'}`}>
                      {trade.pnl >= 0 ? '+' : ''}
                      {inr(trade.pnl)} <span style={{ fontSize: 8 }}>({pct(trade.pnlPct)})</span>
                    </td>
                    <td className="num">
                      <span className={trade.rMultiple >= 0 ? 'pos' : 'neg'}>
                        {trade.rMultiple > 0 ? '+' : ''}
                        {trade.rMultiple.toFixed(2)}R
                      </span>
                    </td>
                    <td><Pill tone={trade.setup === 'Breakout' ? 'lime' : trade.setup === 'Pullback' ? 'cyan' : 'violet'}>{trade.setup}</Pill></td>
                    <td className="num">{trade.holdingDays}d</td>
                    <td>
                      <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                        {trade.tags.slice(0, 2).map((tag) => (
                          <Pill key={tag} tone={tag.toLowerCase().includes('loss') ? 'red' : tag.toLowerCase().includes('winner') ? 'mint' : 'neutral'}>
                            {tag}
                          </Pill>
                        ))}
                      </div>
                    </td>
                    <td>
                      <Button size="small" variant="ghost" onClick={(event) => { event.stopPropagation(); openReview(trade) }}>
                        <Edit3 /> Review
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <section className="page-grid grid-2" style={{ marginTop: 10 }}>
        <div className="card">
          <div className="section-head">
            <div>
              <h2>Monthly realised P&amp;L</h2>
              <p>Paper trades grouped by close date</p>
            </div>
            <Pill tone="amber">Fixture</Pill>
          </div>
          <div className="card-body">
            <div className="month-bars" style={{ height: 120 }}>
              {monthly.map((month) => {
                const max = Math.max(...monthly.map((item) => Math.abs(item.value)), 1)
                const height = (Math.abs(month.value) / max) * 82
                return (
                  <div className="month-bar" key={month.label}>
                    <div className="month-bar-track" style={{ height: 92 }}>
                      <div className={`month-bar-fill ${month.value < 0 ? 'neg' : ''}`.trim()} style={{ height: `${Math.max(5, height)}%` }} title={`${month.label}: ${inr(month.value)}`} />
                    </div>
                    <span className="month-bar-label">{month.label}</span>
                  </div>
                )
              })}
            </div>
            <div style={{ display: 'flex', gap: 13, marginTop: 7 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--muted-dim)', fontSize: 8 }}>
                <span className="dot good" /> Profitable
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--muted-dim)', fontSize: 8 }}>
                <span className="dot bad" /> Losing
              </span>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="section-head">
            <div>
              <h2>Playbook performance</h2>
              <p>Small sample · not statistically significant</p>
            </div>
            <Pill tone="amber">Demo</Pill>
          </div>
          <div className="card-body" style={{ paddingTop: 4 }}>
            {playbooks.map((playbook) => (
              <div key={playbook.name} style={{ padding: '10px 0', borderBottom: '1px solid var(--line-soft)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {playbook.pnl >= 0 ? <TrendingUp size={12} color="var(--mint)" /> : <TrendingDown size={12} color="var(--red)" />}
                    <span style={{ fontSize: 9.5, color: 'var(--text-soft)' }}>{playbook.name}</span>
                  </div>
                  <span className={`mono ${playbook.pnl >= 0 ? 'pos' : 'neg'}`} style={{ fontSize: 9 }}>
                    {playbook.pnl >= 0 ? '+' : ''}
                    {inr(playbook.pnl)}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                  <div className="progress" style={{ flex: 1 }}>
                    <span style={{ width: `${playbook.winRate}%` }} />
                  </div>
                  <span className="mono" style={{ color: 'var(--muted-dim)', fontSize: 8 }}>
                    {playbook.winRate.toFixed(0)}% · {playbook.count} trades
                  </span>
                </div>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 12 }}>
              <span style={{ color: 'var(--muted-dim)', fontSize: 8.5 }}>Best / worst</span>
              <span className="mono" style={{ fontSize: 8.5 }}>
                <span className="pos">{inr(stats.best)}</span> / <span className="neg">{inr(stats.worst)}</span>
              </span>
            </div>
          </div>
        </div>
      </section>

      <Modal
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={selected ? `${selected.symbol} · post-trade review` : 'Post-trade review'}
        subtitle={selected ? `${selected.strategy} · closed ${shortDate(selected.closedAt)}` : undefined}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setSelected(null)}>Cancel</Button>
            <Button variant="primary" onClick={saveReview}>Save review</Button>
          </>
        }
      >
        {selected ? (
          <>
            <div className="detail-grid">
              <div className="detail-cell">
                <div className="detail-label">Entry</div>
                <div className="detail-value">{inr(selected.entry, 2)}</div>
              </div>
              <div className="detail-cell">
                <div className="detail-label">Exit</div>
                <div className="detail-value">{inr(selected.exit, 2)}</div>
              </div>
              <div className="detail-cell">
                <div className="detail-label">Realised P&amp;L</div>
                <div className={`detail-value ${selected.pnl >= 0 ? 'pos' : 'neg'}`}>
                  {selected.pnl >= 0 ? '+' : ''}
                  {inr(selected.pnl)} · {pct(selected.pnlPct)}
                </div>
              </div>
              <div className="detail-cell">
                <div className="detail-label">R multiple</div>
                <div className={`detail-value ${selected.rMultiple >= 0 ? 'pos' : 'neg'}`}>
                  {selected.rMultiple > 0 ? '+' : ''}
                  {selected.rMultiple.toFixed(2)}R
                </div>
              </div>
              <div className="detail-cell">
                <div className="detail-label">Holding period</div>
                <div className="detail-value">{selected.holdingDays} days</div>
              </div>
              <div className="detail-cell">
                <div className="detail-label">Setup</div>
                <div className="detail-value">{selected.setup}</div>
              </div>
            </div>

            <div className="form-field" style={{ marginTop: 14 }}>
              <label htmlFor="journal-notes">What worked / what to improve</label>
              <textarea
                id="journal-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Describe execution quality, whether the plan was followed, and the single lesson."
              />
              <small>Stored locally. Never enter broker credentials or personal account data here.</small>
            </div>
            <div className="form-field" style={{ marginTop: 12 }}>
              <label htmlFor="journal-tags">Tags</label>
              <div className="input-wrap no-prefix">
                <input
                  id="journal-tags"
                  value={tags}
                  onChange={(event) => setTags(event.target.value)}
                  placeholder="A+ setup, Winner, Lesson"
                />
              </div>
              <small>Comma-separated. Tags are used for filtering and pattern review.</small>
            </div>
          </>
        ) : null}
      </Modal>
    </>
  )
}
