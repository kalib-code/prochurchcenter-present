# Canva → Setlist Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an operator connect their Canva account once, then pull a Canva design directly into a setlist as a `deck` item, and be told when that design has since changed in Canva.

**Architecture:** Pure logic (PKCE, timestamp conversion, staleness, export-request building, poll scheduling) lives in `src/shared/canva.ts` where this repo's vitest convention already points. The main process owns all network and disk IO through thin wrappers in `src/main/canva/*`, using `net.fetch` exactly as `bibleApi.ts` does — the renderer never talks to Canva. A `client_secret` cannot ship in the bundle, so token exchange goes through a stateless backend proxy; this plan builds against a local stub implementing that contract.

**Tech Stack:** Electron 34 · React 18 · TypeScript · Zustand · Tailwind v3 · vitest · pdf.js (`pdfjs-dist`)

**Spec:** `docs/superpowers/specs/2026-07-25-canva-setlist-import-design.md`

## Global Constraints

- **No new runtime dependencies.** PKCE uses Web Crypto (`globalThis.crypto`, available in Electron 34's Node 20). The loopback listener uses `node:http`. HTTP uses Electron's `net.fetch`. Everything needed is built in.
- **Tests live only in `src/shared/**/*.test.ts`.** `vitest.config.ts` includes exactly that glob with `environment: 'node'`. Do not widen it. Main-process and renderer modules follow this repo's existing convention of typecheck plus manual verification.
- **`pnpm typecheck` must pass** (runs both `tsconfig.node.json` and `tsconfig.web.json`) before every commit.
- **`pnpm test` must pass** before every commit.
- **Never send `size`** in a Canva PDF export request. It reflows 16:9 slides to paper proportions while the API reports success.
- **`export_quality` is always `'regular'`.** `'pro'` can fail outright on free Canva accounts.
- **Canva timestamps are Unix seconds.** Every timestamp stored in this codebase is ISO 8601. Convert at the boundary.
- **All IPC goes through `CHANNELS` in `src/shared/ipc-contract.ts`.** No loose channel strings.
- **Never log tokens** — not access, not refresh, not authorization codes.
- Scopes: `design:meta:read design:content:read profile:read`.

---

## File Structure

**Created:**

| Path | Responsibility |
|---|---|
| `src/shared/canva.ts` | Pure logic + shared Canva types. No IO. |
| `src/shared/canva.test.ts` | Unit tests for the above. |
| `src/main/storage/canvaTokens.ts` | `safeStorage`-encrypted token persistence. |
| `src/main/canva/auth.ts` | Loopback listener, browser launch, token exchange/refresh. |
| `src/main/canva/api.ts` | `net.fetch` wrappers for Canva REST endpoints. |
| `src/main/canva/import.ts` | Export → poll → download → atomic write. |
| `src/main/ipc/canva.ts` | IPC handlers. |
| `src/renderer/src/stores/useCanvaStore.ts` | Connection state, design list, import progress. |
| `src/renderer/src/components/CanvaPicker.tsx` | Third view inside `AddItemPicker`. |
| `src/renderer/src/components/CanvaConnectionCard.tsx` | Settings → Connections panel body. |
| `scripts/canva-stub-server.mjs` | Local backend implementing the contract; reference for production. |

**Modified:** `src/shared/types.ts` · `src/shared/ipc-contract.ts` · `src/preload/index.ts` · `src/main/ipc/index.ts` · `src/main/index.ts` · `src/main/storage/paths.ts` · `src/main/storage/atomic.ts` · `src/renderer/src/pages/Settings.tsx` · `src/renderer/src/pages/SetlistEditor.tsx` · `src/renderer/src/components/AddItemPicker.tsx` · `src/renderer/src/components/ItemKindIcon.tsx` · `src/renderer/src/components/SetlistItemCard.tsx`

**Explicitly NOT modified** (the spec listed the first two; both turned out to need no change):

- `src/preload/index.d.ts` — declares `api: PresentApi`, so it picks up `canva` automatically once the contract has it.
- `src/main/storage/backup.ts` — `addDirToZip` already recurses and restore already handles nested paths, so `media/canva/` round-trips for free.

---

## Task 1: Data model and pure Canva logic

**Files:**
- Modify: `src/shared/types.ts` (append to the Setlist section)
- Create: `src/shared/canva.ts`
- Test: `src/shared/canva.test.ts`

**Interfaces:**
- Consumes: nothing (first task)
- Produces: `CanvaOrigin` · `CanvaDesign` · `CanvaTokens` · `CanvaExportRequest` · `unixSecondsToIso(seconds: number): string` · `isDesignStale(origin: CanvaOrigin, canvaUpdatedAtUnix: number): boolean` · `generateCodeVerifier(): string` · `deriveCodeChallenge(verifier: string): Promise<string>` · `buildExportRequestBody(designId: string): CanvaExportRequest` · `nextPollDelayMs(attempt: number): number | null`

- [ ] **Step 1: Add `CanvaOrigin` to `src/shared/types.ts`**

Add immediately above the `SetlistItem` union:

```ts
/**
 * Provenance for a deck imported from a connected Canva account.
 *
 * Grouped into one object (rather than three optional fields on the deck
 * item) so it is wholly present or wholly absent — there is no
 * representable half-state holding a design id with nothing to compare
 * it against.
 */
export interface CanvaOrigin {
  designId: string
  /** Canva's `updated_at` as of import. ISO 8601 — Canva sends Unix seconds. */
  designUpdatedAt: string
  importedAt: string
}
```

Then add the `canva` key to the existing `deck` variant of `SetlistItem`:

```ts
  | {
      kind: 'deck'
      id: string
      pdfPath: string
      pageCount: number
      /** Optional display name shown in the operator upcoming list */
      title?: string
      /**
       * Present only when this deck was pulled from a connected Canva
       * account. Its presence is the sole trigger for the refresh
       * affordance — a hand-picked PDF deck has no `canva` key at all.
       */
      canva?: CanvaOrigin
    }
```

- [ ] **Step 2: Write the failing tests**

Create `src/shared/canva.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  unixSecondsToIso,
  isDesignStale,
  generateCodeVerifier,
  deriveCodeChallenge,
  buildExportRequestBody,
  nextPollDelayMs
} from './canva'
import type { CanvaOrigin } from './types'

describe('unixSecondsToIso', () => {
  it('converts Unix seconds to an ISO 8601 string', () => {
    expect(unixSecondsToIso(1700000000)).toBe('2023-11-14T22:13:20.000Z')
  })

  it('treats the epoch as a valid instant, not as missing data', () => {
    expect(unixSecondsToIso(0)).toBe('1970-01-01T00:00:00.000Z')
  })

  it('throws on values that are not finite numbers', () => {
    expect(() => unixSecondsToIso(Number.NaN)).toThrow()
    expect(() => unixSecondsToIso(Number.POSITIVE_INFINITY)).toThrow()
  })
})

describe('isDesignStale', () => {
  const origin: CanvaOrigin = {
    designId: 'DAF123',
    designUpdatedAt: '2023-11-14T22:13:20.000Z',
    importedAt: '2023-11-14T22:20:00.000Z'
  }

  it('is stale when Canva reports a newer edit', () => {
    expect(isDesignStale(origin, 1700000001)).toBe(true)
  })

  it('is not stale when the timestamps match exactly', () => {
    expect(isDesignStale(origin, 1700000000)).toBe(false)
  })

  it('is not stale when Canva reports an older timestamp', () => {
    expect(isDesignStale(origin, 1699999999)).toBe(false)
  })

  it('is not stale when the stored timestamp is unparseable', () => {
    // Never badge on corrupt data — a spurious "updated" badge before a
    // service is worse than silently missing one.
    const corrupt = { ...origin, designUpdatedAt: 'not-a-date' }
    expect(isDesignStale(corrupt, 1700000001)).toBe(false)
  })
})

describe('PKCE', () => {
  it('generates a verifier within RFC 7636 length bounds', () => {
    const v = generateCodeVerifier()
    expect(v.length).toBeGreaterThanOrEqual(43)
    expect(v.length).toBeLessThanOrEqual(128)
  })

  it('generates unpadded base64url verifiers only', () => {
    expect(generateCodeVerifier()).toMatch(/^[A-Za-z0-9\-._~]+$/)
  })

  it('generates a different verifier each call', () => {
    expect(generateCodeVerifier()).not.toBe(generateCodeVerifier())
  })

  it('derives the RFC 7636 reference S256 challenge', async () => {
    // Verifier and expected challenge from RFC 7636 Appendix B.
    const challenge = await deriveCodeChallenge(
      'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
    )
    expect(challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })

  it('derives a challenge with no base64 padding', async () => {
    const challenge = await deriveCodeChallenge(generateCodeVerifier())
    expect(challenge).not.toContain('=')
    expect(challenge).toMatch(/^[A-Za-z0-9\-_]+$/)
  })
})

describe('buildExportRequestBody', () => {
  it('requests a PDF export for the given design', () => {
    expect(buildExportRequestBody('DAF123')).toEqual({
      design_id: 'DAF123',
      format: { type: 'pdf', export_quality: 'regular' }
    })
  })

  it('never sends `size` — it reflows 16:9 slides to paper proportions', () => {
    // Regression pin. This failure mode is silent: the export succeeds,
    // the import reports success, and every slide is letterboxed.
    const body = buildExportRequestBody('DAF123')
    expect(body.format).not.toHaveProperty('size')
    expect(JSON.stringify(body)).not.toContain('size')
  })

  it('never requests pro quality — it fails on free Canva accounts', () => {
    expect(buildExportRequestBody('DAF123').format.export_quality).toBe('regular')
  })
})

describe('nextPollDelayMs', () => {
  it('starts fast so short exports feel immediate', () => {
    expect(nextPollDelayMs(0)).toBe(1000)
  })

  it('backs off to a steady cadence rather than growing without bound', () => {
    expect(nextPollDelayMs(5)).toBe(5000)
    expect(nextPollDelayMs(10)).toBe(5000)
  })

  it('returns null once the cumulative budget is exhausted', () => {
    expect(nextPollDelayMs(999)).toBeNull()
  })

  it('never returns a zero or negative delay, which would busy-loop', () => {
    for (let i = 0; i < 50; i++) {
      const d = nextPollDelayMs(i)
      if (d !== null) expect(d).toBeGreaterThan(0)
    }
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm test`
Expected: FAIL — `Failed to resolve import "./canva"`.

- [ ] **Step 4: Implement `src/shared/canva.ts`**

```ts
/**
 * Canva integration — pure logic and shared types.
 *
 * No IO, no Electron imports. Everything here is unit-testable under
 * vitest's node environment, which is why the main-process modules in
 * `src/main/canva/` stay thin enough to verify by hand.
 *
 * Crypto uses Web Crypto (`globalThis.crypto`) rather than `node:crypto`
 * so this module stays importable from both main and renderer without
 * breaking the renderer bundle.
 */

import type { CanvaOrigin } from './types'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** OAuth scopes Present requests. Browse, export, and show who is connected. */
export const CANVA_SCOPES = 'design:meta:read design:content:read profile:read'

/** A design as returned by `GET /v1/designs`. Slim subset of Canva's shape. */
export interface CanvaDesign {
  id: string
  title: string
  /** Unix seconds. */
  updatedAt: number
  thumbnailUrl: string | null
}

/** One page of list results plus the token for the next page. */
export interface CanvaDesignPage {
  designs: CanvaDesign[]
  continuation: string | null
}

/** Tokens as persisted on the operator's machine. */
export interface CanvaTokens {
  accessToken: string
  refreshToken: string
  /** ISO 8601 — absolute expiry, computed from `expires_in` at receipt. */
  expiresAt: string
  /** Display name of the connected account, for Settings. */
  accountName: string | null
  connectedAt: string
}

/** Body of `POST /v1/exports`. Deliberately has no `size` field. */
export interface CanvaExportRequest {
  design_id: string
  format: { type: 'pdf'; export_quality: 'regular' }
}

/** What the renderer knows about the connection. */
export type CanvaConnectionState =
  | { status: 'disconnected' }
  | { status: 'connecting' }
  | { status: 'connected'; accountName: string | null; connectedAt: string }
  /** `safeStorage` unavailable — some Linux setups. Never falls back to plaintext. */
  | { status: 'unavailable'; reason: string }

/** Progress emitted during an import, so the UI is not one opaque spinner. */
export type CanvaImportProgress =
  | { phase: 'exporting' }
  | { phase: 'downloading' }

/** Result of a successful import or refresh. */
export interface CanvaImportResult {
  pdfPath: string
  title: string
  /** ISO 8601. */
  designUpdatedAt: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Timestamps
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Canva sends Unix seconds; every timestamp in this codebase is ISO 8601.
 * Convert at the boundary so nothing downstream has to remember which
 * representation it holds.
 */
export function unixSecondsToIso(seconds: number): string {
  if (!Number.isFinite(seconds)) {
    throw new TypeError(`Expected finite Unix seconds, got ${seconds}`)
  }
  return new Date(seconds * 1000).toISOString()
}

/**
 * True when Canva reports an edit strictly newer than what we imported.
 *
 * Returns false on unparseable stored data rather than throwing or
 * defaulting to "stale": a spurious "updated in Canva" badge minutes
 * before a service costs the operator more than a missed one.
 */
export function isDesignStale(
  origin: CanvaOrigin,
  canvaUpdatedAtUnix: number
): boolean {
  const importedMs = Date.parse(origin.designUpdatedAt)
  if (Number.isNaN(importedMs)) return false
  if (!Number.isFinite(canvaUpdatedAtUnix)) return false
  return canvaUpdatedAtUnix * 1000 > importedMs
}

// ─────────────────────────────────────────────────────────────────────────────
// PKCE (RFC 7636)
// ─────────────────────────────────────────────────────────────────────────────

const VERIFIER_BYTES = 64 // → 86 base64url chars, inside the 43–128 bound

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * A fresh high-entropy verifier. Stays in the app process and is revealed
 * only at token-exchange time, so neither the backend alone nor an
 * attacker holding an intercepted redirect code can complete a flow.
 */
export function generateCodeVerifier(): string {
  const bytes = new Uint8Array(VERIFIER_BYTES)
  globalThis.crypto.getRandomValues(bytes)
  return base64UrlEncode(bytes)
}

/** S256 challenge: base64url(SHA-256(verifier)), unpadded. */
export async function deriveCodeChallenge(verifier: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier)
  )
  return base64UrlEncode(new Uint8Array(digest))
}

/** Opaque anti-CSRF value echoed back through the redirect. */
export function generateState(): string {
  const bytes = new Uint8Array(32)
  globalThis.crypto.getRandomValues(bytes)
  return base64UrlEncode(bytes)
}

// ─────────────────────────────────────────────────────────────────────────────
// Export requests
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Body for `POST /v1/exports`.
 *
 * Two omissions are load-bearing and must not be "helpfully" added back:
 *
 *   `size`            — forces a4/letter paper proportions, silently
 *                       letterboxing every slide of a 16:9 design while
 *                       the API still reports success.
 *   `export_quality`  — pinned to 'regular'; 'pro' targets premium
 *                       content and can fail on free Canva accounts.
 */
export function buildExportRequestBody(designId: string): CanvaExportRequest {
  return {
    design_id: designId,
    format: { type: 'pdf', export_quality: 'regular' }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Export job polling
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Poll schedule for async export jobs.
 *
 * MAINTAINER DECISION — tune these two constants to your churches' real
 * connections. The trade-off runs both ways: polling hard burns the
 * documented 20-requests/minute export budget, while backing off too far
 * makes a 3-second export feel like ten. Giving up early fails large
 * decks on slow links; giving up late holds an operator hostage minutes
 * before a service.
 *
 * Current values: 1s, 1s, 2s, 3s, 5s, then every 5s, abandoning at 90s.
 * That is ~20 requests worst case — right at the per-minute ceiling, so
 * do not shorten the tail without also raising the timeout.
 */
const POLL_DELAYS_MS = [1000, 1000, 2000, 3000, 5000] as const
const POLL_STEADY_MS = 5000
export const EXPORT_POLL_TIMEOUT_MS = 90_000

/**
 * Delay before poll attempt `attempt` (0-indexed), or null once the
 * cumulative budget is spent and the caller should give up.
 */
export function nextPollDelayMs(attempt: number): number | null {
  if (attempt < 0 || !Number.isFinite(attempt)) return null

  let elapsed = 0
  for (let i = 0; i <= attempt; i++) {
    const delay = i < POLL_DELAYS_MS.length ? POLL_DELAYS_MS[i] : POLL_STEADY_MS
    if (i === attempt) {
      return elapsed + delay > EXPORT_POLL_TIMEOUT_MS ? null : delay
    }
    elapsed += delay
  }
  return null
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test`
Expected: PASS — all tests in `src/shared/canva.test.ts` green.

- [ ] **Step 6: Verify types compile**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/shared/canva.ts src/shared/canva.test.ts src/shared/types.ts
git commit -m "feat(canva): data model and pure logic for Canva import

CanvaOrigin on the deck item, plus PKCE, timestamp conversion,
staleness comparison, export-request building, and poll scheduling.

Pins two silent-failure regressions: the export request must never
carry `size` (reflows 16:9 slides to paper proportions while reporting
success) and never `export_quality: pro` (fails on free accounts)."
```

---

## Task 2: Token storage and filesystem paths

**Files:**
- Modify: `src/main/storage/paths.ts`
- Create: `src/main/storage/canvaTokens.ts`

**Interfaces:**
- Consumes: `CanvaTokens` from `src/shared/canva.ts` (Task 1)
- Produces: `getCanvaMediaDir(): string` · `getCanvaTokensPath(): string` · `isTokenStorageAvailable(): boolean` · `saveTokens(t: CanvaTokens): Promise<void>` · `loadTokens(): Promise<CanvaTokens | null>` · `clearTokens(): Promise<void>`

- [ ] **Step 1: Add paths to `src/main/storage/paths.ts`**

Add after `getFontsIndexPath()`:

```ts
/**
 * Canva-imported PDFs. A subdirectory of media/ rather than a sibling so
 * `addDirToZip` picks it up in backups with no changes to backup.ts —
 * it already recurses, and restore already handles nested paths.
 */
export function getCanvaMediaDir(): string {
  return join(getMediaDir(), 'canva')
}

/**
 * Encrypted Canva OAuth tokens. Not in settings.json: a refresh token is
 * a standing grant to an entire Canva account, so it is written through
 * Electron's safeStorage rather than the plain-JSON pattern used by
 * every other file in this directory.
 */
export function getCanvaTokensPath(): string {
  return join(root(), 'canva-tokens.enc')
}
```

Then add `getCanvaMediaDir()` to the `dirs` array inside `ensureDirectories()`.

- [ ] **Step 2: Create `src/main/storage/canvaTokens.ts`**

```ts
/**
 * Canva OAuth token persistence.
 *
 * Deliberately does NOT follow the plain-JSON pattern used by settings,
 * themes, songs, and setlists. A refresh token is a standing grant to
 * someone's entire Canva account — categorically different from a theme
 * — so it is encrypted with Electron's safeStorage, which binds to the
 * OS keychain on macOS and DPAPI on Windows.
 *
 * On systems where safeStorage is unavailable (some Linux desktops with
 * no keyring), we report the connection as unavailable rather than
 * silently writing a refresh token to disk in plaintext. Refusing to
 * store the credential is the correct failure here.
 */

import { safeStorage } from 'electron'
import { writeFile, readFile, rm } from 'fs/promises'
import { existsSync } from 'fs'
import type { CanvaTokens } from '@shared/canva'
import { getCanvaTokensPath } from './paths'

export function isTokenStorageAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

export async function saveTokens(tokens: CanvaTokens): Promise<void> {
  if (!isTokenStorageAvailable()) {
    throw new Error('Encrypted storage is unavailable on this system')
  }
  const encrypted = safeStorage.encryptString(JSON.stringify(tokens))
  await writeFile(getCanvaTokensPath(), encrypted)
}

/**
 * Returns null when no tokens are stored, and also when stored tokens
 * cannot be decrypted or parsed — a corrupt or foreign-keychain blob is
 * indistinguishable from "not connected" from the operator's side, and
 * both are fixed the same way: connect again.
 */
export async function loadTokens(): Promise<CanvaTokens | null> {
  const path = getCanvaTokensPath()
  if (!existsSync(path) || !isTokenStorageAvailable()) return null
  try {
    const buf = await readFile(path)
    return JSON.parse(safeStorage.decryptString(buf)) as CanvaTokens
  } catch (err) {
    console.error('[canva] could not read stored tokens', err)
    return null
  }
}

export async function clearTokens(): Promise<void> {
  await rm(getCanvaTokensPath(), { force: true })
}
```

- [ ] **Step 3: Verify types compile**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/main/storage/paths.ts src/main/storage/canvaTokens.ts
git commit -m "feat(canva): safeStorage-backed token persistence

Refresh tokens are encrypted via OS keychain/DPAPI rather than using
the plain-JSON pattern of the other storage modules. Where safeStorage
is unavailable we refuse to store rather than fall back to plaintext.

media/canva/ sits under media/ so existing backup recursion covers it."
```

---

## Task 3: Local backend stub

**Files:**
- Create: `scripts/canva-stub-server.mjs`
- Modify: `package.json` (add a `dev:canva-stub` script)

**Interfaces:**
- Consumes: nothing
- Produces: an HTTP server on `http://127.0.0.1:8787` implementing `GET /canva/start`, `GET /canva/callback`, `POST /canva/token`, `POST /canva/refresh`

This stub talks to the *real* Canva using dev credentials from the environment. It is both the local development dependency and the reference implementation for the production backend.

- [ ] **Step 1: Create `scripts/canva-stub-server.mjs`**

```js
/**
 * Local stand-in for the production Canva OAuth proxy.
 *
 * Implements the exact contract in
 * docs/superpowers/specs/2026-07-25-canva-setlist-import-design.md and
 * talks to the real Canva API, so it doubles as the reference
 * implementation for the deployed backend.
 *
 * Stateless by design: it holds the client secret and proxies two
 * exchanges. It never stores user tokens.
 *
 * Usage:
 *   CANVA_CLIENT_ID=... CANVA_CLIENT_SECRET=... node scripts/canva-stub-server.mjs
 *
 * Register http://127.0.0.1:8787/canva/callback as a redirect URL in
 * your Canva developer integration.
 */

import { createServer } from 'node:http'
import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto'

const PORT = 8787
const BASE = `http://127.0.0.1:${PORT}`
const CLIENT_ID = process.env.CANVA_CLIENT_ID
const CLIENT_SECRET = process.env.CANVA_CLIENT_SECRET
// UPDATED from the original `process.env.CANVA_STUB_SIGNING_KEY ??
// 'dev-only-signing-key'` shown in an earlier draft of this plan: a
// hardcoded fallback secret is exactly the kind of thing that ends up
// running in production by accident. The shipped stub generates a fresh
// random key per process instead — correct for this single, disposable
// dev server, but NOT something the real backend should copy: a
// restartable or multi-replica deployment needs its signing key read from
// configuration (a secret store / env var provisioned at deploy time),
// with the process refusing to start if it's missing. See the
// `PRODUCTION:` note above `SIGNING_KEY` in the shipped
// scripts/canva-stub-server.mjs for the full rationale.
const SIGNING_KEY = randomBytes(32)

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Set CANVA_CLIENT_ID and CANVA_CLIENT_SECRET.')
  process.exit(1)
}

