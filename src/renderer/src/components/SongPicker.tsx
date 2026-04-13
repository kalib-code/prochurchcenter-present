/**
 * SongPicker — a small inline dropdown used inside the Setlist Editor's
 * "+ Add Song" action. Given the already-loaded library store, it lets
 * the user type to filter and pick a song; on selection it calls
 * `onPick(songId)` and the picker closes.
 *
 * Deliberately NOT a modal dialog: it's a <div> anchored under the "Add"
 * button. Modals pull focus hard and feel heavy for something this
 * frequent. If we ever need multi-select or bulk add, revisit.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { Song } from '@shared/types'

interface SongPickerProps {
  songs: Song[]
  onPick: (songId: string) => void
  onClose: () => void
}

export function SongPicker({ songs, onPick, onClose }: SongPickerProps): JSX.Element {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent): void => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        onClose()
      }
    }
    // Defer one tick so the opening click doesn't immediately close us
    const id = setTimeout(() => document.addEventListener('mousedown', handler), 0)
    return () => {
      clearTimeout(id)
      document.removeEventListener('mousedown', handler)
    }
  }, [onClose])

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

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
    <div
      ref={containerRef}
      className="absolute left-0 top-full z-20 mt-1 w-80 rounded-md border border-border/60 bg-background shadow-lg"
    >
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search songs…"
        className="w-full border-b border-border/40 bg-transparent px-3 py-2 text-sm outline-none"
      />
      <ul className="max-h-72 overflow-y-auto py-1">
        {filtered.length === 0 && (
          <li className="px-3 py-2 text-xs text-muted-foreground">
            {songs.length === 0
              ? 'No songs in library yet.'
              : `No songs match "${query}".`}
          </li>
        )}
        {filtered.map((song) => (
          <li key={song.id}>
            <button
              onClick={() => onPick(song.id)}
              className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-muted"
            >
              <span className="text-sm font-medium">{song.title}</span>
              {song.author && (
                <span className="text-xs text-muted-foreground">{song.author}</span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
