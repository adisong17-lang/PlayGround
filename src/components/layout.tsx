import { useEffect, useState, type ComponentType } from 'react'
import {
  Activity,
  Bell,
  BookOpenText,
  BriefcaseBusiness,
  ChevronRight,
  FlaskConical,
  LayoutDashboard,
  ListOrdered,
  Menu,
  Radar,
  Search,
  Settings,
  ShieldCheck,
  X,
  Zap,
} from 'lucide-react'
import type { PageId } from '../types'
import { useApp } from '../lib/store'
import { DATA_MODE, MARKET_STATUS } from '../data/market'
import { StatusDot } from './ui'

export interface NavItem {
  id: PageId
  label: string
  icon: ComponentType<{ className?: string }>
  shortcut?: string
}

export const NAV_GROUPS: Array<{ label: string; items: NavItem[] }> = [
  {
    label: 'Workspace',
    items: [
      { id: 'overview', label: 'Overview', icon: LayoutDashboard, shortcut: 'G O' },
      { id: 'scanner', label: 'NSE Scanner', icon: Radar, shortcut: 'G S' },
      { id: 'positions', label: 'Positions', icon: BriefcaseBusiness },
      { id: 'orders', label: 'Orders', icon: ListOrdered },
      { id: 'journal', label: 'Trade Journal', icon: BookOpenText },
    ],
  },
  {
    label: 'Intelligence',
    items: [
      { id: 'research', label: 'Strategy Research', icon: FlaskConical },
      { id: 'risk', label: 'Risk Management', icon: ShieldCheck },
      { id: 'system', label: 'System Monitor', icon: Activity },
    ],
  },
]

export const NAV_ITEMS = NAV_GROUPS.flatMap((group) => group.items)
const PAGE_LABELS: Record<PageId, string> = {
  overview: 'Overview',
  scanner: 'NSE Scanner',
  positions: 'Positions',
  orders: 'Orders',
  journal: 'Trade Journal',
  research: 'Strategy Research',
  risk: 'Risk Management',
  system: 'System Monitor',
  settings: 'Settings',
}

export function useClock(): string {
  const [time, setTime] = useState(() =>
    new Date().toLocaleTimeString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }),
  )
  useEffect(() => {
    const timer = window.setInterval(() => {
      setTime(
        new Date().toLocaleTimeString('en-IN', {
          timeZone: 'Asia/Kolkata',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        }),
      )
    }, 1000)
    return () => window.clearInterval(timer)
  }, [])
  return time
}