const AUTHORIZE_URL = 'https://www.canva.com/api/oauth/authorize'
const TOKEN_URL = 'https://api.canva.com/rest/v1/oauth/token'
const REDIRECT_URI = `${BASE}/canva/callback`
const STATE_TTL_MS = 10 * 60 * 1000

const b64url = (buf) => Buffer.from(buf).toString('base64url')

function signState(payload) {
  const body = b64url(JSON.stringify(payload))
  const sig = createHmac('sha256', SIGNING_KEY).update(body).digest('base64url')
  return `${body}.${sig}`
}

function verifyState(token) {
  const [body, sig] = String(token ?? '').split('.')
  if (!body || !sig) return null
  const expected = createHmac('sha256', SIGNING_KEY).update(body).digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString())
  if (Date.now() - payload.iat > STATE_TTL_MS) return null
  return payload
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (c) => {
      raw += c
      if (raw.length > 1e6) reject(new Error('body too large'))
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}'))
      } catch (err) {
        reject(err)
      }
    })
  })
}

async function exchange(params) {
  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams(params)
  })
  return { ok: res.ok, status: res.status, data: await res.json() }
}

const send = (res, status, obj) => {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(obj))
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, BASE)

  try {
    if (req.method === 'GET' && url.pathname === '/canva/start') {
      const challenge = url.searchParams.get('challenge')
      const state = url.searchParams.get('state')
      const port = Number(url.searchParams.get('port'))
      if (!challenge || !state || !Number.isInteger(port) || port < 1024 || port > 65535) {
        return send(res, 400, { error: 'invalid_request' })
      }
      const authorize = new URL(AUTHORIZE_URL)
      authorize.searchParams.set('client_id', CLIENT_ID)
      authorize.searchParams.set('redirect_uri', REDIRECT_URI)
      authorize.searchParams.set('response_type', 'code')
      authorize.searchParams.set('scope', 'design:meta:read design:content:read profile:read')
      authorize.searchParams.set('code_challenge', challenge)
      authorize.searchParams.set('code_challenge_method', 'S256')
      authorize.searchParams.set('state', signState({ appState: state, port, iat: Date.now() }))
      res.writeHead(302, { Location: authorize.toString() })
      return res.end()
    }

    if (req.method === 'GET' && url.pathname === '/canva/callback') {
      const payload = verifyState(url.searchParams.get('state'))
      if (!payload) return send(res, 400, { error: 'invalid_state' })
      const target = new URL(`http://127.0.0.1:${payload.port}/callback`)
      const error = url.searchParams.get('error')
      if (error) target.searchParams.set('error', error)
      else target.searchParams.set('code', url.searchParams.get('code') ?? '')
      target.searchParams.set('state', payload.appState)
      res.writeHead(302, { Location: target.toString() })
      return res.end()
    }

    if (req.method === 'POST' && url.pathname === '/canva/token') {
      const { code, code_verifier: verifier } = await readJsonBody(req)
      if (!code || !verifier) return send(res, 400, { error: 'invalid_request' })
      const r = await exchange({
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        redirect_uri: REDIRECT_URI
      })
      return send(res, r.ok ? 200 : r.status === 400 ? 400 : 502, r.data)
    }

    if (req.method === 'POST' && url.pathname === '/canva/refresh') {
      const { refresh_token: refreshToken } = await readJsonBody(req)
      if (!refreshToken) return send(res, 400, { error: 'invalid_request' })
      const r = await exchange({ grant_type: 'refresh_token', refresh_token: refreshToken })
      return send(res, r.ok ? 200 : r.status === 400 ? 400 : 502, r.data)
    }

    send(res, 404, { error: 'not_found' })
  } catch (err) {
    // Deliberately does not echo the error body — it can contain tokens.
    console.error('[canva-stub]', err.message)
    send(res, 500, { error: 'server_error' })
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[canva-stub] listening on ${BASE}`)
  console.log(`[canva-stub] register redirect URL: ${REDIRECT_URI}`)
})
```

- [ ] **Step 2: Add the script to `package.json`**

Add to `"scripts"`:

```json
"dev:canva-stub": "node scripts/canva-stub-server.mjs"
```

- [ ] **Step 3: Verify the stub boots**

Run: `CANVA_CLIENT_ID=x CANVA_CLIENT_SECRET=y pnpm dev:canva-stub`
Expected: logs `[canva-stub] listening on http://127.0.0.1:8787`. Stop it with Ctrl-C.

- [ ] **Step 4: Commit**

```bash
git add scripts/canva-stub-server.mjs package.json
git commit -m "feat(canva): local OAuth proxy stub

Implements the four-route backend contract against the real Canva API
using dev credentials from the environment. Stateless: holds the client
secret, proxies two exchanges, stores no user tokens. Doubles as the
reference implementation for the production backend."
```

---

## Task 4: OAuth connect flow

**Files:**
- Create: `src/main/canva/auth.ts`

**Interfaces:**
- Consumes: `generateCodeVerifier`, `deriveCodeChallenge`, `generateState`, `CanvaTokens` (Task 1); `saveTokens`, `loadTokens`, `clearTokens`, `isTokenStorageAvailable` (Task 2)
- Produces: `connect(): Promise<CanvaTokens>` · `disconnect(): Promise<void>` · `getValidAccessToken(): Promise<string>`

- [ ] **Step 1: Create `src/main/canva/auth.ts`**

```ts
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
```

- [ ] **Step 2: Verify types compile**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/main/canva/auth.ts
git commit -m "feat(canva): OAuth connect flow over loopback redirect

Ephemeral 127.0.0.1 listener per RFC 8252, closed on success, error,
timeout, and abandonment. PKCE verifier stays in the app and is revealed
only at exchange, so the backend alone cannot complete a flow.

Refresh persists Canva's rotated refresh token; a rejected refresh
clears storage rather than retaining a dead credential."
```

---

## Task 5: Canva REST client

**Files:**
- Create: `src/main/canva/api.ts`

**Interfaces:**
- Consumes: `getValidAccessToken` (Task 4); `CanvaDesign`, `CanvaDesignPage`, `buildExportRequestBody`, `nextPollDelayMs`, `unixSecondsToIso` (Task 1)
- Produces: `listDesigns(query: string | null, continuation: string | null): Promise<CanvaDesignPage>` · `getDesignUpdatedAt(designId: string): Promise<number>` · `exportDesignToPdfUrl(designId: string, onProgress: () => void): Promise<string>`

- [ ] **Step 1: Create `src/main/canva/api.ts`**

```ts
/**
 * Canva REST client. All calls go through Electron's `net.fetch` from the
 * main process, matching bibleApi.ts — the renderer never talks to Canva.
 */

import { net } from 'electron'
import {
  buildExportRequestBody,
  nextPollDelayMs,
  type CanvaDesign,
  type CanvaDesignPage
} from '@shared/canva'
import { getValidAccessToken } from './auth'

const API_BASE = 'https://api.canva.com/rest/v1'

/** Thrown for HTTP failures so callers can map status to operator-facing copy. */
export class CanvaApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'CanvaApiError'
  }
}

