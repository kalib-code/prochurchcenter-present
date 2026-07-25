/**
 * Canva OAuth — loopback redirect flow (RFC 8252).
 *
 * Canva requires PKCE *and* a client secret at token exchange, so the
 * secret lives in a backend proxy and this module never sees it. The
 * app keeps the code_verifier and reveals it only at exchange time, so
 * neither the backend alone nor an attacker holding an intercepted
 * redirect code can complete a flow.
 *
 * Redirect delivery uses an ephemeral loopback listener rather than a
 * custom `present://` protocol: protocol registration is unreliable on
 * Linux/AppImage, which we ship.
 */

import { createServer, type Server } from 'node:http'
import { shell, net } from 'electron'
import {
  generateCodeVerifier,
  deriveCodeChallenge,
  generateState,
  type CanvaTokens
} from '@shared/canva'
import {
  saveTokens,
  loadTokens,
  clearTokens,
  isTokenStorageAvailable
} from '../storage/canvaTokens'

const BACKEND_BASE = process.env.CANVA_BACKEND_BASE ?? 'http://127.0.0.1:8787'
const CONNECT_TIMEOUT_MS = 5 * 60 * 1000
/** Refresh this long before actual expiry so a request never races the clock. */
const EXPIRY_SKEW_MS = 60_000

interface RedirectResult {
  code: string
  state: string
}

/**
 * Listen on an ephemeral loopback port for exactly one redirect, then
 * shut down. Resolves with the code, or rejects on error/timeout — in
 * every case the listener is closed, so an abandoned consent screen
 * never leaves a server running.
 */
function awaitRedirect(
  expectedState: string
): { port: Promise<number>; result: Promise<RedirectResult> } {
  let server: Server
  let resolvePort: (p: number) => void
  const port = new Promise<number>((r) => (resolvePort = r))

  const result = new Promise<RedirectResult>((resolve, reject) => {
    let settled = false
    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      server.close()
      fn()
    }

    const timer = setTimeout(
      () => finish(() => reject(new Error('Timed out waiting for Canva sign-in'))),
      CONNECT_TIMEOUT_MS
    )

    server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (url.pathname !== '/callback') {
        res.writeHead(404).end()
        return
      }

      const error = url.searchParams.get('error')
      const code = url.searchParams.get('code')
      const state = url.searchParams.get('state')

      const body = error
        ? 'Could not connect Canva. You can close this tab and try again in Present.'
        : 'Canva connected. You can close this tab and return to Present.'
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end(body)

      if (error) return finish(() => reject(new Error(`Canva returned: ${error}`)))
      if (state !== expectedState) {
        return finish(() => reject(new Error('State mismatch — sign-in was not completed safely')))
      }
      if (!code) return finish(() => reject(new Error('Canva did not return an authorization code')))
      finish(() => resolve({ code, state }))
    })

    server.on('error', (err) => finish(() => reject(err)))
    // Port 0 → OS assigns an ephemeral port.
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (addr && typeof addr === 'object') resolvePort(addr.port)
    })
  })

  return { port, result }
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await net.fetch(`${BACKEND_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!res.ok) {
    // Status only — the body can contain tokens.
    throw new Error(`Canva sign-in service returned ${res.status}`)
  }
  return (await res.json()) as T
}

interface TokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number
}

function toTokens(
  r: TokenResponse,
  accountName: string | null,
  connectedAt: string
): CanvaTokens {
  return {
    accessToken: r.access_token,
    refreshToken: r.refresh_token,
    expiresAt: new Date(Date.now() + r.expires_in * 1000).toISOString(),
    accountName,
    connectedAt
  }
}

/** Best-effort display name. A failure here must not fail the connection. */
async function fetchAccountName(accessToken: string): Promise<string | null> {
  try {
    const res = await net.fetch('https://api.canva.com/rest/v1/users/me/profile', {
      headers: { Authorization: `Bearer ${accessToken}` }
    })
    if (!res.ok) return null
    const data = (await res.json()) as { display_name?: string }
    return data.display_name ?? null
  } catch {
    return null
  }
}

export async function connect(): Promise<CanvaTokens> {
  if (!isTokenStorageAvailable()) {
    throw new Error(
      'Present cannot securely store a Canva connection on this system, so connecting is disabled.'
    )
  }

  const verifier = generateCodeVerifier()
  const challenge = await deriveCodeChallenge(verifier)
  const state = generateState()

  const { port, result } = awaitRedirect(state)
  const listenPort = await port

  const startUrl = new URL(`${BACKEND_BASE}/canva/start`)
  startUrl.searchParams.set('challenge', challenge)
  startUrl.searchParams.set('state', state)
  startUrl.searchParams.set('port', String(listenPort))
  await shell.openExternal(startUrl.toString())

  const { code } = await result

  const response = await postJson<TokenResponse>('/canva/token', {
    code,
    code_verifier: verifier
  })

  const accountName = await fetchAccountName(response.access_token)
  const tokens = toTokens(response, accountName, new Date().toISOString())
  await saveTokens(tokens)
  return tokens
}

export async function disconnect(): Promise<void> {
  await clearTokens()
}

/**
 * A usable access token, refreshing when near expiry.
 *
 * Canva rotates refresh tokens, so the rotated one is persisted on every
 * refresh. A rejected refresh clears storage: the operator is genuinely
 * disconnected and needs to reconnect, and keeping a dead token would
 * only produce confusing failures later.
 */
export async function getValidAccessToken(): Promise<string> {
  const tokens = await loadTokens()
  if (!tokens) throw new Error('Canva is not connected')

  if (Date.parse(tokens.expiresAt) - EXPIRY_SKEW_MS > Date.now()) {
    return tokens.accessToken
  }

  try {
    const response = await postJson<TokenResponse>('/canva/refresh', {
      refresh_token: tokens.refreshToken
    })
    const refreshed = toTokens(response, tokens.accountName, tokens.connectedAt)
    await saveTokens(refreshed)
    return refreshed.accessToken
  } catch (err) {
    await clearTokens()
    throw new Error('Canva sign-in expired. Please connect Canva again.')
  }
}
