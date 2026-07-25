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
 *
 * Every Canva call goes through useCanvaStore, never window.api.canva
 * directly — see the store's wrapCanvaCall doc for why that matters:
 * error identity does not survive IPC, so the store re-checks connection
 * state on every failure to decide "reconnect" vs. "just retry". A
 * direct call here would skip that check.
 */

import { useEffect, useRef, useState } from 'react'
import { useCanvaStore } from '../stores/useCanvaStore'
import type { CanvaDesign, CanvaImportResult } from '@shared/canva'

interface Props {
  onImported: (result: CanvaImportResult, designId: string) => void
  onClose: () => void
}

export function CanvaPicker({ onImported }: Props): JSX.Element {
  const {
    state,
    designs,
    continuation,
    loading,
    error,
    importing,
    progress,
    loadState,
    connect,
    search,
    loadMore,
    importDesign,
    setProgress
  } = useCanvaStore()

  // Seeded from the store's current query, not '' — useCanvaStore is a
  // module-level singleton, so `designs`/`query` survive this component
  // unmounting (e.g. the operator clicks "← Back" then reopens Canva).
  // Starting `input` at '' unconditionally would show an empty search box
  // over a grid that still reflects the previous search, which reads as
  // "the search box is broken" to an operator who has moved on to
  // something else. Seeding preserves their previous search rather than
  // silently discarding it, and costs no network call.
  const [input, setInput] = useState(() => useCanvaStore.getState().query)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void loadState()
  }, [loadState])

  // Load the default (most-recently-modified) page as soon as we know we
  // are connected — the design edited last night is usually the target.
  // Guarded by a ref rather than `designs.length === 0` alone: an
  // account that genuinely has zero designs would otherwise retrigger
  // this on every render forever (0 results keeps the condition true).
  //
  // Restricted to `input === ''`: this auto-load exists to fetch the
  // default listing on a fresh connection, not to silently re-run a
  // reopened picker's previous (possibly non-empty) query. `input` is
  // already seeded from the store above, so a reopen with a cached
  // zero-result search is left as-is instead of re-querying it.
  const didAutoLoad = useRef(false)
  useEffect(() => {
    if (state.status !== 'connected') {
      didAutoLoad.current = false
      return
    }
    if (didAutoLoad.current || loading) return
    didAutoLoad.current = true
    if (input === '' && designs.length === 0) void search(input)
  }, [state.status, designs.length, loading, search, input])

  // Debounce so typing does not fire a request per keystroke against a
  // rate-limited API. The very first effect run for a connected session
  // is skipped deliberately — that default listing is already handled,
  // immediately and without delay, by the auto-load effect above.
  const skippedFirstDebounce = useRef(false)
  useEffect(() => {
    if (state.status !== 'connected') return
    if (!skippedFirstDebounce.current) {
      skippedFirstDebounce.current = true
      return
    }
    const t = setTimeout(() => void search(input), 300)
    return () => clearTimeout(t)
  }, [input, state.status, search])

  useEffect(() => {
    const off = window.api.canva.onImportProgress(setProgress)
    return off
  }, [setProgress])

  const handleImport = async (design: CanvaDesign): Promise<void> => {
    const result = await importDesign(design.id, design.title)
    if (!result) {
      // importDesign() has already refreshed connection state (so a
      // revoked grant flips this view to the reconnect prompt below) and
      // set `error` to a message from the main process. Read it fresh
      // rather than the possibly-stale value captured by this closure.
      const message =
        useCanvaStore.getState().error ??
        'Could not import that design. Check your Canva connection and try again.'
      window.alert(message)
      return
    }
    onImported(result, design.id)
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

      {/* An error here does not replace the grid below — designs already
          loaded are still usable even if the most recent request failed. */}
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
            onClick={() => void handleImport(d)}
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
