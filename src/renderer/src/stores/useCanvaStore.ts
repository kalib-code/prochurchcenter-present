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
  CanvaImportProgress,
  CanvaImportResult
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
  /**
   * Import one design as a PDF. Routed through `wrapCanvaCall` like every
   * other Canva call — a revoked grant must flip connection state the
   * same way a failed search does, or the picker would keep showing a
   * retry affordance that can never succeed. Returns `null` on failure;
   * the caller reads `error` (or `getState().error`) for what to show.
   */
  importDesign: (designId: string, title: string) => Promise<CanvaImportResult | null>
  /**
   * Delete a PDF this app owns (used by SetlistItemCard's refresh flow to
   * remove the file a refresh just superseded). Routed through
   * `wrapCanvaCall` like every other Canva call for the same reason as
   * `importDesign` — see that doc comment. Returns `false` on failure;
   * callers should treat that as "the old file is orphaned, not
   * catastrophic" since nothing about the operator's setlist depends on
   * this call succeeding.
   */
  deletePdf: (absPath: string) => Promise<boolean>
  setImporting: (importing: boolean) => void
  setProgress: (progress: CanvaImportProgress | null) => void
}

const message = (err: unknown, fallback: string): string =>
  err instanceof Error ? err.message : fallback

type CanvaCallResult<T> = { ok: true; value: T } | { ok: false }

/**
 * Every `window.api.canva.*` call in this store must go through here —
 * there is no other path to the Canva API from this file.
 *
 * Electron serialises a rejected `ipcMain.handle` down to a plain
 * `Error`, so the renderer cannot use `instanceof` to distinguish
 * "reconnect needed" from "transient network problem" (see the header
 * comment on src/main/ipc/canva.ts). The main process instead makes
 * `getState()` authoritative: it clears stored tokens if and only if
 * reconnect is genuinely required, so calling `getState()` after any
 * failure truthfully reports whether the operator must reconnect or can
 * just retry. That contract only holds if every failed call re-reads
 * `getState()` before the UI decides what to render. Funnelling every
 * call through this one helper makes forgetting that re-check
 * impossible rather than merely documented — there's no other way to
 * reach the Canva API from this store to forget it in.
 *
 * `isCurrent` separates two things that must not share one on/off
 * switch: connection state is a fact about the account, not about which
 * request asked for it, so it is always refreshed and always applied.
 * The `error` text, though, belongs to one specific call — for a
 * query-scoped call (`search`/`loadMore`) a request that a newer query
 * has already superseded must not paint a stale failure over a newer,
 * successful result. `isCurrent` lets a caller opt into that
 * suppression; calls that are never superseded by anything
 * (`getState`, `connect`, `disconnect`) simply omit it and get the
 * default "always current" behaviour, so their errors are never
 * silently dropped.
 */
async function wrapCanvaCall<T>(
  set: (partial: Partial<CanvaState>) => void,
  call: () => Promise<T>,
  fallback: string,
  isCurrent: () => boolean = () => true
): Promise<CanvaCallResult<T>> {
  try {
    return { ok: true, value: await call() }
  } catch (err) {
    const error = message(err, fallback)
    let state: CanvaConnectionState | undefined
    try {
      // Refresh connection state unconditionally, before surfacing the
      // error, so the UI renders the correct branch (reconnect vs.
      // retry) on the same tick that the error appears.
      state = await window.api.canva.getState()
    } catch {
      // getState() itself failed. Keep whatever connection state we
      // already had rather than guess at it — but that second failure
      // must not swallow the original error below.
    }
    if (isCurrent()) {
      set(state ? { state, error } : { error })
    } else if (state) {
      // Superseded call: still apply the refreshed connection state
      // (it's not query-scoped), but do not surface its error — a
      // newer, current call owns the error slot now.
      set({ state })
    }
    return { ok: false }
  }
}

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
    // Note: if this call itself fails, wrapCanvaCall's failure branch
    // calls getState() a second time as its own refresh step — a
    // harmless retry of the same local read, not a network round trip.
    // That is the intended, uniform behaviour for every call through
    // this helper; do not special-case it away.
    const result = await wrapCanvaCall(
      set,
      () => window.api.canva.getState(),
      'Could not read Canva connection state'
    )
    if (result.ok) set({ state: result.value, error: null })
  },

  connect: async () => {
    set({ state: { status: 'connecting' }, error: null })
    const result = await wrapCanvaCall(
      set,
      () => window.api.canva.connect(),
      'Could not connect to Canva'
    )
    if (!result.ok) return
    set({ state: result.value, error: null })
    if (result.value.status === 'connected') await get().search('')
  },

  disconnect: async () => {
    const result = await wrapCanvaCall(
      set,
      () => window.api.canva.disconnect(),
      'Could not disconnect Canva'
    )
    if (!result.ok) return
    set({ state: result.value, error: null, designs: [], continuation: null, query: '' })
  },

  search: async (query: string) => {
    set({ loading: true, error: null, query })
    const result = await wrapCanvaCall(
      set,
      () => window.api.canva.listDesigns(query || null, null),
      'Could not reach Canva',
      () => get().query === query
    )
    if (!result.ok) {
      // Only clear the spinner if a newer search hasn't already taken
      // over — that request owns `loading` now.
      if (get().query === query) set({ loading: false })
      return
    }
    // Ignore a response whose query is no longer the active one — a
    // slow first request must not overwrite a newer, faster one.
    if (get().query !== query) return
    set({ designs: result.value.designs, continuation: result.value.continuation, loading: false })
  },

  loadMore: async () => {
    const { continuation, query, loading } = get()
    if (!continuation || loading) return
    set({ loading: true, error: null })
    const result = await wrapCanvaCall(
      set,
      () => window.api.canva.listDesigns(query || null, continuation),
      'Could not load more designs',
      () => get().query === query
    )
    if (!result.ok) {
      if (get().query === query) set({ loading: false })
      return
    }
    // Discard a page whose request started under a query that is no
    // longer active (a new search() may have run while this page was
    // in flight) — appending it would mix pages from different queries.
    if (get().query !== query) return
    set({
      designs: [...get().designs, ...result.value.designs],
      continuation: result.value.continuation,
      loading: false
    })
  },

  importDesign: async (designId: string, title: string) => {
    // Clear any stale error/progress from a previous attempt before this
    // one starts, same as search() does for its own error slot.
    set({ importing: true, progress: null, error: null })
    const result = await wrapCanvaCall(
      set,
      () => window.api.canva.importDesign(designId, title),
      'Could not import that design from Canva'
    )
    set({ importing: false, progress: null })
    return result.ok ? result.value : null
  },

  deletePdf: async (absPath: string) => {
    const result = await wrapCanvaCall(
      set,
      () => window.api.canva.deletePdf(absPath),
      'Could not delete the superseded PDF'
    )
    return result.ok
  },

  setImporting: (importing) => set({ importing }),
  setProgress: (progress) => set({ progress })
}))
