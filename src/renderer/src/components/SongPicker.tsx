/**
 * SongPicker — the song-search sublist used inside the Setlist Editor's
 * add-item picker. Given the already-loaded library store, it lets the
 * user type to filter and pick a song; on selection it calls
 * `onPick(songId)` and the picker closes.
 *
 * Deliberately NOT a modal dialog: it renders inline inside whatever
 * container (Panel) the caller already opened — no floating position,
 * and no outside-click-to-close of its own (that lived here when this
 * was nested inside an absolutely-positioned popover; now it sits
 * inline in the page flow, and AddItemPicker's own ESC handling plus
 * the Panel's explicit ✕ are the only close affordances — an
 * independent outside-click listener here would race the "← Back"
 * button's own click, since mousedown fires before click and would
 * unmount this component out from under it).
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { Song } from '@shared/types'

interface SongPickerProps {
  songs: Song[]
  onPick: (songId: string) => void
}

export function SongPicker({ songs, onPick }: SongPickerProps): JSX.Element {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return songs
    return songs.filter((s) => {
      const title = s.title.toLowerCase()
      const author = (s.author ?? '').toLowerCase()
      return title.includes(q) || author.includes(q)
    })
  }, [songs, query])

  return (
    <div className="w-full">
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search songs…"
        className="w-full border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus:border-signal/50"
      />
      <ul className="mt-2 max-h-72 overflow-y-auto border border-border">
        {filtered.length === 0 && (
          <li className="px-3 py-2 text-[12px] text-muted-foreground">
            {songs.length === 0
              ? 'No songs in library yet.'
              : `No songs match "${query}".`}
          </li>
        )}
        {filtered.map((song) => (
          <li key={song.id} className="border-b border-rule last:border-b-0">
            <button
              type="button"
              onClick={() => onPick(song.id)}
              className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-panel-hi"
            >
              <span className="text-[13px] font-medium text-foreground">{song.title}</span>
              {song.author && (
                <span className="text-[11px] text-muted-foreground">{song.author}</span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