function messageForStatus(status: number): string {
  if (status === 401 || status === 403) return 'Canva sign-in expired. Please connect Canva again.'
  if (status === 429) return 'Canva is busy right now — try again in a minute.'
  if (status === 404) return 'That design no longer exists in Canva.'
  return `Canva returned an error (${status}).`
}

async function canvaFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getValidAccessToken()
  const res = await net.fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  })
  if (!res.ok) throw new CanvaApiError(messageForStatus(res.status), res.status)
  return (await res.json()) as T
}

interface RawDesign {
  id: string
  title?: string
  updated_at: number
  thumbnail?: { url: string }
}

interface RawDesignList {
  items: RawDesign[]
  continuation?: string
}

function toDesign(raw: RawDesign): CanvaDesign {
  return {
    id: raw.id,
    // Canva permits untitled designs; the picker needs something to show.
    title: raw.title?.trim() || 'Untitled design',
    updatedAt: raw.updated_at,
    thumbnailUrl: raw.thumbnail?.url ?? null
  }
}

/**
 * One page of the user's designs, most-recently-modified first. The design
 * edited last night is nearly always the one wanted, so the default view
 * is usually a zero-typing hit.
 */
export async function listDesigns(
  query: string | null,
  continuation: string | null
): Promise<CanvaDesignPage> {
  const params = new URLSearchParams({ sort_by: 'modified_descending' })
  // `query` and `relevance` belong together: sorting a text search by
  // modification date buries the best match.
  if (query) {
    params.set('query', query.slice(0, 255))
    params.set('sort_by', 'relevance')
  }
  if (continuation) params.set('continuation', continuation)

  const data = await canvaFetch<RawDesignList>(`/designs?${params}`)
  return {
    designs: (data.items ?? []).map(toDesign),
    continuation: data.continuation ?? null
  }
}

