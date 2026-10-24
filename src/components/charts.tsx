import { useId, useMemo, useState, type PointerEvent } from 'react'
import type { EquityPoint } from '../types'
import { compactInr, inr, pct } from '../lib/format'
import { Segmented } from './ui'

const RANGES = ['1M', '3M', '6M', '1Y'] as const
type Range = (typeof RANGES)[number]
const RANGE_POINTS: Record<Range, number> = { '1M': 22, '3M': 66, '6M': 126, '1Y': 252 }

const W = 860
const H = 242
const M = { top: 12, right: 8, bottom: 22, left: 47 }

function dateLabel(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
}

export function EquityChart({ data, compact = false }: { data: EquityPoint[]; compact?: boolean }) {
  const [range, setRange] = useState<Range>('1Y')
  const [hover, setHover] = useState<number | null>(null)
  const gradientId = useId().replace(/:/g, '')
  const visible = useMemo(() => data.slice(-RANGE_POINTS[range]), [data, range])
  const chart = useMemo(() => {
    const plottedEquity = visible.map((point) => point.equity)
    const plottedBenchmark = visible.map(
      (point) => (visible[0].equity * point.benchmark) / Math.max(1, visible[0].benchmark),
    )
    const min = Math.min(...plottedEquity, ...plottedBenchmark)
    const max = Math.max(...plottedEquity, ...plottedBenchmark)
    const padding = Math.max(4000, (max - min) * 0.16)
    const lo = min - padding
    const hi = max + padding
    const innerW = W - M.left - M.right
    const innerH = H - M.top - M.bottom
    const x = (index: number) => M.left + (index / Math.max(1, visible.length - 1)) * innerW
    const y = (value: number) => M.top + ((hi - value) / Math.max(1, hi - lo)) * innerH
    const equityPoints = plottedEquity.map((value, index) => [x(index), y(value)] as const)
    const benchPoints = plottedBenchmark.map((value, index) => [x(index), y(value)] as const)
    const line = (points: ReadonlyArray<readonly [number, number]>) =>
      points.map(([px, py], index) => `${index === 0 ? 'M' : 'L'}${px.toFixed(2)},${py.toFixed(2)}`).join(' ')
    const area = `${line(equityPoints)} L${x(visible.length - 1).toFixed(2)},${(H - M.bottom).toFixed(2)} L${M.left},${(H - M.bottom).toFixed(2)} Z`
    const grid = [0, 0.25, 0.5, 0.75, 1].map((fraction) => {
      const value = hi - (hi - lo) * fraction
      return { value, y: M.top + innerH * fraction }
    })
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => {
      const index = Math.min(visible.length - 1, Math.round(fraction * (visible.length - 1)))
      return { index, x: x(index), label: dateLabel(visible[index].date) }
    })
    return { equityPoints, benchPoints, line, area, grid, ticks, innerH, x, y }
  }, [visible])

  const active = hover === null ? visible.length - 1 : hover
  const activePoint = visible[active]
  const activeBenchmark =
    activePoint && (visible[0].equity * activePoint.benchmark) / Math.max(1, visible[0].benchmark)
  const change = activePoint ? activePoint.equity - visible[0].equity : 0
  const changePct = activePoint ? (change / visible[0].equity) * 100 : 0

  function onPointerMove(event: PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    const px = ((event.clientX - rect.left) / rect.width) * W
    const ratio = Math.max(0, Math.min(1, (px - M.left) / (W - M.left - M.right)))
    setHover(Math.round(ratio * (visible.length - 1)))
  }

  return (
    <>
      <div className="chart-toolbar">
        <div>
          <div className="chart-value-row">
            <span className="chart-value">{activePoint ? inr(activePoint.equity) : '—'}</span>
            <span className={`chart-delta ${change >= 0 ? 'pos' : 'neg'}`}>
              {change >= 0 ? '+' : ''}
              {inr(change)} ({pct(changePct)})
            </span>
          </div>
          <div className="card-sub">Since {dateLabel(visible[0]?.date ?? '2026-01-01')} · paper equity</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
          {!compact ? (
            <div className="chart-legend" aria-hidden="true">
              <span className="legend-key">
                <i className="legend-line" /> Equity
              </span>
              <span className="legend-key">
                <i className="legend-line bench" /> NIFTY 50
              </span>
            </div>
          ) : null}
          <Segmented options={RANGES} value={range} onChange={setRange} ariaLabel="Equity chart range" />
        </div>
      </div>
      <div className="equity-chart-wrap">
        <svg
          className="equity-chart"
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label="Simulated paper equity curve compared with the NIFTY 50 benchmark"
          onPointerMove={onPointerMove}
          onPointerLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id={`equity-fill-${gradientId}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#c7f36b" stopOpacity="0.19" />
              <stop offset="65%" stopColor="#c7f36b" stopOpacity="0.035" />
              <stop offset="100%" stopColor="#c7f36b" stopOpacity="0" />
            </linearGradient>
            <filter id={`chart-glow-${gradientId}`} x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          {chart.grid.map((line) => (
            <g key={line.y}>
              <line
                x1={M.left}
                x2={W - M.right}
                y1={line.y}
                y2={line.y}
                stroke="#1a2532"
                strokeWidth="1"
                strokeDasharray={line.value === chart.grid[4].value ? '0' : '2 4'}
              />
              <text
                x={M.left - 7}
                y={line.y + 3}
                fill="#5b6879"
                fontSize="8.4"
                fontFamily="JetBrains Mono Variable, monospace"
                textAnchor="end"
              >
                {compactInr(line.value)}
              </text>
            </g>
          ))}
          <path d={chart.area} fill={`url(#equity-fill-${gradientId})`} />
          <path
            d={chart.line(chart.benchPoints)}
            fill="none"
            stroke="#5e6e81"
            strokeWidth="1.2"
            strokeDasharray="4 4"
            strokeLinecap="round"
          />
          <path
            d={chart.line(chart.equityPoints)}
            fill="none"
            stroke="#c7f36b"
            strokeWidth="1.7"
            strokeLinejoin="round"
            strokeLinecap="round"
            filter={`url(#chart-glow-${gradientId})`}
          />
          {activePoint ? (
            <>
              <line
                x1={chart.x(active)}
                x2={chart.x(active)}
                y1={M.top}
                y2={H - M.bottom}
                stroke="#3b4b5e"
                strokeWidth="1"
                strokeDasharray="3 3"
              />
              <circle
                cx={chart.x(active)}
                cy={chart.y(activePoint.equity)}
                r="3.4"
                fill="#c7f36b"
                stroke="#0d1219"
                strokeWidth="1.6"
              />
            </>
          ) : null}
          {chart.ticks.map((tick) => (
            <text
              key={tick.index}
              x={tick.x}
              y={H - 4}
              fill="#5b6879"
              fontSize="8"
              fontFamily="JetBrains Mono Variable, monospace"
              textAnchor={tick.index === 0 ? 'start' : tick.index === visible.length - 1 ? 'end' : 'middle'}
            >
              {tick.label}
            </text>
          ))}
        </svg>
        {hover !== null && activePoint ? (
          <div
            className="chart-tooltip"
            style={{ left: `${(chart.x(active) / W) * 100}%` }}
            role="status"
          >
            <div className="chart-tooltip-date">{dateLabel(activePoint.date)}</div>
            <div className="chart-tooltip-row">
              <span>Equity</span>
              <strong>{inr(activePoint.equity)}</strong>
            </div>
            <div className="chart-tooltip-row">
              <span>NIFTY 50</span>
              <strong>{inr(activeBenchmark ?? 0)}</strong>
            </div>
            <div className="chart-tooltip-row">
              <span>Drawdown</span>
              <strong className={activePoint.drawdown < 0 ? 'neg' : ''}>{pct(activePoint.drawdown)}</strong>
            </div>
          </div>
        ) : null}
      </div>
      <div className="chart-foot">
        <span>Simulated account · not live performance</span>
        <span>Max DD {pct(Math.min(...visible.map((point) => point.drawdown)))}</span>
      </div>
    </>
  )
}

export function SignalChart({ data, positive = true }: { data: number[]; positive?: boolean }) {
  const id = useId().replace(/:/g, '')
  const width = 460
  const height = 138
  const min = Math.min(...data)
  const max = Math.max(...data)
  const span = max - min || 1
  const points = data.map((value, index) => {
    const x = (index / Math.max(1, data.length - 1)) * width
    const y = height - 8 - ((value - min) / span) * (height - 16)
    return `${x.toFixed(2)},${y.toFixed(2)}`
  })
  const last = points[points.length - 1]
  const color = positive ? '#63e6be' : '#ff6f86'
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="130" role="img" aria-label="Signal price history">
      <defs>
        <linearGradient id={`signal-fill-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.15" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((f) => (
        <line
          key={f}
          x1="0"
          x2={width}
          y1={height * f}
          y2={height * f}
          stroke="#1a2532"
          strokeDasharray="2 5"
        />
      ))}
      <polygon points={`0,${height} ${points.join(' ')} ${width},${height}`} fill={`url(#signal-fill-${id})`} />
      <polyline points={points.join(' ')} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx={last.split(',')[0]} cy={last.split(',')[1]} r="3" fill={color} />
    </svg>
  )
}
