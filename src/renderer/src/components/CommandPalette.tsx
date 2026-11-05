/**
 * CommandPalette — ⌘K / Ctrl+K quick search over songs (title, author,
 * tags, lyrics), setlists and a few actions. Mounted by AppShell, so it
 * is never available in Service Mode, where the keyboard drives slides.
 *
 * Keyboard: ↑/↓ move, Enter opens, Esc closes. The input stays focused
 * the whole time (combobox pattern with aria-activedescendant), so
 * typing never stops working while the selection moves.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { searchCommands, type CommandResult } from '../lib/commandSearch'
import { cn } from '../lib/utils'
import { useLibraryStore } from '../stores/useLibraryStore'
import { useSetlistStore } from '../stores/useSetlistStore'
import { CalendarIcon, HomeIcon, MusicIcon, PlusIcon, SearchIcon, SettingsIcon } from './icons'

export const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent)
export const PALETTE_SHORTCUT = isMac ? '⌘K' : 'Ctrl K'

export function CommandPalette({
  open,
  onClose,
  onNewSetlist
}: {
  open: boolean
  onClose: () => void
  onNewSetlist: () => void
}): JSX.Element | null {
  const navigate = useNavigate()
  const songs = useLibraryStore((s) => s.songs)
  const songsLoaded = useLibraryStore((s) => s.loaded)
  const loadSongs = useLibraryStore((s) => s.load)
  const createSong = useLibraryStore((s) => s.create)
  const setlists = useSetlistStore((s) => s.setlists)

  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Fresh state each time it opens; give focus back to where it was.
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    setQuery('')
    setActive(0)
    requestAnimationFrame(() => inputRef.current?.focus())
    return () => previous?.focus?.()
  }, [open])

  // Separate from the effect above: songs finishing loading must not
  // reset what the operator has already typed.
  useEffect(() => {
    if (open && !songsLoaded) void loadSongs()
  }, [open, songsLoaded, loadSongs])

  const results = useMemo(
    () => (open ? searchCommands(query, songs, setlists) : []),
    [open, query, songs, setlists]
  )

  useEffect(() => setActive(0), [query])

  // Keep the highlighted row in view.
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [active])

  if (!open) return null

  const run = async (r: CommandResult): Promise<void> => {
    onClose()
    if ('to' in r.target) {
      navigate(r.target.to)
    } else if (r.target.action === 'new-setlist') {
      onNewSetlist()
    } else {
      const created = await createSong({ title: 'Untitled Song', rawText: '' })
      navigate(`/library/${created.id}`)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (results.length ? (i + 1) % results.length : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (results.length ? (i - 1 + results.length) % results.length : 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const r = results[active]
      if (r) void run(r)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'Tab') {
      // Nothing else in the dialog to tab to; keep focus in the input.
      e.preventDefault()
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/55 px-4 pt-[14vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Quick search"
        className="flex max-h-[60vh] w-full max-w-[580px] flex-col overflow-hidden rounded-xl border border-border bg-raised shadow-2xl shadow-black/50"
      >
        <div className="flex items-center gap-3 border-b border-rule px-4">
          <SearchIcon size={18} className="shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search songs, lyrics, setlists…"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-results"
            aria-activedescendant={results[active] ? `palette-${results[active].id}` : undefined}
            aria-autocomplete="list"
            className="h-12 min-w-0 flex-1 bg-transparent text-[15px] text-foreground placeholder:text-dim focus:outline-none"
          />
          <kbd className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">
            Esc
          </kbd>
        </div>

        <div ref={listRef} id="palette-results" role="listbox" className="scroll-hairline overflow-y-auto p-1.5">
          {results.length === 0 && (
            <p className="px-3 py-8 text-center text-[13px] text-muted-foreground">
              Nothing matches “{query.trim()}”.
            </p>
          )}
          {results.map((r, i) => (
            <div key={r.id}>
              {(i === 0 || results[i - 1].group !== r.group) && (
                <div
                  role="presentation"
                  className="px-2.5 pb-1 pt-2.5 text-[12px] font-medium text-muted-foreground"
                >
                  {r.group}
                </div>
              )}
              <div
                id={`palette-${r.id}`}
                data-index={i}
                role="option"
                aria-selected={i === active}
                onMouseMove={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault() /* keep input focus */}
                onClick={() => void run(r)}
                className={cn(
                  'flex h-10 cursor-default items-center gap-3 rounded-md px-2.5',
                  i === active ? 'bg-selected text-foreground' : 'text-bone'
                )}
              >
                <ResultIcon result={r} />
                <span className="min-w-0 shrink truncate text-[14px]">{r.title}</span>
                {r.subtitle && (
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted-foreground">
                    {r.subtitle}
                  </span>
                )}
                {i === active && (
                  <span className="ml-auto shrink-0 text-[12px] text-muted-foreground">↵</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function ResultIcon({ result }: { result: CommandResult }): JSX.Element {
  const cls = 'shrink-0 text-muted-foreground'
  if (result.group === 'Songs') return <MusicIcon size={16} className={cls} />
  if (result.group === 'Setlists') return <CalendarIcon size={16} className={cls} />
  if ('action' in result.target) return <PlusIcon size={16} className={cls} />
  if (result.target.to === '/settings') return <SettingsIcon size={16} className={cls} />
  if (result.target.to === '/library') return <MusicIcon size={16} className={cls} />
  if (result.target.to === '/') return <HomeIcon size={16} className={cls} />
  return <SearchIcon size={16} className={cls} />
}