/** Unix seconds of the design's last edit — the staleness comparison input. */
export async function getDesignUpdatedAt(designId: string): Promise<number> {
  const data = await canvaFetch<{ design: RawDesign }>(`/designs/${designId}`)
  return data.design.updated_at
}

interface RawExportJob {
  job: { id: string; status: 'in_progress' | 'success' | 'failed'; error?: { message?: string }; urls?: string[] }
}

/**
 * Run an export job to completion and return the PDF download URL.
 *
 * Canva exports are asynchronous, so this polls on the schedule in
 * shared/canva.ts. The returned URL expires after 24 hours and must be
 * downloaded immediately — never persisted.
 */
export async function exportDesignToPdfUrl(
  designId: string,
  onProgress: () => void
): Promise<string> {
  const created = await canvaFetch<RawExportJob>('/exports', {
    method: 'POST',
    body: JSON.stringify(buildExportRequestBody(designId))
  })

  let job = created.job
  for (let attempt = 0; job.status === 'in_progress'; attempt++) {
    const delay = nextPollDelayMs(attempt)
    if (delay === null) {
      throw new Error('Canva took too long to export this design. Please try again.')
    }
    await new Promise((r) => setTimeout(r, delay))
    onProgress()
    const polled = await canvaFetch<RawExportJob>(`/exports/${job.id}`)
    job = polled.job
  }

  if (job.status === 'failed') {
    // Premium elements on a free account are the common real cause.
    throw new Error(
      job.error?.message ??
        'Canva could not export this design. If it uses premium elements, try removing them or exporting from Canva directly.'
    )
  }

  const url = job.urls?.[0]
  if (!url) throw new Error('Canva reported success but returned no download link.')
  return url
}
```

- [ ] **Step 2: Verify types compile**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/main/canva/api.ts
git commit -m "feat(canva): REST client for designs and export jobs

List/search designs, read updated_at for staleness, and drive async
export jobs to completion on the shared poll schedule. HTTP status is
mapped to operator-facing copy rather than surfacing raw errors."
```

---

## Task 6: Import pipeline

**Files:**
- Modify: `src/main/storage/atomic.ts`
- Create: `src/main/canva/import.ts`

**Interfaces:**
- Consumes: `exportDesignToPdfUrl`, `getDesignUpdatedAt` (Task 5); `listDesigns` (Task 5); `getCanvaMediaDir` (Task 2); `unixSecondsToIso`, `CanvaImportResult`, `CanvaImportProgress` (Task 1)
- Produces: `atomicWriteFile(path: string, data: Uint8Array): Promise<void>` · `importDesign(designId: string, title: string, onProgress: (p: CanvaImportProgress) => void): Promise<CanvaImportResult>` · `deleteCanvaPdf(absPath: string): Promise<void>` · `sweepOrphanPdfs(referenced: string[]): Promise<number>`

- [ ] **Step 1: Add `atomicWriteFile` to `src/main/storage/atomic.ts`**

Append:

```ts
/**
 * Atomic binary write — same tmp-then-rename guarantee as
 * atomicWriteJson, but for buffers. `atomicWriteJson` cannot be reused
 * here: it JSON.stringifies and writes utf8, which would corrupt a PDF.
 *
 * The tmp file is created in the destination directory so the rename
 * stays on one filesystem and therefore stays atomic.
 */
export async function atomicWriteFile(path: string, data: Uint8Array): Promise<void> {
  const tmp = `${path}.tmp`
  await writeFile(tmp, data)
  await rename(tmp, path)
}
```

