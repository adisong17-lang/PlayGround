import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowRight, LockKeyhole, ShieldCheck } from 'lucide-react'
import type { PageId, Signal } from './types'
import { useApp } from './lib/store'
import { SIGNALS } from './data/market'
import { Button } from './components/ui'
import {
  CommandPalette,
  MobileNav,
  Sidebar,
  ToastHost,
  Topbar,
} from './components/layout'
import { SignalDetailDrawer } from './components/SignalDetail'
import { Overview } from './pages/Overview'
import { Scanner } from './pages/Scanner'
import { Positions } from './pages/Positions'
import { Orders } from './pages/Orders'
import { Journal } from './pages/Journal'
import { Research } from './pages/Research'
import { Risk } from './pages/Risk'
import { System } from './pages/System'
import { SettingsPage } from './pages/Settings'

const PAGES: PageId[] = [
  'overview',
  'scanner',
  'positions',
  'orders',
  'journal',
  'research',
  'risk',
  'system',
  'settings',
]

function pageFromHash(): PageId {
  const raw = window.location.hash.replace(/^#\/?/, '')
  return PAGES.includes(raw as PageId) ? (raw as PageId) : 'overview'
}

export default function App() {
  const { state, unlockSession } = useApp()
  const [page, setPage] = useState<PageId>(pageFromHash)
  const [selectedSignal, setSelectedSignal] = useState<Signal | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [passphrase, setPassphrase] = useState('')
  const [unlockError, setUnlockError] = useState(false)

  const navigate = useCallback((next: PageId) => {
    window.location.hash = next === 'overview' ? '/' : `/${next}`
    setPage(next)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  useEffect(() => {
    const onHash = () => setPage(pageFromHash())
    window.addEventListener('hashchange', onHash)
    if (!window.location.hash) window.history.replaceState(null, '', '#/')
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setSearchOpen(true)
        return
      }
      if (!typing && event.key === '/') {
        event.preventDefault()
        setSearchOpen(true)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const openSignal = useCallback((signal: Signal) => {
    setSelectedSignal(signal)
    setMoreOpen(false)
  }, [])

  const openSignalBySymbol = useCallback((symbol: string) => {
    const signal = SIGNALS.find((item) => item.symbol === symbol)
    if (signal) setSelectedSignal(signal)
  }, [])

  const content = useMemo(() => {
    switch (page) {
      case 'overview':
        return <Overview navigate={navigate} openSignal={openSignal} />
      case 'scanner':
        return <Scanner openSignal={openSignal} />
      case 'positions':
        return <Positions navigate={navigate} />
      case 'orders':
        return <Orders navigate={navigate} />
      case 'journal':
        return <Journal />
      case 'research':
        return <Research />
      case 'risk':
        return <Risk />
      case 'system':
        return <System />
      case 'settings':
        return <SettingsPage navigate={navigate} />
      default:
        return null
    }
  }, [navigate, openSignal, page])

  if (state.sessionLocked) {
    return (
      <div className="lock-screen">
        <div className="lock-grid" aria-hidden="true" />
        <div className="lock-card">
          <div className="brand" style={{ padding: '0 0 22px' }}>
            <div className="brand-mark">GT</div>
            <div>
              <div className="brand-name">Gulshan Toppo</div>
              <div className="brand-sub">Trading Command Center</div>
            </div>
          </div>
          <div className="lock-icon"><LockKeyhole /></div>
          <h1>Session locked</h1>
          <p>Enter the local demo passphrase to reopen the command center. This lock is a UX demonstration; production auth is server-verified.</p>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (!unlockSession(passphrase)) setUnlockError(true)
              else {
                setPassphrase('')
                setUnlockError(false)
              }
            }}
          >
            <label htmlFor="unlock-passphrase">Demo passphrase</label>
            <input
              id="unlock-passphrase"
              type="password"
              autoFocus
              value={passphrase}
              onChange={(event) => {
                setPassphrase(event.target.value)
                setUnlockError(false)
              }}
              placeholder="Enter demo passphrase"
              aria-invalid={unlockError}
            />
            {unlockError ? <div className="lock-error">Incorrect passphrase. The demo passphrase is “demo”.</div> : null}
            <Button variant="primary" type="submit" style={{ width: '100%', marginTop: 12 }}>
              <ShieldCheck /> Unlock workspace
            </Button>
          </form>
          <div className="lock-foot">
            <span><ShieldCheck size={11} /> Paper mode only</span>
            <span className="mono">NO BROKER SESSION</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <Sidebar active={page} navigate={navigate} />
      <div className="main-area">
        <Topbar
          active={page}
          onSearch={() => setSearchOpen(true)}
          onMenu={() => setMoreOpen(true)}
          onSystem={() => navigate('system')}
        />
        <main className="page-wrap" id="main-content">
          {content}
        </main>
      </div>
      <MobileNav active={page} navigate={navigate} moreOpen={moreOpen} setMoreOpen={setMoreOpen} />
      {selectedSignal ? <SignalDetailDrawer signal={selectedSignal} onClose={() => setSelectedSignal(null)} /> : null}
      <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} navigate={navigate} openSignal={openSignalBySymbol} />
      <ToastHost />
      <div className="sr-only" aria-live="polite">
        <ArrowRight /> {page}
      </div>
    </div>
  )
}
