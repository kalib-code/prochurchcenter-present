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
import { getValidAccessToken, requireReauth } from './auth'

const API_BASE = 'https://api.canva.com/rest/v1'

/**
 * Thrown for HTTP failures other than 401/403 so callers can map status to
 * operator-facing copy. A 401/403 from Canva itself means the operator's
 * connection needs to be re-established, which is signaled instead by
 * calling {@link requireReauth} (imported from ./auth) — the single place
 * that both clears the stored connection and throws
 * `CanvaReauthRequiredError`, so a subsequent `canva.getState()` call is
 * truthful. See the IPC note on `CanvaReauthRequiredError` in auth.ts.
 */
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
  if (status === 429) return 'Canva is busy right now — try again in a minute.'
  if (status === 404) return 'That design no longer exists in Canva.'
  return `Canva returned an error (${status}).`
}

async function canvaFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getValidAccessToken()

  let res: Response
  try {
    res = await net.fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    })
  } catch {
    // net.fetch throws on offline / DNS failure / connection refused.
    throw new Error(
      'Could not reach Canva. Check your internet connection and try again.'
    )
  }

  if (res.status === 401 || res.status === 403) {
    // Canva itself rejected the access token on this call. Clear the
    // stored connection and throw the same way auth.ts's own token
    // refresh failures do, so `canva.getState()` truthfully reports
    // `disconnected` afterward — see requireReauth's doc comment.
    return requireReauth()
  }
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

const EXPORT_ERROR_MESSAGE_MAX_LEN = 200

/**
 * Sanitize Canva's own export-failure message for display.
 *
 * This is the one deliberate exception to "never put a response body into
 * an error message" elsewhere in this module: Canva's `job.error.message`
 * is operator-facing failure copy, not credential material (unlike, say,
 * a token endpoint's body), and it explains the common real failure mode
 * — premium elements on a free account — far better than any generic
 * string this module could write. But it is still attacker/API-controlled
 * text that ends up in UI (and potentially log) surfaces, so it must be
 * bounded and stripped of control characters before use, rather than
 * thrown verbatim. Returns `null` (rather than the generic fallback
 * directly) so the caller can apply its own fallback message.
 */
function sanitizeExportErrorMessage(raw: string | undefined): string | null {
  if (!raw) return null
  const cleaned = raw
    .replace(/[\x00-\x1f\x7f]+/g, ' ') // strip control chars / newlines
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return null
  return cleaned.length > EXPORT_ERROR_MESSAGE_MAX_LEN
    ? `${cleaned.slice(0, EXPORT_ERROR_MESSAGE_MAX_LEN)}…`
    : cleaned
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
      sanitizeExportErrorMessage(job.error?.message) ??
        'Canva could not export this design. If it uses premium elements, try removing them or exporting from Canva directly.'
    )
  }

  if (job.status !== 'success') {
    // `job.status` is typed as a 3-value union, but it comes from an
    // untyped `res.json() as T` — a status Canva has not documented would
    // otherwise silently fall through to "no download link" below, which
    // misdescribes what actually happened.
    throw new Error('Canva returned an unrecognized export status. Please try again.')
  }

  const url = job.urls?.[0]
  if (!url) throw new Error('Canva reported success but returned no download link.')
  return url
}
