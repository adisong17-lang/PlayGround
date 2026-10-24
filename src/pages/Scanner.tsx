import { useMemo, useState } from 'react'
import {
  ArrowDownUp,
  ArrowDownWideNarrow,
  ArrowUpWideNarrow,
  Download,
  Filter,
  Play,
  Radar,
  RefreshCw,
  Search,
  Star,
  TrendingDown,
  TrendingUp,
  Minus,
} from 'lucide-react'
import type { Signal, SetupType } from '../types'
import { HISTORICAL_SIGNALS, SIGNALS } from '../data/market'
import { useApp } from '../lib/store'
import { calculatePositionSize } from '../lib/risk'
import { inr, pct, shortDate } from '../lib/format'
import { Button, EmptyState, MiniSparkline, PageHeader, Pill } from '../components/ui'

type Tab = 'All' | SetupType | 'Watchlist' | 'History'
type SortKey = 'score' | 'rsRank' | 'momentum' | 'price' | 'rr' | 'volume' | 'atrPct'

const TABS: Tab[] = ['All', 'Breakout', 'Pullback', 'Momentum', 'Watchlist', 'History']

const SETUP_TONE: Record<SetupType, 'lime' | 'cyan' | 'violet'> = {
  Breakout: 'lime',
  Pullback: 'cyan',
  Momentum: 'violet',
}

function TrendIcon({ trend }: { trend: string }) {
  if (trend === 'Rising') return <TrendingUp />
  if (trend === 'Falling') return <TrendingDown />
  return <Minus />
}

