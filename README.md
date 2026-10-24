# Gulshan Toppo · Trading Command Center

A mobile-first trading operations dashboard for an NSE swing desk. The interface covers scanner review, paper positions and orders, trade journaling, strategy research, risk governance and system diagnostics.

The build is intentionally **paper-only**. It does not contain broker credentials, does not place real orders and does not claim that a strategy is live-ready. All market and account values shown by default are deterministic demo fixtures.

## Stack

- React 18, TypeScript, Vite 6
- Vitest and ESLint
- FastAPI and Pydantic v2
- Lucide icons, locally bundled Inter and JetBrains Mono

## Run the dashboard

```bash
npm install
npm run dev -- --port 3002
```

Open `http://localhost:3002/#/`.

The demo unlock passphrase is `demo`. The lock is a local UX demonstration, not server authentication. Browser paper state is stored under `gulshan-command-center-v3` in localStorage.

## Run the API scaffold

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r backend/requirements.txt

export GT_PASSPHRASE_HASH="$(python backend/scripts/hash_passphrase.py)"
export GT_SESSION_SECRET="$(python -c 'import secrets; print(secrets.token_urlsafe(48))')"
export GT_STATE_FILE="$PWD/.data/paper-ledger.json"

# Optional Telegram alerts. Use a newly rotated token, never a token posted in chat.
export TELEGRAM_BOT_TOKEN="<new bot token>"
export TELEGRAM_CHAT_ID="<chat id>"

PYTHONPATH=backend uvicorn gulshan_api.main:app --host 127.0.0.1 --port 8787
```

The Vite dev server proxies `/api` to `127.0.0.1:8787`. The Settings and System pages probe `/api/health` and display the actual connection state.

For local-only development, omitting `GT_PASSPHRASE_HASH` and `GT_SESSION_SECRET` falls back to the passphrase `demo` and an ephemeral session secret. Production startup fails unless both values are explicitly configured.

## API surface

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/health` | Public | Truthful runtime status; no secrets |
| POST | `/api/auth/login` | Public, rate-limited | Verify passphrase and set an HttpOnly cookie |
| GET | `/api/auth/session` | Session | Read CSRF token and expiry |
| POST | `/api/auth/logout` | Session + CSRF | Clear the server session |
| GET | `/api/system` | Session | Backend configuration status |
| GET | `/api/notifications/telegram` | Session | Masked Telegram configuration status |
| POST | `/api/notifications/telegram/test` | Session + CSRF | Deliver a server-side test alert |
| GET | `/api/account` | Session | Server paper account and risk state |
| GET/PUT | `/api/risk` | Session / CSRF | Read or update risk policy |
| POST | `/api/risk/evaluate` | Session + CSRF | Server-side pre-trade risk decision |
| GET | `/api/orders` | Session | Server paper orders |
| POST | `/api/orders/paper` | Session + CSRF + `Idempotency-Key` | Risk-checked paper fill |
| POST | `/api/orders/{id}/cancel` | Session + CSRF | Cancel a pending order |
| GET | `/api/positions` | Session | Server paper positions |
| POST | `/api/positions/{id}/close` | Session + CSRF | Close at the server's paper price |
| GET | `/api/journal` | Session | Closed paper trades |

The browser interface currently uses its own paper ledger. The API exposes the same risk policy and ledger concepts for server-side integration, but the UI does not yet route fills through it.

## Security boundaries

- Session cookies are HMAC-signed, `HttpOnly`, `SameSite=Strict`, and optionally `Secure`.
- Mutating API calls require a CSRF header matching the session token.
- Login is rate-limited and uses PBKDF2-SHA256 passphrase hashes with 310,000 iterations.
- CORS and mutation origins use an explicit allowlist.
- Live execution is absent, not hidden behind a disabled button.
- No Kite, Telegram or engine credentials are present in the frontend or repository.
- Telegram tokens are read only from server environment variables and are never returned by an endpoint.
- Paper fills and closes queue Telegram alerts only when the server is configured.
- Paper state files are written with mode `0600` and atomic replacement.

## Verify

```bash
npm run typecheck
npm run lint
npm test
npm run build

PYTHONPATH=backend pytest -q backend/tests
```

Current evidence: 13 frontend risk tests and 13 API tests pass; TypeScript, ESLint, Ruff and the production build complete without errors.

## Demo data and strategy status

- Data mode: `DEMO_FIXTURE`
- As-of fixture date: 23 October 2026, NSE close
- Strategy: PA Swing · Relative Strength Pullback, version `v0.9.3-demo`
- Qualification: `NOT QUALIFIED`
- Failed gates include trade count, out-of-sample Sharpe, maximum drawdown, walk-forward stability, cost stress and verified Kite adapter

Do not allocate capital based on the research screen. The research page deliberately exposes missing evidence rather than inventing performance.

## Known limitations

- The private engine at `/root/pa-swing-kite` was not readable, so its behavior and schema could not be audited.
- No Kite session, live market feed, engine database or Telegram credentials are available.
- Browser paper actions are not synchronized to the FastAPI paper ledger.
- Telegram test delivery requires an authenticated API session; the browser UI only reports server configuration.
- The API paper ledger is a single-operator scaffold, not a multi-user production service.
- The local dashboard lock is not a substitute for the server session.

See [`docs/IMPLEMENTATION_REPORT.md`](docs/IMPLEMENTATION_REPORT.md) for the full build record and requirement status.
