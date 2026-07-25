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
}

/**
 * Listen on an ephemeral loopback port for exactly one redirect, then
 * shut down. Resolves with the code, or rejects on error/timeout — in
 * every case the listener is closed, so an abandoned consent screen
 * never leaves a server running.
 *
 * `port` and `result` are settled by the same two functions (`succeed` /
 * `fail`), so every path that rejects `result` also rejects `port` (a
 * no-op if `port` already resolved). This matters because `server.listen`
 * can itself fail — EACCES, EMFILE, a sandbox denying the loopback bind —
 * in which case the success callback that would normally call
 * `resolvePort` never runs. Without `fail` also settling `port`, that
 * path would leave `connect()`'s `await port` hanging forever, since
 * `CONNECT_TIMEOUT_MS` only guards `result`.
 *
 * `cancel` lets a caller tear the listener down immediately for a
 * reason unrelated to the HTTP side (e.g. the browser itself failed to
 * open), rather than leaving it bound until the timeout.
 */
function awaitRedirect(
  expectedState: string
): { port: Promise<number>; result: Promise<RedirectResult>; cancel: (err: Error) => void } {
  let server: Server
  let resolvePort: (p: number) => void
  let rejectPort: (err: Error) => void
  const port = new Promise<number>((res, rej) => {
    resolvePort = res
    rejectPort = rej
  })

  let settled = false
  let resolveResult: (r: RedirectResult) => void
  let rejectResult: (err: Error) => void
  const result = new Promise<RedirectResult>((res, rej) => {
    resolveResult = res
    rejectResult = rej
  })

  const succeed = (value: RedirectResult): void => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    server.close()
    resolveResult(value)
  }

  const fail = (err: Error): void => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    rejectPort(err) // no-op if `port` already resolved
    server.close()
    rejectResult(err)
  }

  const timer = setTimeout(
    () => fail(new Error('Timed out waiting for Canva sign-in')),
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

    if (error) return fail(new Error(`Canva returned: ${error}`))
    if (state !== expectedState) {
      return fail(new Error('State mismatch — sign-in was not completed safely'))
    }
    if (!code) return fail(new Error('Canva did not return an authorization code'))
    succeed({ code })
  })

  server.on('error', (err) => fail(err))
  // Port 0 → OS assigns an ephemeral port.
  server.listen(0, '127.0.0.1', () => {
    const addr = server.address()
    if (addr && typeof addr === 'object') resolvePort(addr.port)
  })

  return { port, result, cancel: fail }
}

/**
 * Thrown by {@link postJson} for a non-2xx backend response. Carries only
 * the HTTP status — never the response body, since a body can contain
 * token material — so callers can tell a genuine rejection (400/401)
 * apart from a transient service failure (e.g. 502) without ever seeing
 * token data.
 */
class CanvaHttpError extends Error {
  constructor(public readonly status: number) {
    super(`Canva sign-in service returned ${status}`)
    this.name = 'CanvaHttpError'
  }
}

/**
 * Thrown when Canva has genuinely rejected the stored connection — either
 * the refresh token itself (HTTP 400/401 from `/canva/refresh`) or a
 * 401/403 on a live API call using what looked like a still-valid access
 * token — as opposed to the service merely being unreachable. Callers can
 * use this to distinguish "reconnect Canva" from "try again in a moment".
 *
 * IPC NOTE: this class identity does NOT survive the renderer boundary —
 * Electron serialises a rejected `ipcMain.handle` into a plain `Error`
 * with only a message string, so `err instanceof CanvaReauthRequiredError`
 * is meaningless in the renderer. That is why {@link requireReauth}
 * — the only place this error is thrown — always clears the stored
 * connection first: `canva.getState()` becomes the truthful, serialisable
 * stand-in for this type at the IPC boundary. See the `canva` doc comment
 * on PresentApi in shared/ipc-contract.ts for the renderer-side contract.
 */
export class CanvaReauthRequiredError extends Error {
  constructor() {
    super('Canva sign-in expired. Please connect Canva again.')
    this.name = 'CanvaReauthRequiredError'
  }
}

/**
 * Clears the stored connection and throws {@link CanvaReauthRequiredError}.
 *
 * This is the single call site that couples "Canva genuinely rejected our
 * credential" to "the stored connection is gone" — used both when a
 * refresh is rejected below and by api.ts's canvaFetch when a live call
 * gets a 401/403. Centralising it here (rather than duplicating
 * `clearTokens()` in api.ts) means a subsequent `getState()` is always
 * truthful, from whichever call site detected the rejection.
 */
export async function requireReauth(): Promise<never> {
  await clearTokens()
  throw new CanvaReauthRequiredError()
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  let res: Response
  try {
    res = await net.fetch(`${BACKEND_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
  } catch {
    // net.fetch throws on offline / DNS failure / connection refused.
    throw new Error(
      'Could not reach the Canva sign-in service. Check your internet connection and try again.'
    )
  }
  if (!res.ok) {
    // Status only — the body can contain tokens.
    throw new CanvaHttpError(res.status)
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

  const { port, result, cancel } = awaitRedirect(state)
  // `result` can reject before anything below ever awaits it — e.g. a
  // listen() error rejects both `port` and `result` together, and the
  // `await port` right below throws first, so `await result` is never
  // reached. Without a handler attached here, that abandoned rejection
  // has no listener and takes down the Electron main process via
  // Node's default unhandled-rejection behavior. This single guard
  // covers every current and future early-exit path uniformly; the
  // `.then`/`await` below still observes the real value or throws
  // normally, since `.catch()` only attaches a handler — it doesn't
  // consume the original promise.
  void result.catch(() => {})
  const listenPort = await port

  const startUrl = new URL(`${BACKEND_BASE}/canva/start`)
  startUrl.searchParams.set('challenge', challenge)
  startUrl.searchParams.set('state', state)
  startUrl.searchParams.set('port', String(listenPort))

  try {
    await shell.openExternal(startUrl.toString())
  } catch (err) {
    const openError =
      err instanceof Error ? err : new Error('Could not open the system browser')
    // Tear the listener down immediately rather than leaving it bound
    // for the rest of CONNECT_TIMEOUT_MS. The unhandled-rejection guard
    // above already covers `result`.
    cancel(openError)
    throw openError
  }

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
 * refresh. Storage is cleared only when Canva genuinely rejects the
 * refresh token (HTTP 400/401 — {@link CanvaReauthRequiredError}): the
 * operator is disconnected and a dead credential would only produce
 * confusing failures later. Any other failure — a 5xx, an unexpected
 * status, or a network-level error (offline wifi, backend unreachable)
 * — is treated as transient and rethrown without touching storage, so a
 * dropped connection on a Sunday morning never destroys an otherwise
 * valid refresh token.
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
    if (err instanceof CanvaHttpError && (err.status === 400 || err.status === 401)) {
      return requireReauth()
    }
    throw new Error(
      'Could not reach Canva right now. Your connection is still saved — try again shortly.'
    )
  }
}
