/**
 * AddItemPicker — the body of "which kind of item do I want to add to
 * the setlist?". Renders as a 4-column grid of the item kinds (glyph,
 * label, hint), or — mid-flow — the song search sublist.
 *
 * This component owns ONLY the grid/sublist content. The chrome around
 * it (the Panel with "Insert at position N" / "Add to the end" / "Add
 * your first item" header and the close button) is built by
 * the caller (SetlistEditor), because that header's text depends on
 * WHERE the picker was opened — something this component doesn't know.
 *
 * Picking a kind fires the matching `on...` handler. For kinds that
 * need a native file picker (image, video, pdf), those handlers go
 * async in the parent; the picker doesn't concern itself with that —
 * it just fires the callback and relies on the parent to close it.
 *
 * Song is a two-step interaction: clicking "Song" swaps the grid for
 * the existing SongPicker rather than adding blank. That prevents
 * orphan empty-song items — every song in the setlist is guaranteed
 * to point at a real library entry.
 */

import { useEffect, type ReactNode } from 'react'
import type { Song } from '@shared/types'
import type { CanvaImportResult } from '@shared/canva'
import { FEATURES } from '@shared/features'
import { ItemKindIcon, itemKindLabel } from './ItemKindIcon'
import { SongPicker } from './SongPicker'
import { CanvaPicker } from './CanvaPicker'
import { Button } from './ui/Button'
import { ChevronLeftIcon } from './icons'

interface Handlers {
  onPickSong: (songId: string) => void
  onAddScripture: () => void
  onAddImage: () => void
  onAddVideo: () => void
  onAddDeck: () => void
  onAddPptx: () => void
  onAddCountdown: () => void
  onAddDivider: () => void
  /** Opens the Canva sub-view. Mirrors the "song" two-step interaction. */
  onOpenCanva: () => void
  /** Fired once a Canva design has been downloaded as a PDF. */
  onImportCanva: (result: CanvaImportResult, designId: string) => void
}

interface Props extends Handlers {
  songs: Song[]
  /** Controls which sub-view is showing: the grid, the song sublist, or Canva. */
  view: 'grid' | 'song' | 'canva'
  setView: (view: 'grid' | 'song' | 'canva') => void
  /** Called when the user dismisses the picker (ESC). */
  onClose: () => void
}

interface KindCardSpec {
  /**
   * Includes 'canva', which is an import *source* rather than an item kind
   * — a Canva import lands as a `deck`. It sits in the same grid because
   * that is where an operator looks for "get content into the setlist".
   */
  kind:
    | 'song'
    | 'scripture'
    | 'image'
    | 'video'
    | 'deck'
    | 'pptx'
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
  { kind: 'pptx', hint: 'Import PowerPoint' },
  { kind: 'countdown', hint: 'Pre-service timer' },
  { kind: 'section-divider', hint: 'Grouping only' },
  // Canva is hidden behind a feature flag for now (see shared/features.ts).
  ...(FEATURES.canva ? [{ kind: 'canva' as const, hint: 'From your Canva account' }] : [])
]

export function AddItemPicker(props: Props): JSX.Element {
  const {
    view,
    setView,
    onClose,
    songs,
    onPickSong,
    onAddScripture,
    onAddImage,
    onAddVideo,
    onAddDeck,
    onAddPptx,
    onAddCountdown,
    onAddDivider,
    onOpenCanva,
    onImportCanva
  } = props

  // ESC closes the picker — keyboard operators shouldn't have to chase
  // a close button with the mouse.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

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
      case 'pptx':
        onAddPptx()
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

  if (view === 'song') {
    return (
      <div>
        <SubViewHeader title="Pick a song" onBack={() => setView('grid')} />
        <div className="p-3">
          <SongPicker songs={songs} onPick={onPickSong} />
        </div>
      </div>
    )
  }

  // `&& FEATURES.canva` so a stale 'canva' view can't open the picker
  // while the feature is hidden.
  if (view === 'canva' && FEATURES.canva) {
    return (
      <div>
        <SubViewHeader title="Import from Canva" onBack={() => setView('grid')} />
        <div className="p-3">
          <CanvaPicker onImported={onImportCanva} />
        </div>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-4 gap-1 p-2">
      {KIND_CARDS.map((c) => (
        <button
          key={c.kind}
          type="button"
          onClick={() => handlePick(c.kind)}
          className="group flex items-start gap-3 rounded-lg p-3 text-left transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
        >
          <span className="flex h-9 w-9 flex-none items-center justify-center rounded-md bg-hover text-soft transition-colors group-hover:bg-selected group-hover:text-foreground">
            <ItemKindIcon kind={c.kind} size={18} />
          </span>
          <span className="min-w-0">
            <span className="block text-[14px] font-medium text-foreground">
              {itemKindLabel(c.kind)}
            </span>
            <span className="block text-[13px] text-muted-foreground">{c.hint}</span>
          </span>
        </button>
      ))}
    </div>
  )
}

/** "← Back" + title strip for the song and Canva sub-views. */
function SubViewHeader({ title, onBack }: { title: ReactNode; onBack: () => void }): JSX.Element {
  return (
    <div className="flex items-center gap-2 border-b border-rule px-2 py-2">
      <Button variant="ghost" size="sm" onClick={onBack} className="px-2">
        <ChevronLeftIcon size={15} />
        Back
      </Button>
      <span className="text-[13px] font-medium text-quiet">{title}</span>
    </div>
  )
}
