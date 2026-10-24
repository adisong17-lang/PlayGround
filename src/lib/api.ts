export interface BackendHealth {
  service: string
  status: 'ok'
  api_version: string
  mode: 'PAPER'
  live_execution: 'DISABLED'
  broker_connected: boolean
  engine_connected: boolean
  data_mode: 'DEMO_FIXTURE'
  auth: 'enabled'
  telegram_configured: boolean
  time: string
}

export type BackendConnection =
  | { status: 'checking' }
  | { status: 'online'; latencyMs: number; health: BackendHealth }
  | { status: 'offline'; error: string }

const API_BASE = (import.meta.env.VITE_API_BASE || '/api').replace(/\/$/, '')

export function apiBaseLabel(): string {
  if (API_BASE.startsWith('http')) return new URL(API_BASE).host
  return API_BASE
}

export async function probeBackend(timeoutMs = 2500): Promise<BackendConnection> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  const started = performance.now()
  try {
    const response = await fetch(`${API_BASE}/health`, {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
    if (!response.ok) {
      return { status: 'offline', error: `Health check returned HTTP ${response.status}.` }
    }
    const health = (await response.json()) as BackendHealth
    if (health.service !== 'gulshan-command-api' || health.status !== 'ok') {
      return { status: 'offline', error: 'Unexpected health response from the local API.' }
    }
    return {
      status: 'online',
      latencyMs: Math.max(1, Math.round(performance.now() - started)),
      health,
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { status: 'offline', error: 'Health check timed out.' }
    }
    return { status: 'offline', error: 'Local API is not reachable.' }
  } finally {
    window.clearTimeout(timer)
  }
}