- [ ] **Step 2: Create `src/main/canva/import.ts`**

```ts
/**
 * Canva import pipeline: export → poll → download → atomic write.
 *
 * Downloaded PDFs live in userData/media/canva/. That location is not
 * incidental — media/ is already walked recursively by backup.ts, so
 * imported decks travel with a church's backup at no extra cost.
 *
 * Filenames include a timestamp so a refresh writes to a NEW path. That
 * matters beyond tidiness: pdf.js caches documents by path, so reusing
 * one path would serve the stale render until eviction.
 */

import { readdir, rm } from 'fs/promises'
import { join, basename } from 'path'
import { net } from 'electron'
import { unixSecondsToIso, type CanvaImportProgress, type CanvaImportResult } from '@shared/canva'
import { getCanvaMediaDir } from '../storage/paths'
import { atomicWriteFile } from '../storage/atomic'
import { exportDesignToPdfUrl, getDesignUpdatedAt } from './api'

/** Keep filenames filesystem-safe across Windows, macOS, and Linux. */
function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 40)
}

export async function importDesign(
  designId: string,
  title: string,
  onProgress: (p: CanvaImportProgress) => void
): Promise<CanvaImportResult> {
  onProgress({ phase: 'exporting' })
  const downloadUrl = await exportDesignToPdfUrl(designId, () =>
    onProgress({ phase: 'exporting' })
  )

  onProgress({ phase: 'downloading' })
  // Download immediately — Canva's export URLs expire after 24 hours, so
  // the URL is never persisted anywhere.
  const res = await net.fetch(downloadUrl)
  if (!res.ok) throw new Error(`Could not download the exported PDF (${res.status}).`)
  const bytes = new Uint8Array(await res.arrayBuffer())

  const filename = `${safeSegment(designId)}-${Date.now()}.pdf`
  const pdfPath = join(getCanvaMediaDir(), filename)
  await atomicWriteFile(pdfPath, bytes)

  // Read updated_at AFTER exporting: an edit made mid-export should show
  // as stale next time rather than being silently recorded as current.
  const updatedAt = await getDesignUpdatedAt(designId)

  return { pdfPath, title, designUpdatedAt: unixSecondsToIso(updatedAt) }
}

/**
 * Delete a PDF this app owns. Refuses paths outside media/canva/ so a
 * malformed item can never point deletion at the user's own files.
 */
export async function deleteCanvaPdf(absPath: string): Promise<void> {
  const dir = getCanvaMediaDir()
  if (!absPath.startsWith(dir)) {
    console.warn('[canva] refusing to delete outside media/canva:', absPath)
    return
  }
  await rm(absPath, { force: true })
}

/**
 * Remove PDFs no setlist references any more.
 *
 * Refresh deletes the file it supersedes, which covers the main growth
 * vector; deleting a setlist item does not, which this covers.
 */
export async function sweepOrphanPdfs(referenced: string[]): Promise<number> {
  const dir = getCanvaMediaDir()
  const keep = new Set(referenced.map((p) => basename(p)))
  let removed = 0
  try {
    for (const name of await readdir(dir)) {
      if (!name.endsWith('.pdf') || keep.has(name)) continue
      await rm(join(dir, name), { force: true })
      removed++
    }
  } catch (err) {
    // Never block startup on housekeeping.
    console.error('[canva] orphan sweep failed', err)
  }
  return removed
}
```

- [ ] **Step 3: Verify types compile**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/main/storage/atomic.ts src/main/canva/import.ts
git commit -m "feat(canva): import pipeline with atomic binary writes

atomicWriteFile is a new binary sibling of atomicWriteJson, which
JSON.stringifies and would corrupt a PDF. Export URLs are downloaded
immediately and never persisted (24h expiry).

Each import writes a fresh timestamped path so pdf.js's path-keyed
cache cannot serve a stale render after refresh. Deletion is fenced to
media/canva/."
```

---

## Task 7: IPC contract, handlers, and preload

**Files:**
- Modify: `src/shared/ipc-contract.ts`
- Create: `src/main/ipc/canva.ts`
- Modify: `src/main/ipc/index.ts`, `src/preload/index.ts`

**Interfaces:**
- Consumes: all of Tasks 4–6
- Produces: `window.api.canva` — `getState()`, `connect()`, `disconnect()`, `listDesigns()`, `importDesign()`, `checkStale()`, `deletePdf()`, `onImportProgress()`

- [ ] **Step 1: Add the contract to `src/shared/ipc-contract.ts`**

Add to the imports from `./canva`:

```ts
import type {
  CanvaConnectionState,
  CanvaDesignPage,
  CanvaImportProgress,
  CanvaImportResult
} from './canva'
```

Add to the `PresentApi` interface:

```ts
  /**
   * Canva integration. Browse designs in a connected Canva account and
   * pull them in as `deck` items. Every call reaches Canva from the main
   * process; the renderer never holds a token.
   */
  canva: {
    getState(): Promise<CanvaConnectionState>
    /** Opens the system browser. Resolves once the flow completes or fails. */
    connect(): Promise<CanvaConnectionState>
    disconnect(): Promise<CanvaConnectionState>
    listDesigns(
      query: string | null,
      continuation: string | null
    ): Promise<CanvaDesignPage>
    importDesign(designId: string, title: string): Promise<CanvaImportResult>
    /** Design ids whose Canva `updated_at` is newer than the given ISO stamp. */
    checkStale(items: { designId: string; designUpdatedAt: string }[]): Promise<string[]>
    deletePdf(absPath: string): Promise<void>
    /** Import progress. Returns an unsubscribe function. */
    onImportProgress(callback: (p: CanvaImportProgress) => void): () => void
  }
```

Add to `CHANNELS`:

```ts
  canva: {
    getState: 'canva:getState',
    connect: 'canva:connect',
    disconnect: 'canva:disconnect',
    listDesigns: 'canva:listDesigns',
    importDesign: 'canva:importDesign',
    checkStale: 'canva:checkStale',
    deletePdf: 'canva:deletePdf',
    sweepOrphans: 'canva:sweepOrphans',
    // Broadcast main -> operator window during an import
    eventImportProgress: 'canva:event:importProgress'
  },
```

- [ ] **Step 2: Create `src/main/ipc/canva.ts`**

```ts
/**
 * Canva IPC handlers.
 *
 * Handlers convert thrown errors into rejected invokes, which the
 * renderer surfaces as operator-facing copy. Nothing here logs tokens.
 */

import { ipcMain } from 'electron'
import { CHANNELS } from '@shared/ipc-contract'
import type {
  CanvaConnectionState,
  CanvaDesignPage,
  CanvaImportResult
} from '@shared/canva'
import { isDesignStale } from '@shared/canva'
import { connect, disconnect } from '../canva/auth'
import { listDesigns, getDesignUpdatedAt } from '../canva/api'
import { importDesign, deleteCanvaPdf, sweepOrphanPdfs } from '../canva/import'
import { loadTokens, isTokenStorageAvailable } from '../storage/canvaTokens'
import { getOperatorWindow } from '../windows'

async function currentState(): Promise<CanvaConnectionState> {
  if (!isTokenStorageAvailable()) {
    return {
      status: 'unavailable',
      reason:
        'Present cannot securely store a Canva connection on this system. Canva import is unavailable.'
    }
  }
  const tokens = await loadTokens()
  if (!tokens) return { status: 'disconnected' }
  return {
    status: 'connected',
    accountName: tokens.accountName,
    connectedAt: tokens.connectedAt
  }
}

