/**
 * AddItemPicker — the grid-of-cards picker for "which kind of item do
 * I want to add to the setlist?". Replaces the old text-only dropdown
 * that was pinned to the bottom of the SetlistEditor.
 *
 * Why a grid instead of a menu:
 *   - New operators don't yet have vocabulary for "song vs scripture
 *     vs deck" — seeing an icon + one-line hint for each kind cuts the
 *     learning curve vs a bare menu.
 *   - Seven kinds is right at the edge of "list" comfort; a 3×N grid
 *     takes the same vertical space but reads faster.
 *   - Cards are big click targets — important for trackpad operators
 *     on service morning who are under time pressure.
 *
 * Two modes:
 *   - Inline (mode="inline"): renders the grid directly. Used by the
 *     empty-state of SetlistEditor so the FIRST action a user takes is
 *     surfaced without any popover overhead.
 *   - Popover (mode="popover"): renders inside an absolutely-positioned
 *     panel with a close button and caret header. Used by the "+ Add
 *     item" buttons between/above existing items.
 *
 * Picking a kind fires the matching `on...` handler. For kinds that
 * need a native file picker (image, video, pdf), those handlers go
 * async in the parent; the picker doesn't concern itself with that —
 * it just fires the callback and relies on the parent to close it.
 *
 * Song is a two-step interaction: clicking "Song" swaps the picker
 * for the existing SongPicker rather than adding blank. That prevents
 * orphan empty-song items — every song in the setlist is guaranteed
 * to point at a real library entry.
 */

import { useEffect, useRef } from 'react'
import type { Song } from '@shared/types'
import type { CanvaImportResult } from '@shared/canva'
import { ItemKindIcon, itemKindLabel } from './ItemKindIcon'
import { SongPicker } from './SongPicker'
import { CanvaPicker } from './CanvaPicker'

interface Handlers {
  onPickSong: (songId: string) => void
  onAddScripture: () => void
  onAddImage: () => void
  onAddVideo: () => void
  onAddDeck: () => void
  onAddCountdown: () => void
  onAddDivider: () => void
  /** Opens the Canva sub-view. Mirrors the "song" two-step interaction. */
  onOpenCanva: () => void
  /** Fired once a Canva design has been downloaded as a PDF. */
  onImportCanva: (result: CanvaImportResult, designId: string) => void
}

interface Props extends Handlers {
  songs: Song[]
  /** "inline" renders no chrome; "popover" wraps in an elevated panel. */
  mode: 'inline' | 'popover'
  /** Controls which sub-view is showing: the grid, the song sublist, or Canva. */
  view: 'grid' | 'song' | 'canva'
  setView: (view: 'grid' | 'song' | 'canva') => void
  /** Called when the user dismisses the picker (ESC, outside click). */
  onClose: () => void
}

interface KindCardSpec {
  kind:
    | 'song'
    | 'scripture'
    | 'image'
    | 'video'
    | 'deck'
    | 'countdown'
    | 'section-divider'
    | 'canva'
  hint: string
}

const KIND_CARDS: KindCardSpec[] = [
  { kind: 'song', hint: 'From your library' },
  { kind: 'scripture', hint: 'Look up a Bible verse' },
  { kind: 'image', hint: 'Full-screen photo' },
  { kind: 'video', hint: 'Plays with sound' },
  { kind: 'deck', hint: 'Import a PDF' },
  { kind: 'countdown', hint: 'Pre-service timer' },
  { kind: 'section-divider', hint: 'Grouping only' },
  { kind: 'canva', hint: 'From your Canva account' }
]

export function AddItemPicker(props: Props): JSX.Element {
  const {
    mode,
    view,
    setView,
    onClose,
    songs,
    onPickSong,
    onAddScripture,
    onAddImage,
    onAddVideo,
    onAddDeck,
    onAddCountdown,
    onAddDivider,
    onOpenCanva,
    onImportCanva
  } = props

  const rootRef = useRef<HTMLDivElement>(null)

  // ESC closes the picker — keyboard operators shouldn't have to chase
  // a close button with the mouse.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // In popover mode, clicking outside closes too. Inline mode has no
  // concept of "outside" — it's part of the page flow.
  useEffect(() => {
    if (mode !== 'popover') return
    const onDown = (e: MouseEvent): void => {
      const el = rootRef.current
      if (!el) return
      if (!el.contains(e.target as Node)) onClose()
    }
    // Defer by one tick so the click that OPENED the picker doesn't
    // immediately count as an outside click that closes it again.
    const t = setTimeout(() => {
      window.addEventListener('mousedown', onDown)
    }, 0)
    return () => {
      clearTimeout(t)
      window.removeEventListener('mousedown', onDown)
    }
  }, [mode, onClose])

  const handlePick = (kind: KindCardSpec['kind']): void => {
    switch (kind) {
      case 'song':
        setView('song')
        return
      case 'scripture':
        onAddScripture()
        return
      case 'image':
        onAddImage()
        return
      case 'video':
        onAddVideo()
        return
      case 'deck':
        onAddDeck()
        return
      case 'countdown':
        onAddCountdown()
        return
      case 'section-divider':
        onAddDivider()
        return
      case 'canva':
        onOpenCanva()
        return
    }
  }

  const grid = (
    <div className="grid grid-cols-3 gap-2">
      {KIND_CARDS.map((c) => (
        <button
          key={c.kind}
          onClick={() => handlePick(c.kind)}
          className="group flex flex-col items-start gap-1.5 rounded-lg border border-border/50 bg-background/40 p-3 text-left transition-all hover:-translate-y-0.5 hover:border-brand/50 hover:bg-card/80 hover:shadow-[0_6px_16px_-10px_hsl(var(--brand)/0.6)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted/50 text-muted-foreground transition-colors group-hover:bg-brand/15 group-hover:text-brand">
            <ItemKindIcon kind={c.kind} size={18} />
          </div>
          <div className="text-sm font-semibold text-foreground">
            {itemKindLabel(c.kind)}
          </div>
          <div className="text-[11px] leading-tight text-muted-foreground">
            {c.hint}
          </div>
        </button>
      ))}
    </div>
  )

  const body =
    view === 'song' ? (
      <div>
        <div className="mb-2 flex items-center justify-between">
          <button
            onClick={() => setView('grid')}
            className="text-[11px] text-muted-foreground hover:text-foreground"
          >
            ← Back
          </button>
          <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground/70">
            Pick a song
          </span>
        </div>
        <SongPicker
          songs={songs}
          onPick={(songId) => onPickSong(songId)}
          onClose={onClose}
        />
      </div>
    ) : view === 'canva' ? (
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
        <CanvaPicker onImported={onImportCanva} />
      </div>
    ) : (
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground/70">
            Add to setlist
          </span>
          {mode === 'popover' && (
            <button
              onClick={onClose}
              className="text-[11px] text-muted-foreground/70 hover:text-foreground"
              aria-label="Close"
            >
              ✕
            </button>
          )}
        </div>
        {grid}
      </div>
    )

  if (mode === 'inline') {
    return (
      <div ref={rootRef} className="w-full">
        {body}
      </div>
    )
  }

  return (
    <div
      ref={rootRef}
      className="w-[420px] rounded-xl border border-border/60 bg-popover/95 p-3 shadow-2xl backdrop-blur-md"
      role="dialog"
      aria-label="Add setlist item"
    >
      {body}
    </div>
  )
}
