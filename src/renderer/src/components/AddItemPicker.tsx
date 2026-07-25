/**
 * AddItemPicker — the body of "which kind of item do I want to add to
 * the setlist?". Renders as a 4-column hairline grid of the seven item
 * kinds (design L431-439), or — mid-flow — the song search sublist.
 *
 * This component owns ONLY the grid/sublist content. The chrome around
 * it (the signal-bordered Panel with "INSERT AT POSITION N" / "ADD TO
 * THE END" / "ADD YOUR FIRST ITEM" header and the close ✕) is built by
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

import { useEffect } from 'react'
import type { Song } from '@shared/types'
import { itemKindCode, itemKindLabel } from './ItemKindIcon'
import { SongPicker } from './SongPicker'
import { Badge } from './ui/Badge'
import { MonoLabel } from './ui/MonoLabel'
import { HairlineGrid } from './ui/HairlineGrid'

interface Handlers {
  onPickSong: (songId: string) => void
  onAddScripture: () => void
  onAddImage: () => void
  onAddVideo: () => void
  onAddDeck: () => void
  onAddCountdown: () => void
  onAddDivider: () => void
}

interface Props extends Handlers {
  songs: Song[]
  /** Controls which sub-view is showing: the grid or the song sublist. */
  view: 'grid' | 'song'
  setView: (view: 'grid' | 'song') => void
  /** Called when the user dismisses the picker (ESC). */
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
  hint: string
}

const KIND_CARDS: KindCardSpec[] = [
  { kind: 'song', hint: 'From your library' },
  { kind: 'scripture', hint: 'Look up a Bible verse' },
  { kind: 'image', hint: 'Full-screen photo' },
  { kind: 'video', hint: 'Plays with sound' },
  { kind: 'deck', hint: 'Import a PDF' },
  { kind: 'countdown', hint: 'Pre-service timer' },
  { kind: 'section-divider', hint: 'Grouping only' }
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
    onAddCountdown,
    onAddDivider
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
      case 'countdown':
        onAddCountdown()
        return
      case 'section-divider':
        onAddDivider()
        return
    }
  }

  if (view === 'song') {
    return (
      <div>
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <button
            type="button"
            onClick={() => setView('grid')}
            className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground hover:text-white"
          >
            ← BACK
          </button>
          <MonoLabel tone="dim">PICK A SONG</MonoLabel>
        </div>
        <div className="p-3">
          <SongPicker songs={songs} onPick={onPickSong} />
        </div>
      </div>
    )
  }

  return (
    <HairlineGrid cols={4}>
      {KIND_CARDS.map((c) => (
        <button
          key={c.kind}
          type="button"
          onClick={() => handlePick(c.kind)}
          className="flex flex-col items-start p-[15px] text-left transition-colors hover:bg-panel-hi focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-signal"
        >
          <Badge tone="signal" className="mb-[9px]">
            {itemKindCode(c.kind)}
          </Badge>
          <span className="mb-[3px] text-[13px] font-bold text-foreground">
            {itemKindLabel(c.kind)}
          </span>
          <span className="text-[11px] text-muted-foreground">{c.hint}</span>
        </button>
      ))}
    </HairlineGrid>
  )
}