export function registerCanvaHandlers(): void {
  ipcMain.handle(CHANNELS.canva.getState, currentState)

  ipcMain.handle(CHANNELS.canva.connect, async (): Promise<CanvaConnectionState> => {
    await connect()
    return currentState()
  })

  ipcMain.handle(CHANNELS.canva.disconnect, async (): Promise<CanvaConnectionState> => {
    await disconnect()
    return currentState()
  })

  ipcMain.handle(
    CHANNELS.canva.listDesigns,
    (_, query: string | null, continuation: string | null): Promise<CanvaDesignPage> =>
      listDesigns(query, continuation)
  )

  ipcMain.handle(
    CHANNELS.canva.importDesign,
    (_, designId: string, title: string): Promise<CanvaImportResult> =>
      importDesign(designId, title, (progress) => {
        const win = getOperatorWindow()
        if (win && !win.isDestroyed()) {
          win.webContents.send(CHANNELS.canva.eventImportProgress, progress)
        }
      })
  )

  /**
   * Sequential by design. The 20/min ceiling we have documented is the
   * export limit; the metadata endpoint's is unconfirmed, and a typical
   * setlist holds a handful of decks, so serial costs nothing worth
   * optimizing against an unknown budget.
   *
   * Individual failures are swallowed: a design deleted in Canva, or a
   * dropped connection, must not fail the whole pass or block the setlist.
   */
  ipcMain.handle(
    CHANNELS.canva.checkStale,
    async (_, items: { designId: string; designUpdatedAt: string }[]): Promise<string[]> => {
      const stale: string[] = []
      for (const item of items) {
        try {
          const updatedAt = await getDesignUpdatedAt(item.designId)
          const origin = { designId: item.designId, designUpdatedAt: item.designUpdatedAt, importedAt: '' }
          if (isDesignStale(origin, updatedAt)) stale.push(item.designId)
        } catch {
          // Offline is a normal condition for this app, not an error.
        }
        await new Promise((r) => setTimeout(r, 250))
      }
      return stale
    }
  )

  ipcMain.handle(CHANNELS.canva.deletePdf, (_, absPath: string) => deleteCanvaPdf(absPath))

  ipcMain.handle(CHANNELS.canva.sweepOrphans, (_, referenced: string[]) =>
    sweepOrphanPdfs(referenced)
  )
}
```

- [ ] **Step 3: Register the handlers in `src/main/ipc/index.ts`**

Add the import `import { registerCanvaHandlers } from './canva'` and call `registerCanvaHandlers()` inside `registerAllIpcHandlers()`.

- [ ] **Step 4: Add the preload surface in `src/preload/index.ts`**

Add `CanvaImportProgress` to the type imports from `@shared/canva`, then add to the `api` object:

```ts
  canva: {
    getState: () => ipcRenderer.invoke(CHANNELS.canva.getState),
    connect: () => ipcRenderer.invoke(CHANNELS.canva.connect),
    disconnect: () => ipcRenderer.invoke(CHANNELS.canva.disconnect),
    listDesigns: (query: string | null, continuation: string | null) =>
      ipcRenderer.invoke(CHANNELS.canva.listDesigns, query, continuation),
    importDesign: (designId: string, title: string) =>
      ipcRenderer.invoke(CHANNELS.canva.importDesign, designId, title),
    checkStale: (items: { designId: string; designUpdatedAt: string }[]) =>
      ipcRenderer.invoke(CHANNELS.canva.checkStale, items),
    deletePdf: (absPath: string) =>
      ipcRenderer.invoke(CHANNELS.canva.deletePdf, absPath),
    onImportProgress: (callback: (p: CanvaImportProgress) => void): (() => void) => {
      const listener = (_: IpcRendererEvent, p: CanvaImportProgress): void => callback(p)
      ipcRenderer.on(CHANNELS.canva.eventImportProgress, listener)
      return () =>
        ipcRenderer.removeListener(CHANNELS.canva.eventImportProgress, listener)
    }
  },
```

- [ ] **Step 5: Verify types compile**

Run: `pnpm typecheck`
Expected: no errors. A failure here usually means `PresentApi.canva` and the preload object disagree — that is the contract doing its job.

- [ ] **Step 6: Commit**

```bash
git add src/shared/ipc-contract.ts src/main/ipc/canva.ts src/main/ipc/index.ts src/preload/index.ts
git commit -m "feat(canva): IPC contract, handlers, and preload surface

Staleness checks run sequentially and swallow individual failures so a
deleted design or dropped connection never blocks opening a setlist."
```

---

## Task 8: Renderer connection/design store

**Files:**
- Create: `src/renderer/src/stores/useCanvaStore.ts`

**Interfaces:**
- Consumes: `window.api.canva` (Task 7)
- Produces: `useCanvaStore` with `state`, `designs`, `continuation`, `loading`, `error`, `importing`, `progress`, `loadState()`, `connect()`, `disconnect()`, `search(query)`, `loadMore()`

- [ ] **Step 1: Create `src/renderer/src/stores/useCanvaStore.ts`**

```ts
/**
 * useCanvaStore — connection state and the browsable design list.
 *
 * Unlike useBibleStore, which caches a static catalog, this holds a
 * remote, paginated, searchable list. Search is server-side (Canva
 * ranks by relevance), so this store cannot filter a local array the
 * way SongPicker does.
 */

import { create } from 'zustand'
import type {
  CanvaConnectionState,
  CanvaDesign,
  CanvaImportProgress
} from '@shared/canva'

interface CanvaState {
  state: CanvaConnectionState
  designs: CanvaDesign[]
  continuation: string | null
  query: string
  loading: boolean
  error: string | null
  importing: boolean
  progress: CanvaImportProgress | null

  loadState: () => Promise<void>
  connect: () => Promise<void>
  disconnect: () => Promise<void>
  search: (query: string) => Promise<void>
  loadMore: () => Promise<void>
  setImporting: (importing: boolean) => void
  setProgress: (progress: CanvaImportProgress | null) => void
}

const message = (err: unknown, fallback: string): string =>
  err instanceof Error ? err.message : fallback

export const useCanvaStore = create<CanvaState>((set, get) => ({
  state: { status: 'disconnected' },
  designs: [],
  continuation: null,
  query: '',
  loading: false,
  error: null,
  importing: false,
  progress: null,

  loadState: async () => {
    try {
      set({ state: await window.api.canva.getState() })
    } catch (err) {
      set({ error: message(err, 'Could not read Canva connection state') })
    }
  },

  connect: async () => {
    set({ state: { status: 'connecting' }, error: null })
    try {
      const state = await window.api.canva.connect()
      set({ state })
      if (state.status === 'connected') await get().search('')
    } catch (err) {
      set({
        state: { status: 'disconnected' },
        error: message(err, 'Could not connect to Canva')
      })
    }
  },

  disconnect: async () => {
    try {
      set({
        state: await window.api.canva.disconnect(),
        designs: [],
        continuation: null,
        query: ''
      })
    } catch (err) {
      set({ error: message(err, 'Could not disconnect Canva') })
    }
  },

  search: async (query: string) => {
    set({ loading: true, error: null, query })
    try {
      const page = await window.api.canva.listDesigns(query || null, null)
      // Ignore a response whose query is no longer the active one — a
      // slow first request must not overwrite a newer, faster one.
      if (get().query !== query) return
      set({ designs: page.designs, continuation: page.continuation, loading: false })
    } catch (err) {
      set({ loading: false, error: message(err, 'Could not reach Canva') })
    }
  },

  loadMore: async () => {
    const { continuation, query, loading, designs } = get()
    if (!continuation || loading) return
    set({ loading: true, error: null })
    try {
      const page = await window.api.canva.listDesigns(query || null, continuation)
      set({
        designs: [...designs, ...page.designs],
        continuation: page.continuation,
        loading: false
      })
    } catch (err) {
      set({ loading: false, error: message(err, 'Could not load more designs') })
    }
  },

  setImporting: (importing) => set({ importing }),
  setProgress: (progress) => set({ progress })
}))
```

- [ ] **Step 2: Verify types compile**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/stores/useCanvaStore.ts
git commit -m "feat(canva): renderer store for connection and design list

Server-side search with a stale-response guard so a slow earlier query
cannot overwrite a newer one."
```

---

## Task 9: Canva picker in the add-item flow

**Files:**
- Create: `src/renderer/src/components/CanvaPicker.tsx`
- Modify: `src/renderer/src/components/ItemKindIcon.tsx`, `src/renderer/src/components/AddItemPicker.tsx`, `src/renderer/src/pages/SetlistEditor.tsx`

**Interfaces:**
- Consumes: `useCanvaStore` (Task 8); `probePdfPageCount` from `../lib/pdfLoader`
- Produces: `CanvaPicker` component; `AddItemPicker` gains `view: 'grid' | 'song' | 'canva'` and an `onImportCanva(result, designUpdatedAt)` handler

- [ ] **Step 1: Widen `ItemKindIcon` to accept `'canva'`**

Change the `Kind` type and add a case before the closing brace of the switch:

```ts
/**
 * Setlist item kinds, plus 'canva' — which is an import *source* rather
 * than an item kind (a Canva import becomes a `deck`). It lives here
 * anyway because this file exists to be the single glyph vocabulary, and
 * splintering a second icon source into AddItemPicker costs more than
 * one union member.
 */
type Kind = SetlistItem['kind'] | 'canva'
```

```tsx
    case 'canva':
      // Canva's mark is trademarked, so this is a neutral "design
      // document" glyph rather than an imitation of their logo.
      return (
        <svg {...common}>
          <rect x="3" y="3" width="18" height="18" rx="4" />
          <circle cx="12" cy="12" r="4" />
        </svg>
      )
```

Also update `itemKindLabel` in the same file to return `'Canva'` for `'canva'`.

- [ ] **Step 2: Add the Canva card to `AddItemPicker.tsx`**

Extend `KindCardSpec['kind']` with `| 'canva'`, add to `KIND_CARDS`:

```ts
  { kind: 'canva', hint: 'From your Canva account' }
```

Add `'canva'` to the `view` prop union, add `onOpenCanva: () => void` to `Handlers`, add a `case 'canva': setView('canva'); return` to `handlePick`, and render `CanvaPicker` when `view === 'canva'` using the same back-button header as the song view:

