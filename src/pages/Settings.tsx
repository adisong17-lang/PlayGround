import { useState } from 'react'
import {
  BellRing,
  CheckCircle2,
  CircleAlert,
  Database,
  ExternalLink,
  Fingerprint,
  KeyRound,
  Lock,
  RefreshCcw,
  Save,
  Server,
  Settings2,
  ShieldCheck,
  ShieldX,
  Smartphone,
  Terminal,
  UserRound,
} from 'lucide-react'
import type { PageId } from '../types'
import { useApp } from '../lib/store'
import { apiBaseLabel } from '../lib/api'
import { inr } from '../lib/format'
import { Button, ConfirmDialog, Modal, PageHeader, Pill, Toggle } from '../components/ui'

export function SettingsPage({ navigate }: { navigate: (page: PageId) => void }) {
  const {
    state,
    portfolio,
    backend,
    refreshBackend,
    toggleNotifications,
    resetDemo,
    lockSession,
    addToast,
    runSystemAction,
  } = useApp()
  const [name, setName] = useState('Gulshan Toppo')
  const [liveModal, setLiveModal] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)
  const telegramConfigured = backend.status === 'online' && backend.health.telegram_configured

  return (
    <>
      <PageHeader
        eyebrow="Workspace preferences · Local demo profile"
        title="Settings"
        subtitle="Account, execution safety, notifications and backend connection. Secrets are never entered or displayed in the frontend."
        actions={
          <>
            <Button variant="ghost" onClick={lockSession}>
              <Lock /> Lock dashboard
            </Button>
            <Button
              variant="primary"
              onClick={() =>
                addToast({ tone: 'success', title: 'Preferences saved locally', message: `Display name set to ${name}.` })
              }
            >
              <Save /> Save preferences
            </Button>
          </>
        }
      />

      <div className="mode-banner">
        <div>
          <div className="mode-banner-title">
            <ShieldCheck /> Paper mode enforced
          </div>
          <p>
            Live execution is structurally disabled in this build. Enabling it requires backend credentials, a verified
            Kite adapter, passing strategy gates and explicit server configuration — not a UI toggle.
          </p>
        </div>
        <Pill tone="lime">PAPER</Pill>
      </div>

      <div className="risk-layout">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="card">
            <div className="section-head">
              <div>
                <h2>Operator profile</h2>
                <p>Display preferences for this local workspace</p>
              </div>
              <UserRound className="icon-inline" />
            </div>
            <div className="card-body" style={{ paddingTop: 4 }}>
              <div className="form-grid">
                <div className="form-field">
                  <label htmlFor="profile-name">Display name</label>
                  <div className="input-wrap no-prefix">
                    <input id="profile-name" value={name} onChange={(event) => setName(event.target.value)} />
                  </div>
                </div>
                <div className="form-field">
                  <label>Account mode</label>
                  <div className="input-wrap no-prefix">
                    <input value="Paper trading" readOnly style={{ color: 'var(--muted)' }} />
                  </div>
                </div>
                <div className="form-field">
                  <label>Paper equity</label>
                  <div className="input-wrap no-prefix">
                    <input value={inr(portfolio.equity)} readOnly style={{ color: 'var(--muted)' }} />
                  </div>
                </div>
                <div className="form-field">
                  <label>Workspace</label>
                  <div className="input-wrap no-prefix">
                    <input value="NSE Swing Desk · India" readOnly style={{ color: 'var(--muted)' }} />
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 12 }}>
                <Smartphone size={12} color="var(--muted)" />
                <span style={{ color: 'var(--muted-dim)', fontSize: 8.5 }}>
                  Mobile-first layout tuned for Google Pixel 8a · 390 × 844 CSS px.
                </span>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="section-head">
              <div>
                <h2>Execution &amp; safety</h2>
                <p>Trading mode cannot be changed from the browser</p>
              </div>
              <ShieldX className="icon-inline" />
            </div>
            <div className="card-body" style={{ paddingTop: 4 }}>
              <div className="switch-row">
                <div className="switch-main">
                  <div className="switch-title">PAPER execution</div>
                  <div className="switch-desc">Orders fill in the local paper ledger. This is the default and only active mode.</div>
                </div>
                <Toggle checked={true} onChange={() => addToast({ tone: 'info', title: 'Paper mode is locked' })} disabled label="Paper mode" />
              </div>
              <div className="switch-row">
                <div className="switch-main">
                  <div className="switch-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    LIVE execution <Pill tone="red">Disabled</Pill>
                  </div>
                  <div className="switch-desc">
                    Requires a server-side Kite session, verified adapter, qualification gates, explicit confirmation and
                    operator enablement. The frontend toggle cannot bypass these requirements.
                  </div>
                </div>
                <Toggle checked={false} onChange={() => setLiveModal(true)} disabled={false} label="Live execution disabled" />
              </div>
              <div className="switch-row">
                <div className="switch-main">
                  <div className="switch-title">Pause new entries</div>
                  <div className="switch-desc">Equivalent to the risk kill switch. Does not cancel orders or close positions.</div>
                </div>
                <span className="mono" style={{ fontSize: 9, color: state.entriesPaused ? 'var(--red)' : 'var(--mint)' }}>
                  {state.entriesPaused ? 'PAUSED' : 'ACTIVE'}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 7, marginTop: 12 }}>
                <Button size="small" variant="ghost" onClick={() => navigate('risk')}>
                  <Settings2 /> Risk policy
                </Button>
                <Button size="small" variant="ghost" onClick={() => navigate('system')}>
                  <Terminal /> System controls
                </Button>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="section-head">
              <div>
                <h2>Alerts &amp; notifications</h2>
                <p>{telegramConfigured ? 'Telegram delivery configured on the API' : 'Telegram delivery is not configured on the API'}</p>
              </div>
              <BellRing className="icon-inline" />
            </div>
            <div className="card-body" style={{ paddingTop: 4 }}>
              <div className="switch-row">
                <div className="switch-main">
                  <div className="switch-title">In-browser notifications</div>
                  <div className="switch-desc">Show local toast alerts for paper fills, risk rejections and operator actions.</div>
                </div>
                <Toggle checked={state.notificationsEnabled} onChange={toggleNotifications} label="In-browser notifications" />
              </div>
              <div className="switch-row">
                <div className="switch-main">
                  <div className="switch-title">Telegram alerts</div>
                  <div className="switch-desc">
                    {telegramConfigured
                      ? 'Configured server-side. Paper fills and closes queue alerts without exposing the bot token to this browser.'
                      : 'Disabled. Add TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID to the backend environment, then restart the API.'}
                  </div>
                </div>
                <Toggle checked={telegramConfigured} onChange={() => addToast({ tone: telegramConfigured ? 'success' : 'warning', title: telegramConfigured ? 'Telegram configured' : 'Telegram not configured', message: telegramConfigured ? 'Delivery is managed by the authenticated API session.' : 'Credentials must be configured server-side; they cannot be entered safely in this browser.' })} disabled={false} label="Telegram alerts" />
              </div>
              <Button
                size="small"
                variant="ghost"
                style={{ marginTop: 11 }}
                onClick={() => {
                  if (telegramConfigured) {
                    addToast({ tone: 'info', title: 'Backend session required', message: 'POST /api/notifications/telegram/test with the authenticated session to verify delivery.' })
                  } else {
                    runSystemAction('telegram-test', 'Send Telegram test')
                  }
                }}
              >
                <BellRing /> {telegramConfigured ? 'Verify test via API' : 'Send test alert'}
              </Button>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="card">
            <div className="section-head">
              <div>
                <h2>Authentication</h2>
                <p>Local demo session</p>
              </div>
              <Fingerprint className="icon-inline" />
            </div>
            <div className="card-body" style={{ paddingTop: 5 }}>
              <div className="cost-row">
                <span>Session</span>
                <strong className="pos">Unlocked</strong>
              </div>
              <div className="cost-row">
                <span>Backend auth</span>
                <strong className={backend.status === 'online' ? 'pos' : 'neg'}>
                  {backend.status === 'online' ? 'API online · signed out' : backend.status === 'checking' ? 'Checking…' : 'Not connected'}
                </strong>
              </div>
              <div className="cost-row">
                <span>Transport</span>
                <strong>{backend.status === 'online' ? 'Loopback API · HttpOnly session' : 'Local browser only'}</strong>
              </div>
              <div className="cost-row">
                <span>Demo passphrase</span>
                <strong className="lime">demo</strong>
              </div>
              <div className="explanation" style={{ marginTop: 11 }}>
                This local lock is a UX demonstration, not real security. The FastAPI scaffold provides a
                server-verified HttpOnly cookie, CSRF protection and rate-limited login, but this UI does not sign in
                to the server session yet.
              </div>
              <Button size="small" variant="ghost" style={{ marginTop: 11 }} onClick={lockSession}>
                <Lock /> Lock now
              </Button>
            </div>
          </div>

          <div className="card">
            <div className="section-head">
              <div>
                <h2>Backend connection</h2>
                <p>Required for live data and real execution</p>
              </div>
              <Server className="icon-inline" />
            </div>
            <div className="card-body" style={{ paddingTop: 5 }}>
              <div className="cost-row">
                <span>Configuration</span>
                <strong className={backend.status === 'online' ? 'pos' : backend.status === 'checking' ? '' : 'neg'}>
                  {backend.status === 'online' ? 'Health check passed' : backend.status === 'checking' ? 'Checking…' : 'Not reachable'}
                </strong>
              </div>
              <div className="cost-row">
                <span>Local API</span>
                <strong>{apiBaseLabel()}</strong>
              </div>
              <div className="cost-row">
                <span>Transport</span>
                <strong>Loopback or TLS only</strong>
              </div>
              <div className="cost-row">
                <span>Execution mode</span>
                <strong>{backend.status === 'online' ? 'PAPER · live disabled' : 'Unverified'}</strong>
              </div>
              <div className="cost-row">
                <span>CORS origin</span>
                <strong>Explicit allowlist</strong>
              </div>
              <div className="cost-row">
                <span>Engine database</span>
                <strong className="neg">Not mounted</strong>
              </div>
              <div className="explanation" style={{ marginTop: 11 }}>
                {backend.status === 'online'
                  ? `Local API responded in ${backend.latencyMs} ms. Broker and engine connections remain absent, and browser paper actions are not routed to the server ledger yet.`
                  : backend.status === 'offline'
                    ? `${backend.error} Start the FastAPI service on 127.0.0.1:8787 to enable the authenticated API scaffold.`
                    : 'Probing the local API health endpoint.'}
              </div>
              <Button
                size="small"
                variant="ghost"
                style={{ marginTop: 11 }}
                onClick={() => {
                  void refreshBackend()
                  addToast({ tone: 'info', title: 'Backend health rechecked' })
                }}
              >
                <ExternalLink /> Check backend
              </Button>
            </div>
          </div>

          <div className="card">
            <div className="section-head">
              <div>
                <h2>Security posture</h2>
                <p>Verified for this demo</p>
              </div>
              <KeyRound className="icon-inline" />
            </div>
            <div className="card-body" style={{ paddingTop: 4 }}>
              {[
                { label: 'Secrets in frontend bundle', value: 'None', good: true },
                { label: 'Live broker route', value: 'Disabled', good: true },
                { label: 'Local storage secrets', value: 'None', good: true },
                { label: 'Public API exposure', value: 'None', good: true },
                { label: 'Real authentication', value: backend.status === 'online' ? 'API available · signed out' : 'Scaffold only', good: false },
                { label: 'Engine bridge', value: 'Not connected', good: false },
              ].map((item) => (
                <div className="risk-check" key={item.label}>
                  <span className={`check-dot ${item.good ? 'pass' : 'warn'}`}>
                    {item.good ? <CheckCircle2 /> : <CircleAlert />}
                  </span>
                  <div className="check-main">
                    <div className="check-label">{item.label}</div>
                    <div className="check-detail">{item.value}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 10 }}>
        <div className="section-head">
          <div>
            <h2>Data &amp; local state</h2>
            <p>Reset only the browser demo. No engine data or broker data is touched.</p>
          </div>
          <Database className="icon-inline" />
        </div>
        <div className="card-body" style={{ paddingTop: 4, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <div className="settings-label">Paper ledger &amp; preferences</div>
            <div className="settings-desc">
              Stored in this browser via localStorage under the versioned demo key. Paper orders, positions, journal
              notes, watchlist and risk settings can all be reset.
            </div>
          </div>
          <Button variant="danger" onClick={() => setResetOpen(true)}>
            <RefreshCcw /> Reset demo state
          </Button>
        </div>
      </div>

      <Modal
        open={liveModal}
        onClose={() => setLiveModal(false)}
        title="Live execution is not available"
        subtitle="The frontend cannot enable live trading, by design."
        footer={
          <>
            <Button variant="ghost" onClick={() => setLiveModal(false)}>Close</Button>
            <Button
              variant="primary"
              onClick={() => {
                setLiveModal(false)
                addToast({ tone: 'danger', title: 'Live enablement blocked', message: 'Required backend, broker and strategy controls are not satisfied.' })
              }}
            >
              Acknowledge
            </Button>
          </>
        }
      >
        <div className="announce" style={{ marginTop: 0 }}>
          <ShieldX />
          <span><strong>No live route exists in this build.</strong> Attempting to enable it from the UI cannot succeed.</span>
        </div>
        {[
          'Authenticated backend with server-side session',
          'Verified Zerodha Kite Connect adapter and dependency',
          'Kite credentials and fresh access token',
          'Passing out-of-sample / walk-forward strategy gates',
          'Server-side duplicate, exposure and loss-limit enforcement',
          'Explicit operator enablement outside the frontend',
        ].map((item) => (
          <div className="risk-check" key={item}>
            <span className="check-dot fail"><CircleAlert /></span>
            <div className="check-main">
              <div className="check-label">{item}</div>
              <div className="check-detail">Not satisfied in this runtime.</div>
            </div>
          </div>
        ))}
      </Modal>

      <ConfirmDialog
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        onConfirm={() => {
          resetDemo()
          setResetOpen(false)
        }}
        title="Reset the entire browser demo?"
        subtitle="This clears locally stored paper positions, orders, journal edits and preferences."
        confirmLabel="Reset local demo"
        tone="danger"
      >
        <p style={{ color: 'var(--muted)', fontSize: 9.5, lineHeight: 1.55 }}>
          No real trading data, broker credentials or engine records exist in this browser, so none can be affected.
        </p>
      </ConfirmDialog>
    </>
  )
}
