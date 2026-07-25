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