```tsx
    view === 'canva' ? (
      <div>
        <div className="mb-2 flex items-center justify-between">
          <button
            onClick={() => setView('grid')}
            className="text-[11px] text-muted-foreground hover:text-foreground"
          >
            ← Back
          </button>
          <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground/70">
            Import from Canva
          </span>
        </div>
        <CanvaPicker onImported={onImportCanva} onClose={onClose} />
      </div>
    ) : ...
```

- [ ] **Step 3: Create `src/renderer/src/components/CanvaPicker.tsx`**

```tsx
/**
 * CanvaPicker — browse and import designs from a connected Canva account.
 *
 * Unlike SongPicker, which filters an already-loaded local array, this
 * list is remote, paginated, and searched server-side. That is why it
 * carries real loading/empty/error/offline states.
 *
 * Connecting happens here rather than by redirecting to Settings: an
 * operator who clicked "Canva" on a Sunday morning should not be sent
 * hunting through Settings to finish the job.
 */

import { useEffect, useRef, useState } from 'react'
import { useCanvaStore } from '../stores/useCanvaStore'
import type { CanvaImportResult } from '@shared/canva'

interface Props {
  onImported: (result: CanvaImportResult, designId: string) => void
  onClose: () => void
}

export function CanvaPicker({ onImported }: Props): JSX.Element {
  const {
    state, designs, continuation, loading, error, importing, progress,
    loadState, connect, search, loadMore, setImporting, setProgress
  } = useCanvaStore()

  const [input, setInput] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void loadState()
  }, [loadState])

  // Load the default (most-recently-modified) page as soon as we know we
  // are connected — the design edited last night is usually the target.
  useEffect(() => {
    if (state.status === 'connected' && designs.length === 0 && !loading) {
      void search('')
    }
  }, [state.status])

  // Debounce so typing does not fire a request per keystroke against a
  // rate-limited API.
  useEffect(() => {
    if (state.status !== 'connected') return
    const t = setTimeout(() => void search(input), 300)
    return () => clearTimeout(t)
  }, [input, state.status])

  useEffect(() => {
    const off = window.api.canva.onImportProgress(setProgress)
    return off
  }, [setProgress])

  const handleImport = async (designId: string, title: string): Promise<void> => {
    setImporting(true)
    try {
      const result = await window.api.canva.importDesign(designId, title)
      onImported(result, designId)
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Could not import that design.')
    } finally {
      setImporting(false)
      setProgress(null)
    }
  }

  if (state.status === 'unavailable') {
    return <p className="p-3 text-xs text-muted-foreground">{state.reason}</p>
  }

  if (state.status === 'disconnected' || state.status === 'connecting') {
    return (
      <div className="flex flex-col items-start gap-2 p-3">
        <p className="text-xs text-muted-foreground">
          Connect your Canva account to pull designs straight into this setlist.
        </p>
        <button
          onClick={() => void connect()}
          disabled={state.status === 'connecting'}
          className="rounded-md border border-border/60 bg-background px-2.5 py-1 text-xs hover:border-border disabled:opacity-60"
        >
          {state.status === 'connecting' ? 'Waiting for your browser…' : 'Connect Canva'}
        </button>
        {error && <p className="text-[11px] text-destructive">{error}</p>}
      </div>
    )
  }

  if (importing) {
    return (
      <p className="p-3 text-xs text-muted-foreground">
        {progress?.phase === 'downloading'
          ? 'Downloading the exported PDF…'
          : 'Asking Canva to export this design…'}
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={inputRef}
        autoFocus
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Search your Canva designs…"
        className="w-full rounded-md border border-border/60 bg-background px-2.5 py-1.5 text-sm"
      />

      {error && <p className="text-[11px] text-destructive">{error}</p>}

      {!loading && designs.length === 0 && (
        <p className="p-2 text-xs text-muted-foreground">
          {input ? 'No designs matched that search.' : 'No designs found in your Canva account.'}
        </p>
      )}

      <div className="grid max-h-64 grid-cols-3 gap-2 overflow-y-auto">
        {designs.map((d) => (
          <button
            key={d.id}
            onClick={() => void handleImport(d.id, d.title)}
            className="group flex flex-col gap-1 rounded-lg border border-border/50 bg-background/40 p-2 text-left hover:border-brand/50"
          >
            {d.thumbnailUrl ? (
              <img
                src={d.thumbnailUrl}
                alt=""
                className="aspect-video w-full rounded object-cover"
                loading="lazy"
              />
            ) : (
              <div className="aspect-video w-full rounded bg-muted/50" />
            )}
            <span className="line-clamp-2 text-[11px] leading-tight text-foreground">
              {d.title}
            </span>
          </button>
        ))}
      </div>

      {loading && <p className="p-1 text-[11px] text-muted-foreground">Loading…</p>}

      {continuation && !loading && (
        <button
          onClick={() => void loadMore()}
          className="rounded-md border border-border/60 px-2.5 py-1 text-[11px] hover:border-border"
        >
          Load more
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Wire the import into `SetlistEditor.tsx`**

Add alongside the existing `addDeck`:

```ts
  const addCanvaDeck = async (
    result: CanvaImportResult,
    designId: string
  ): Promise<void> => {
    try {
      // Derive pageCount from the file itself, exactly as the manual deck
      // flow does. Canva's page_count is ignored — it is optional for some
      // design types, and this path is always correct.
      const pageCount = await probePdfPageCount(result.pdfPath)
      insertItem({
        kind: 'deck',
        id: genItemId(),
        pdfPath: result.pdfPath,
        pageCount,
        title: result.title,
        canva: {
          designId,
          designUpdatedAt: result.designUpdatedAt,
          importedAt: new Date().toISOString()
        }
      })
    } catch (err) {
      console.error('[SetlistEditor] failed to open Canva PDF', result.pdfPath, err)
      window.alert('Present could not open the PDF Canva produced. Please try importing again.')
    }
    closePicker()
  }
```

Pass `onOpenCanva={() => setPickerView('canva')}` and `onImportCanva={addCanvaDeck}` to every `AddItemPicker` usage, and import `CanvaImportResult` from `@shared/canva`.

- [ ] **Step 5: Verify types compile and the app runs**

Run: `pnpm typecheck`
Expected: no errors.

Then, with the stub running in another terminal (`pnpm dev:canva-stub`), run `pnpm dev`, open a setlist, click **+ Add item → Canva**, connect, and import a multi-page design.
Expected: the deck appears with the right page count, and slides keep 16:9 proportions.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/CanvaPicker.tsx src/renderer/src/components/ItemKindIcon.tsx src/renderer/src/components/AddItemPicker.tsx src/renderer/src/pages/SetlistEditor.tsx
git commit -m "feat(canva): design picker in the add-item flow

Third view in AddItemPicker with debounced server-side search, thumbnail
grid, and pagination. Connecting happens in the picker rather than
redirecting to Settings mid-task.

Page count is probed from the downloaded PDF, matching the manual deck
flow, so Canva's optional page_count is never relied on."
```

---

## Task 10: Settings → Connections

**Files:**
- Create: `src/renderer/src/components/CanvaConnectionCard.tsx`
- Modify: `src/renderer/src/pages/Settings.tsx`

**Interfaces:**
- Consumes: `useCanvaStore` (Task 8)
- Produces: `CanvaConnectionCard` component; `'connections'` member of `Section`

- [ ] **Step 1: Create `src/renderer/src/components/CanvaConnectionCard.tsx`**

```tsx
/**
 * CanvaConnectionCard — the Settings → Connections panel body.
 *
 * A separate component rather than inline JSX because Settings.tsx is
 * already ~930 lines; inlining connect/disconnect/account state would
 * push it past 1000.
 */

import { useEffect } from 'react'
import { useCanvaStore } from '../stores/useCanvaStore'

export function CanvaConnectionCard(): JSX.Element {
  const { state, error, loadState, connect, disconnect } = useCanvaStore()

  useEffect(() => {
    void loadState()
  }, [loadState])

  return (
    <div className="rounded-lg border border-border/50 bg-card/40 p-4">
      <h3 className="text-sm font-semibold text-foreground">Canva</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Pull designs from Canva straight into a setlist. Present can browse your
        designs and export them — nothing else. It never edits or deletes
        anything in your Canva account.
      </p>

      {state.status === 'unavailable' ? (
        <p className="mt-3 text-xs text-muted-foreground">{state.reason}</p>
      ) : state.status === 'connected' ? (
        <div className="mt-3 flex items-center gap-3">
          <span className="text-xs text-foreground">
            Connected{state.accountName ? ` as ${state.accountName}` : ''} ·{' '}
            {new Date(state.connectedAt).toLocaleDateString()}
          </span>
          <button
            onClick={() => void disconnect()}
            className="rounded-md border border-border/60 px-2.5 py-1 text-xs hover:border-border"
          >
            Disconnect
          </button>
        </div>
      ) : (
        <button
          onClick={() => void connect()}
          disabled={state.status === 'connecting'}
          className="mt-3 rounded-md border border-border/60 px-2.5 py-1 text-xs hover:border-border disabled:opacity-60"
        >
          {state.status === 'connecting' ? 'Waiting for your browser…' : 'Connect Canva'}
        </button>
      )}

      {error && <p className="mt-2 text-[11px] text-destructive">{error}</p>}

      <p className="mt-3 text-[11px] text-muted-foreground/70">
        Disconnecting does not remove designs you have already imported — those
        PDFs stay on this computer and keep working offline.
      </p>
    </div>
  )
}
```