export function Sidebar({ active, navigate }: { active: PageId; navigate: (page: PageId) => void }) {
  const { state } = useApp()
  return (
    <aside className="sidebar" aria-label="Main navigation">
      <div className="brand">
        <div className="brand-mark">GT</div>
        <div>
          <div className="brand-name">Gulshan Toppo</div>
          <div className="brand-sub">Trading Command Center</div>
        </div>
      </div>

      <div className="desk-card">
        <div className="desk-card-top">
          <div>
            <div className="desk-title">Swing Desk</div>
            <div className="desk-meta">NSE · INDIA · INR</div>
          </div>
          <span className="status-pill paper">Paper</span>
        </div>
      </div>

      <nav className="side-nav">
        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            <div className="nav-section-label">{group.label}</div>
            <ul className="nav-list">
              {group.items.map((item) => {
                const Icon = item.icon
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={`nav-link ${active === item.id ? 'active' : ''}`.trim()}
                      onClick={() => navigate(item.id)}
                      aria-current={active === item.id ? 'page' : undefined}
                    >
                      <Icon />
                      <span>{item.label}</span>
                      {item.shortcut ? <span className="nav-kbd">{item.shortcut}</span> : null}
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
        <div>
          <div className="nav-section-label">Workspace</div>
          <ul className="nav-list">
            <li>
              <button
                type="button"
                className={`nav-link ${active === 'settings' ? 'active' : ''}`.trim()}
                onClick={() => navigate('settings')}
                aria-current={active === 'settings' ? 'page' : undefined}
              >
                <Settings />
                <span>Settings</span>
              </button>
            </li>
          </ul>
        </div>
      </nav>

      <div className="sidebar-footer">
        <div className="engine-mini">
          <div className="engine-mini-head">
            <span>Engine</span>
            <StatusDot tone="warn" />
          </div>
          <div className="engine-mini-row">Awaiting backend</div>
          <div className="engine-mini-meta">No local engine bridge · demo fixture</div>
        </div>
        <div className="user-card">
          <div className="avatar">GT</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="user-name">Gulshan Toppo</div>
            <div className="user-role">Operator · Paper account</div>
          </div>
          <Zap size={12} color="#c7f36b" aria-hidden="true" />
        </div>
        <div className="mono" style={{ color: 'var(--muted-dim)', fontSize: 8, textAlign: 'center' }}>
          {state.kiteConnected ? 'Kite connected' : 'Kite not connected'}
        </div>
      </div>
    </aside>
  )
}

export function Topbar({
  active,
  onSearch,
  onMenu,
  onSystem,
}: {
  active: PageId
  onSearch: () => void
  onMenu: () => void
  onSystem: () => void
}) {
  const clock = useClock()
  return (
    <header className="topbar">
      <div className="topbar-left">
        <button type="button" className="icon-btn mobile-menu-btn" onClick={onMenu} aria-label="Open navigation">
          <Menu />
        </button>
        <div className="breadcrumb" aria-label="Breadcrumb">
          <span>Command Center</span>
          <span className="breadcrumb-sep">/</span>
          <strong>{PAGE_LABELS[active]}</strong>
        </div>
        <div className="topbar-status">
          <span className="status-pill paper">
            <StatusDot tone="good" /> {DATA_MODE === 'DEMO_FIXTURE' ? 'Demo' : 'Live'}
          </span>
          <span className="status-pill hide-mobile">{MARKET_STATUS === 'CLOSED' ? 'NSE closed' : 'NSE open'}</span>
          <span className="status-pill hide-tablet">{clock} IST</span>
        </div>
      </div>
      <div className="topbar-right">
        <button type="button" className="icon-btn" onClick={onSearch} aria-label="Search pages and stocks" title="Search">
          <Search />
        </button>
        <button type="button" className="icon-btn" onClick={onSystem} aria-label="View system alerts" title="System alerts">
          <Bell />
        </button>
        <div className="avatar" aria-hidden="true" style={{ width: 31, height: 31 }}>
          GT
        </div>
      </div>
    </header>
  )
}

export function MobileNav({ active, navigate, moreOpen, setMoreOpen }: { active: PageId; navigate: (page: PageId) => void; moreOpen: boolean; setMoreOpen: (open: boolean) => void }) {
  const items = [
    { id: 'overview' as const, label: 'Overview', icon: LayoutDashboard },
    { id: 'scanner' as const, label: 'Scanner', icon: Radar },
    { id: 'positions' as const, label: 'Positions', icon: BriefcaseBusiness },
    { id: 'orders' as const, label: 'Orders', icon: ListOrdered },
  ]
  return (
    <>
      {moreOpen ? (
        <>
          <div
            className="modal-overlay"
            style={{ zIndex: 80 }}
            onMouseDown={(event) => event.currentTarget === event.target && setMoreOpen(false)}
          >
            <div className="mobile-more" role="dialog" aria-label="All navigation">
              <div className="mobile-more-head">
                <span>All workspaces</span>
                <button type="button" className="icon-btn" onClick={() => setMoreOpen(false)} aria-label="Close menu">
                  <X />
                </button>
              </div>
              <div className="mobile-more-grid">
                {[...NAV_ITEMS, { id: 'settings' as const, label: 'Settings', icon: Settings }].map((item) => {
                  const Icon = item.icon
                  return (
                    <button
                      type="button"
                      key={item.id}
                      className={`mobile-more-item ${active === item.id ? 'active' : ''}`.trim()}
                      onClick={() => {
                        navigate(item.id)
                        setMoreOpen(false)
                      }}
                    >
                      <Icon />
                      {item.label}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </>
      ) : null}
      <nav className="mobile-nav" aria-label="Mobile navigation">
        {items.map((item) => {
          const Icon = item.icon
          return (
            <button
              type="button"
              key={item.id}
              className={`mobile-nav-item ${active === item.id ? 'active' : ''}`.trim()}
              onClick={() => navigate(item.id)}
              aria-current={active === item.id ? 'page' : undefined}
            >
              <Icon />
              {item.label}
            </button>
          )
        })}
        <button
          type="button"
          className={`mobile-nav-item ${moreOpen ? 'active' : ''}`.trim()}
          onClick={() => setMoreOpen(!moreOpen)}
          aria-expanded={moreOpen}
        >
          <Menu />
          More
        </button>
      </nav>
    </>
  )
}

export function DemoBanner({ onSystem }: { onSystem: () => void }) {
  return (
    <div className="demo-banner" role="status">
      <ShieldCheck />
      <span>
        <strong>Demonstration environment.</strong> Account, scanner, research and execution values are labelled
        fixtures — no live Kite session, engine database or market feed is connected.
      </span>
      <button type="button" className="demo-banner-link" onClick={onSystem}>
        Inspect system
      </button>
    </div>
  )
}

export function CommandPalette({
  open,
  onClose,
  navigate,
  openSignal,
}: {
  open: boolean
  onClose: () => void
  navigate: (page: PageId) => void
  openSignal: (symbol: string) => void
}) {
  const [query, setQuery] = useState('')
  const { state } = useApp()
  useEffect(() => {
    if (!open) setQuery('')
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  const pages = [...NAV_ITEMS, { id: 'settings' as const, label: 'Settings', icon: Settings }].filter((item) =>
    item.label.toLowerCase().includes(query.toLowerCase()),
  )
  const symbols = [...new Set([...state.watchlist, ...state.positions.map((position) => position.symbol)])]
    .filter((symbol) => symbol.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 5)
  return (
    <div className="modal-overlay" onMouseDown={(event) => event.currentTarget === event.target && onClose()}>
      <div className="modal command-modal" role="dialog" aria-label="Command search">
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '12px 15px', borderBottom: '1px solid var(--line-soft)' }}>
          <Search size={15} color="var(--muted)" aria-hidden="true" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search workspaces or symbols…"
            aria-label="Search"
            style={{
              width: '100%',
              border: 0,
              outline: 'none',
              background: 'transparent',
              color: 'var(--text)',
              fontSize: 12,
            }}
          />
          <kbd className="mono" style={{ color: 'var(--muted-dim)', fontSize: 8 }}>ESC</kbd>
        </div>
        <div className="modal-body" style={{ padding: '10px 9px 13px' }}>
          <div className="nav-section-label" style={{ padding: '3px 8px 6px' }}>Go to</div>
          {pages.map((item) => {
            const Icon = item.icon
            return (
              <button
                type="button"
                key={item.id}
                className="nav-link"
                onClick={() => {
                  navigate(item.id)
                  onClose()
                }}
              >
                <Icon />
                <span>{item.label}</span>
                <ChevronRight style={{ marginLeft: 'auto', width: 12, height: 12 }} />
              </button>
            )
          })}
          {symbols.length > 0 ? (
            <>
              <div className="nav-section-label" style={{ padding: '12px 8px 6px' }}>Symbols</div>
              {symbols.map((symbol) => (
                <button
                  type="button"
                  key={symbol}
                  className="nav-link"
                  onClick={() => {
                    openSignal(symbol)
                    onClose()
                  }}
                >
                  <Radar />
                  <span className="mono">{symbol}</span>
                  <span className="nav-kbd">Open setup</span>
                </button>
              ))}
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export function ToastHost() {
  const { toasts, dismissToast } = useApp()
  const icons = {
    success: '✓',
    danger: '!',
    warning: '!',
    info: 'i',
  }
  return (
    <div className="toast-stack" aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => (
        <div className="toast" key={toast.id}>
          <div className={`toast-icon ${toast.tone}`} aria-hidden="true">
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700 }}>{icons[toast.tone]}</span>
          </div>
          <div className="toast-main">
            <div className="toast-title">{toast.title}</div>
            {toast.message ? <div className="toast-message">{toast.message}</div> : null}
          </div>
          <button type="button" className="toast-close" onClick={() => dismissToast(toast.id)} aria-label="Dismiss notification">
            <X />
          </button>
        </div>
      ))}
    </div>
  )
}

export { PAGE_LABELS }