export function Scanner({ openSignal }: { openSignal: (signal: Signal) => void }) {
  const { state, toggleWatchlist, runScan, addToast } = useApp()
  const [tab, setTab] = useState<Tab>('All')
  const [query, setQuery] = useState('')
  const [trend, setTrend] = useState<'All' | 'Rising' | 'Sideways'>('All')
  const [minRs, setMinRs] = useState(0)
  const [sortKey, setSortKey] = useState<SortKey>('score')
  const [sortDesc, setSortDesc] = useState(true)
  const [scanning, setScanning] = useState(false)

  const source = tab === 'History' ? HISTORICAL_SIGNALS : SIGNALS

  const signals = useMemo(() => {
    const filtered = source.filter((signal) => {
      if (tab === 'Watchlist' && !state.watchlist.includes(signal.symbol)) return false
      if ((tab === 'Breakout' || tab === 'Pullback' || tab === 'Momentum') && signal.setup !== tab) return false
      if (query) {
        const needle = query.toLowerCase()
        if (!signal.symbol.toLowerCase().includes(needle) && !signal.name.toLowerCase().includes(needle)) return false
      }
      if (trend !== 'All' && signal.dailyTrend !== trend) return false
      if (signal.rsRank < minRs) return false
      return true
    })
    return filtered.sort((a, b) => {
      let aValue = 0
      let bValue = 0
      if (sortKey === 'volume') {
        aValue = a.volume / a.avgVolume
        bValue = b.volume / b.avgVolume
      } else if (sortKey === 'rr') {
        aValue = a.rr
        bValue = b.rr
      } else {
        aValue = a[sortKey]
        bValue = b[sortKey]
      }
      return sortDesc ? bValue - aValue : aValue - bValue
    })
  }, [source, tab, query, trend, minRs, sortKey, sortDesc, state.watchlist])

  const breakoutCount = SIGNALS.filter((signal) => signal.setup === 'Breakout').length
  const pullbackCount = SIGNALS.filter((signal) => signal.setup === 'Pullback').length

  function changeSort(key: SortKey) {
    if (sortKey === key) setSortDesc(!sortDesc)
    else {
      setSortKey(key)
      setSortDesc(true)
    }
  }

  async function scan() {
    setScanning(true)
    await runScan()
    setScanning(false)
  }

  function exportCsv() {
    const header = 'symbol,setup,score,rs,momentum,price,entry_low,entry_high,stop,target,rr,signal_date,strategy'
    const rows = signals.map((signal) =>
      [
        signal.symbol,
        signal.setup,
        signal.score,
        signal.rsRank,
        signal.momentum,
        signal.price,
        signal.entryLow,
        signal.entryHigh,
        signal.stop,
        signal.target1,
        signal.rr,
        signal.signalDate,
        signal.strategy,
      ].join(','),
    )
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'gulshan-scanner-demo.csv'
    link.click()
    URL.revokeObjectURL(url)
    addToast({ tone: 'info', title: 'Demo signals exported', message: 'Fixture CSV created in the browser.' })
  }

  function SortHeader({ label, column, align = 'left' }: { label: string; column: SortKey; align?: 'left' | 'right' }) {
    const active = sortKey === column
    return (
      <th
        onClick={() => changeSort(column)}
        aria-sort={active ? (sortDesc ? 'descending' : 'ascending') : 'none'}
        style={{ textAlign: align }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
          {label}
          {active ? (
            sortDesc ? (
              <ArrowDownWideNarrow style={{ width: 9, height: 9 }} />
            ) : (
              <ArrowUpWideNarrow style={{ width: 9, height: 9 }} />
            )
          ) : (
            <ArrowDownUp style={{ width: 8, height: 8, opacity: 0.4 }} />
          )}
        </span>
      </th>
    )
  }

  return (
    <>
      <PageHeader
        eyebrow="Universe · NSE eligible equities · Demo fixture"
        title="NSE swing scanner"
        subtitle="Daily and weekly trend filters, relative-strength ranking, breakout and pullback candidates. Candidate plans are fixture data and require engine validation before use."
        actions={
          <>
            <Button variant="ghost" onClick={exportCsv}>
              <Download /> Export CSV
            </Button>
            <Button variant="primary" onClick={scan} disabled={scanning}>
              {scanning ? <RefreshCw style={{ animation: 'spin 1s linear infinite' }} /> : <Play />}
              {scanning ? 'Scanning…' : 'Run scan'}
            </Button>
          </>
        }
      />

      <div className="announce">
        <Radar />
        <span>
          <strong>Eligible universe only.</strong> 1,842 symbols pass price, turnover and circuit filters. Signals shown
          here are deterministic demo rows, not live recommendations.
        </span>
      </div>

      <section className="summary-strip" aria-label="Scanner summary">
        <div className="summary-cell">
          <div className="summary-label">Universe evaluated</div>
          <div className="summary-value">1,842</div>
          <div className="summary-detail">NSE · price &gt; ₹50 · turnover &gt; ₹5Cr</div>
        </div>
        <div className="summary-cell">
          <div className="summary-label">Candidates</div>
          <div className="summary-value lime">{SIGNALS.length}</div>
          <div className="summary-detail">Score ≥ 65 · thesis available</div>
        </div>
        <div className="summary-cell">
          <div className="summary-label">Breakout / pullback</div>
          <div className="summary-value">
            {breakoutCount} <span className="text-dim">/</span> {pullbackCount}
          </div>
          <div className="summary-detail">Momentum {SIGNALS.length - breakoutCount - pullbackCount}</div>
        </div>
        <div className="summary-cell">
          <div className="summary-label">Watchlist</div>
          <div className="summary-value">{state.watchlist.length}</div>
          <div className="summary-detail">Tracked locally on this device</div>
        </div>
      </section>

      <div className="card table-card">
        <div className="filter-bar">
          <div className="filter-left">
            <div className="tab-list" role="tablist" aria-label="Signal categories">
              {TABS.map((item) => (
                <button
                  type="button"
                  key={item}
                  className={tab === item ? 'active' : ''}
                  onClick={() => setTab(item)}
                  role="tab"
                  aria-selected={tab === item}
                >
                  {item}
                  {item === 'Watchlist' ? ` ${state.watchlist.length}` : ''}
                </button>
              ))}
            </div>
          </div>
          <div className="filter-right">
            <label className="search-box">
              <Search />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search symbol or company…"
                aria-label="Search scanner"
              />
            </label>
            <select
              className="select-compact"
              value={trend}
              onChange={(event) => setTrend(event.target.value as typeof trend)}
              aria-label="Daily trend filter"
            >
              <option value="All">Daily trend: all</option>
              <option value="Rising">Daily trend: rising</option>
              <option value="Sideways">Daily trend: sideways</option>
            </select>
            <select
              className="select-compact"
              value={minRs}
              onChange={(event) => setMinRs(Number(event.target.value))}
              aria-label="Minimum relative strength"
            >
              <option value={0}>RS: any</option>
              <option value={70}>RS ≥ 70</option>
              <option value={80}>RS ≥ 80</option>
              <option value={90}>RS ≥ 90</option>
            </select>
            <Button size="small" variant="ghost" onClick={() => { setQuery(''); setTrend('All'); setMinRs(0); setTab('All') }}>
              <Filter /> Reset
            </Button>
          </div>
        </div>

        {signals.length === 0 ? (
          <EmptyState
            icon={<Radar />}
            title="No setups match these filters"
            text="Try widening the relative-strength floor, switching the trend filter, or clearing the search. The watchlist is stored only in this browser."
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table scanner-table">
              <thead>
                <tr>
                  <th>Instrument</th>
                  <th>Setup</th>
                  <th>Trend D / W</th>
                  <SortHeader label="RS" column="rsRank" />
                  <SortHeader label="Mom." column="momentum" />
                  <SortHeader label="Price" column="price" />
                  <SortHeader label="Vol" column="volume" />
                  <SortHeader label="ATR%" column="atrPct" />
                  <th>Entry zone</th>
                  <th>Stop</th>
                  <SortHeader label="R:R" column="rr" />
                  <th>Risk size</th>
                  {tab === 'History' ? <th>Outcome</th> : <SortHeader label="Signal" column="score" />}
                  <th aria-label="Watchlist" />
                </tr>
              </thead>
              <tbody>
                {signals.map((signal) => {
                  const sizing = calculatePositionSize(
                    state.risk.equity,
                    state.risk.riskPerTradePct,
                    signal.entryHigh,
                    signal.stop,
                    state.risk.gapRiskBufferPct,
                  )
                  const watched = state.watchlist.includes(signal.symbol)
                  return (
                    <tr
                      key={signal.id}
                      onClick={() => openSignal(signal)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          openSignal(signal)
                        }
                      }}
                      tabIndex={0}
                      aria-label={`Open ${signal.symbol} signal details`}
                    >
                      <td>
                        <div className="symbol-cell">
                          <span className="symbol-avatar">{signal.symbol.slice(0, 2)}</span>
                          <div>
                            <div className="symbol-name">{signal.symbol}</div>
                            <div className="symbol-company">
                              {signal.name} · {shortDate(signal.signalDate)}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <Pill tone={SETUP_TONE[signal.setup]}>{signal.setup}</Pill>
                      </td>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <span className="trend-cell">
                            <TrendIcon trend={signal.dailyTrend} /> {signal.dailyTrend}
                          </span>
                          <span className="trend-cell" style={{ color: 'var(--muted-dim)' }}>
                            <TrendIcon trend={signal.weeklyTrend} /> {signal.weeklyTrend}
                          </span>
                        </div>
                      </td>
                      <td className="num">
                        <span className="rank-cell">
                          {signal.rsRank}
                          <span className="rank-bar">
                            <span style={{ width: `${signal.rsRank}%` }} />
                          </span>
                        </span>
                      </td>
                      <td className={`num ${signal.momentum >= 0 ? 'pos' : 'neg'}`}>{pct(signal.momentum, 1)}</td>
                      <td className="num">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <MiniSparkline data={signal.spark} positive={signal.changePct >= 0} width={38} height={15} />
                          <span>{inr(signal.price, 1)}</span>
                        </div>
                      </td>
                      <td className="num">{(signal.volume / signal.avgVolume).toFixed(1)}×</td>
                      <td className="num">{signal.atrPct.toFixed(1)}%</td>
                      <td className="num" style={{ fontSize: 9 }}>
                        {inr(signal.entryLow, 0)}–{inr(signal.entryHigh, 0)}
                      </td>
                      <td className="num neg">{inr(signal.stop, 1)}</td>
                      <td className="num">{signal.rr.toFixed(1)}R</td>
                      <td className="num" style={{ fontSize: 9 }}>
                        {sizing.qty} sh · {inr(sizing.qty * signal.entryHigh)}
                      </td>
                      {tab === 'History' ? (
                        <td>
                          <Pill tone={signal.outcome === 'Target hit' ? 'mint' : signal.outcome === 'Stopped out' ? 'red' : 'neutral'}>
                            {signal.outcome ?? 'Open'}
                          </Pill>
                        </td>
                      ) : (
                        <td>
                          <span className="signal-score" style={{ width: 27, height: 23, fontSize: 9 }}>
                            {signal.score}
                          </span>
                        </td>
                      )}
                      <td>
                        <button
                          type="button"
                          className="icon-btn"
                          style={{ width: 24, height: 24, border: 0, background: 'transparent' }}
                          onClick={(event) => {
                            event.stopPropagation()
                            toggleWatchlist(signal.symbol)
                          }}
                          aria-label={watched ? `Remove ${signal.symbol} from watchlist` : `Add ${signal.symbol} to watchlist`}
                        >
                          <Star size={12} fill={watched ? 'var(--amber)' : 'none'} color={watched ? 'var(--amber)' : 'var(--muted-dim)'} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '10px 16px', borderTop: '1px solid var(--line-soft)', flexWrap: 'wrap' }}>
          <span className="mono" style={{ fontSize: 8, color: 'var(--muted-dim)' }}>
            {signals.length} rows · sorted by {sortKey} {sortDesc ? 'desc' : 'asc'} · demo snapshot
          </span>
          <span className="mono" style={{ fontSize: 8, color: 'var(--muted-dim)' }}>
            Sizing at {state.risk.riskPerTradePct}% equity risk · {state.risk.maxOpenPositions} position cap
          </span>
        </div>
      </div>
    </>
  )
}