- [ ] **Step 2: Add the section to `Settings.tsx`**

Add `'connections'` to the `Section` union, add to `SECTIONS` (before `'about'`):

```ts
  {
    id: 'connections',
    label: 'Connections',
    description: 'Link Present to the other tools your church already uses.'
  },
```

Import `CanvaConnectionCard` and render it in the panel body when `section === 'connections'`.

- [ ] **Step 3: Verify types compile and check the panel**

Run: `pnpm typecheck`
Expected: no errors.

Run `pnpm dev`, open Settings → Connections.
Expected: the card shows the current connection state; Disconnect returns it to disconnected.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/CanvaConnectionCard.tsx src/renderer/src/pages/Settings.tsx
git commit -m "feat(canva): Settings → Connections panel

States what Present can see in plain language, and makes explicit that
disconnecting leaves already-imported decks working offline."
```

---

## Task 11: Provenance and staleness on the item card

**Files:**
- Modify: `src/renderer/src/components/SetlistItemCard.tsx`

**Interfaces:**
- Consumes: `CanvaOrigin` (Task 1); `window.api.canva.importDesign` / `deletePdf` (Task 7); `probePdfPageCount`, `evictPdfDocument` from `../lib/pdfLoader`
- Produces: a `staleDesignIds: string[]` prop on `SetlistItemCard`

- [ ] **Step 1: Add the badges and Refresh action**

Add `staleDesignIds?: string[]` to the props interface. Inside the existing `if (item.kind === 'deck')` block, add above the returned JSX:

```tsx
    const origin = item.canva
    const isStale = origin ? (staleDesignIds ?? []).includes(origin.designId) : false

    const handleRefresh = async (): Promise<void> => {
      if (!origin) return
      const previousPath = item.pdfPath
      try {
        const result = await window.api.canva.importDesign(origin.designId, item.title ?? '')
        const pageCount = await probePdfPageCount(result.pdfPath)
        onChange({
          ...item,
          pdfPath: result.pdfPath,
          pageCount,
          canva: {
            ...origin,
            designUpdatedAt: result.designUpdatedAt,
            importedAt: new Date().toISOString()
          }
        })
        // Release pdf.js's handle BEFORE deleting: on Windows an open
        // file cannot be removed, so skipping this leaks a PDF per refresh.
        evictPdfDocument(previousPath)
        await window.api.canva.deletePdf(previousPath)
      } catch (err) {
        // The existing deck keeps working — a failed refresh must never
        // cost the operator the slides they already had.
        window.alert(
          err instanceof Error ? err.message : 'Could not refresh from Canva.'
        )
      }
    }
```

Then render, inside the deck block's button row:

```tsx
          {origin && (
            <>
              <span className="rounded bg-muted/50 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                From Canva
              </span>
              {isStale && (
                <span className="rounded bg-brand/15 px-1.5 py-0.5 text-[10px] text-brand">
                  Updated in Canva
                </span>
              )}
              <button
                onClick={() => void handleRefresh()}
                className="rounded-md border border-border/60 bg-background px-2.5 py-1 text-xs hover:border-border"
              >
                Refresh
              </button>
            </>
          )}
```

Add `evictPdfDocument` to the existing `pdfLoader` import.

- [ ] **Step 2: Verify types compile**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/SetlistItemCard.tsx
git commit -m "feat(canva): provenance and stale badges with refresh

Refresh evicts pdf.js's cached handle before deleting the superseded
PDF — on Windows an open file cannot be removed, which would otherwise
leak one PDF per refresh. A failed refresh leaves the existing deck
untouched."
```

---

## Task 12: Staleness check on setlist open

**Files:**
- Modify: `src/renderer/src/pages/SetlistEditor.tsx`

**Interfaces:**
- Consumes: `window.api.canva.checkStale` (Task 7)
- Produces: `staleDesignIds` state passed down to `SetlistItemCard`

- [ ] **Step 1: Add the background check**

Add near the other hooks in `SetlistEditor`:

```ts
  const [staleDesignIds, setStaleDesignIds] = useState<string[]>([])

  // Background staleness check. Deliberately fire-and-forget and silent
  // on failure: this app is offline-first, so an unreachable Canva is a
  // normal condition, not something to interrupt the operator about.
  useEffect(() => {
    if (!setlist) return
    const canvaItems = setlist.items.flatMap((item) =>
      item.kind === 'deck' && item.canva
        ? [{ designId: item.canva.designId, designUpdatedAt: item.canva.designUpdatedAt }]
        : []
    )
    if (canvaItems.length === 0) return

    let cancelled = false
    void window.api.canva
      .checkStale(canvaItems)
      .then((ids) => {
        if (!cancelled) setStaleDesignIds(ids)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [setlist?.id])
```

Pass `staleDesignIds={staleDesignIds}` to each `SetlistItemCard`.

- [ ] **Step 2: Verify types compile and check behavior**

Run: `pnpm typecheck`
Expected: no errors.

Then: import a design, edit it in Canva, reopen the setlist.
Expected: the "Updated in Canva" badge appears. Clicking Refresh replaces the PDF and clears the badge on the next open.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/pages/SetlistEditor.tsx
git commit -m "feat(canva): flag decks whose Canva design has changed

Fire-and-forget check keyed on setlist id, cancelled on unmount, silent
on failure. Never blocks opening or editing a setlist."
```

---

## Task 13: Orphan PDF sweep at startup

**Files:**
- Modify: `src/main/index.ts`

**Interfaces:**
- Consumes: `sweepOrphanPdfs` (Task 6); `listSetlists` from `./storage/setlists`
- Produces: nothing (startup side effect)

- [ ] **Step 1: Add the sweep to startup**

In `src/main/index.ts`, add these imports:

```ts
import { listSetlists } from './storage/setlists'
import { sweepOrphanPdfs } from './canva/import'
```

Then, inside the existing `app.whenReady().then(async () => { … })` block, after the `registerAllIpcHandlers()` call (currently `src/main/index.ts:303`):

```ts
  // Housekeeping: drop Canva PDFs no setlist references any more.
  // Refresh deletes the file it supersedes, but deleting a setlist item
  // does not — without this, media/canva/ grows without bound.
  //
  // Fire-and-forget: startup must never block or fail on housekeeping.
  void (async () => {
    try {
      const setlists = await listSetlists()
      const referenced = setlists.flatMap((s) =>
        s.items.flatMap((item) =>
          item.kind === 'deck' && item.canva ? [item.pdfPath] : []
        )
      )
      const removed = await sweepOrphanPdfs(referenced)
      if (removed > 0) console.log(`[canva] removed ${removed} orphaned PDF(s)`)
    } catch (err) {
      console.error('[canva] orphan sweep failed', err)
    }
  })()
```

The sweep runs after handler registration rather than before, so a slow disk walk can never delay the point at which the operator window becomes usable.

- [ ] **Step 2: Verify types compile and the app boots**

Run: `pnpm typecheck && pnpm dev`
Expected: no errors; app boots normally. With an orphan present, the log line appears and the file is gone.

- [ ] **Step 3: Run the full check**

Run: `pnpm build`
Expected: typecheck, tests, and the electron-vite build all pass.

- [ ] **Step 4: Commit**

```bash
git add src/main/index.ts
git commit -m "feat(canva): sweep orphaned PDFs at startup

Deleting a Canva deck item leaves its PDF behind; without this,
media/canva/ grows without bound. Fire-and-forget so housekeeping can
never block or fail startup."
```

---

## Manual verification checklist

Run with the stub server active (`pnpm dev:canva-stub` in a second terminal).

- [ ] Connect from the picker; browser opens, consent completes, picker populates.
- [ ] Connect from Settings → Connections; state shows the account name.
- [ ] Abandon the consent screen; the flow times out and leaves no listener running.
- [ ] Import a multi-page design → deck has the correct page count.
- [ ] **Slides keep 16:9 proportions** — the single highest-value check, since `size` failures look like success.
- [ ] Search finds a design by title; "Load more" appends without duplicates.
- [ ] Edit the design in Canva, reopen the setlist → "Updated in Canva" appears.
- [ ] Refresh replaces the PDF, updates page count, deletes the old file (verify `media/canva/`).
- [ ] Refresh on Windows specifically — confirms the `evictPdfDocument` ordering.
- [ ] Disconnect → already-imported decks still present offline.
- [ ] Pull the network mid-browse → error copy appears, setlist editing still works.
- [ ] Export a backup, wipe `userData`, restore → Canva decks return and render.
- [ ] Delete a Canva deck item, restart → its PDF is swept.
- [ ] Service Mode presents a Canva deck identically to a hand-picked one.
