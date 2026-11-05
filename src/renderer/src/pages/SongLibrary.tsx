/**
 * SongLibrary — the list view of every song on disk.
 *
 * Layout:
 *   PageHeader with search + New Song button in the actions slot, and a
 *   live song count underneath the title.
 *   Body is a sticky-header table — title, author, tag badges (language +
 *   section count), and last-updated. A fifth column binds to whichever
 *   setlist Home is spotlighting (`pickHero`) so operators can build next
 *   Sunday's setlist without leaving the library: click a row's cell to
 *   toggle that song's membership. When there is no setlist at all, the
 *   column — and its grid track — disappear entirely.
 *
 * Rows are divided by the inner hairline (`border-rule`) rather than full
 * card chrome so the page scans like a hymnal index rather than a
 * dashboard. `border-border`, the heavier line, is reserved for the
 * container edges (header bottom, page frame).
 */

import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { Setlist, SetlistItem, Song, SongLanguage } from '@shared/types'
import { useLibraryStore } from '../stores/useLibraryStore'
import { useSetlistStore } from '../stores/useSetlistStore'
import { formatServiceDate, pickHero } from '../lib/setlist-helpers'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { PageHeader } from '../components/ui/PageHeader'
import { EmptyState } from '../components/ui/EmptyState'
import { MonoLabel } from '../components/ui/MonoLabel'

const LANGUAGE_LABELS: Record<SongLanguage, string> = {
  en: 'EN',
  tl: 'TL',
  ceb: 'CEB',
  ilo: 'ILO',
  other: 'OTH'
}

// Grid templates for the song table. The trailing 130px track is the
// setlist-membership column — present only while `pickHero` resolves to
// a real setlist. Both literal strings need to stay intact in this file
// (not string-concatenated) so Tailwind's JIT scanner emits both
// grid-template-columns rules; only one is picked at runtime.
const GRID_WITH_SETLIST = 'grid-cols-[1fr_190px_150px_96px_130px]'
const GRID_WITHOUT_SETLIST = 'grid-cols-[1fr_190px_150px_96px]'

function genItemId(): string {
  return `item-${Math.random().toString(36).slice(2, 10)}`
}

export function SongLibrary(): JSX.Element {
  const navigate = useNavigate()
  const { songs, loading, error, load, create } = useLibraryStore()
  const { setlists, load: loadSetlists, update: updateSetlist } = useSetlistStore()
  const [query, setQuery] = useState('')

  useEffect(() => {
    load()
    loadSetlists()
  }, [load, loadSetlists])

  // Same setlist Home spotlights — today's service, else the next
  // upcoming one, else the most recent past one, else null.
  const heroSetlist = pickHero(setlists)
  const gridCols = heroSetlist ? GRID_WITH_SETLIST : GRID_WITHOUT_SETLIST

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return songs
    return songs.filter((s) => {
      const title = s.title.toLowerCase()
      const author = (s.author ?? '').toLowerCase()
      const cats = s.categories.join(' ').toLowerCase()
      return title.includes(q) || author.includes(q) || cats.includes(q)
    })
  }, [songs, query])

  const handleNew = async (): Promise<void> => {
    const created = await create({
      title: 'Untitled Song',
      rawText: ''
    })
    navigate(`/library/${created.id}`)
  }

  const handleToggleMembership = async (songId: string): Promise<void> => {
    if (!heroSetlist) return
    const isMember = heroSetlist.items.some((i) => i.kind === 'song' && i.songId === songId)
    const nextItems: SetlistItem[] = isMember
      ? heroSetlist.items.filter((i) => !(i.kind === 'song' && i.songId === songId))
      : [...heroSetlist.items, { kind: 'song', id: genItemId(), songId }]
    await updateSetlist(heroSetlist.id, { items: nextItems })
  }

  return (
    <div className="flex h-full w-full min-h-0 flex-col text-foreground">
      <PageHeader
        back={{ to: '/', label: 'HOME' }}
        eyebrow="LIBRARY"
        title="Songs"
        action={
          <>
            <SearchInput value={query} onChange={setQuery} />
            <Button variant="signal" size="md" onClick={handleNew}>
              + NEW SONG
            </Button>
          </>
        }
      >
        <MonoLabel size="xs" className="pb-5">
          {songs.length} IN LIBRARY
        </MonoLabel>
      </PageHeader>

      <main className="flex-1 overflow-y-auto">
        {loading && songs.length === 0 && (
          <p className="px-6 py-6 text-[13px] text-muted-foreground">Loading library…</p>
        )}

        {error && (
          <p className="mx-6 mt-6 border border-destructive/30 bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
            Failed to load library: {error}
          </p>
        )}

        {!loading && !error && songs.length === 0 && (
          <div className="px-6 py-6">
            <EmptyState
              icon="♪"
              title="No songs yet"
              description="Your song library is where every hymn, worship song, and chorus lives. Add one to get started."
              cta={
                <Button variant="signal" size="md" onClick={handleNew}>
                  + Add your first song
                </Button>
              }
            />
          </div>
        )}

        {!loading && !error && songs.length > 0 && filtered.length === 0 && (
          <div className="px-6 py-6">
            <EmptyState
              title={`No songs match "${query}"`}
              description="Try a different search, or clear the search to see all songs."
              cta={
                <Button variant="outline" size="sm" onClick={() => setQuery('')}>
                  Clear search
                </Button>
              }
            />
          </div>
        )}

        {filtered.length > 0 && (
          <>
            {/* Sticky column-header row */}
            <div
              className={`sticky top-0 z-10 grid ${gridCols} items-center gap-4 border-b border-border bg-card px-6 py-[11px]`}
            >
              <MonoLabel size="xs">TITLE</MonoLabel>
              <MonoLabel size="xs">AUTHOR</MonoLabel>
              <MonoLabel size="xs">TAGS</MonoLabel>
              <MonoLabel size="xs" className="text-right">
                UPDATED
              </MonoLabel>
              {heroSetlist && (
                <MonoLabel size="xs" tone="signal" className="text-right">
                  {formatSetlistHeaderDate(heroSetlist.date)}
                </MonoLabel>
              )}
            </div>

            <ul>
              {filtered.map((song) => (
                <SongRow
                  key={song.id}
                  song={song}
                  gridCols={gridCols}
                  heroSetlist={heroSetlist}
                  onToggleMembership={() => handleToggleMembership(song.id)}
                />
              ))}
            </ul>
          </>
        )}
      </main>
    </div>
  )
}

// ─── Search input ─────────────────────────────────────────────────────

function SearchInput({
  value,
  onChange
}: {
  value: string
  onChange: (v: string) => void
}): JSX.Element {
  return (
    <div className="flex h-[38px] w-[280px] items-center gap-[9px] border border-border px-3">
      <svg
        width="13"
        height="13"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className="shrink-0 text-muted-foreground"
        aria-hidden="true"
      >
        <circle cx="7" cy="7" r="4.5" />
        <path d="M10.5 10.5L14 14" />
      </svg>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search title, author, tag…"
        className="w-full bg-transparent text-[12.5px] text-foreground outline-none placeholder:text-muted-foreground"
      />
    </div>
  )
}

// ─── Song row ─────────────────────────────────────────────────────────

function SongRow({
  song,
  gridCols,
  heroSetlist,
  onToggleMembership
}: {
  song: Song
  gridCols: string
  heroSetlist: Setlist | null
  onToggleMembership: () => void
}): JSX.Element {
  const isMember =
    heroSetlist?.items.some((i) => i.kind === 'song' && i.songId === song.id) ?? false

  // The setlist-membership toggle must be a real <button> for keyboard/
  // screen-reader access, and a <button> cannot nest inside the <Link>'s
  // <a> (invalid HTML, and the reason the old span-with-onClick had no
  // keyboard path at all). So the <li> — not the Link — owns the row
  // grid: the Link spans the first four tracks as one item (col-span-4)
  // with its own identical inner grid (GRID_WITHOUT_SETLIST, same gap),
  // which lines its four cells up with the outer header's four columns
  // exactly, byte-for-byte the same template. The toggle button is a
  // sibling grid item in the fifth track. Mirrors Home.tsx's setlist
  // cell, where the delete button is a sibling of the Link, not nested
  // inside it.
  return (
    <li
      className={`grid ${gridCols} items-center gap-4 border-b border-rule px-6 py-3.5 hover:bg-panel-hi`}
    >
      <Link
        to={`/library/${song.id}`}
        className={`col-span-4 grid ${GRID_WITHOUT_SETLIST} items-center gap-4`}
      >
        <span className="min-w-0 truncate text-[14.5px] font-semibold tracking-[-0.01em] text-foreground">
          {song.title}
        </span>

        <span className="min-w-0 truncate text-[13px] text-soft">
          {song.author || <span className="italic opacity-60">Unknown</span>}
        </span>

        <span className="flex items-center gap-[5px]">
          <Badge tone="signal">{LANGUAGE_LABELS[song.language]}</Badge>
          <Badge tone="neutral">{song.sections.length}§</Badge>
        </span>

        <span className="text-right font-mono text-[10px] tracking-[0.06em] text-muted-foreground">
          {relativeTime(song.updatedAt)}
        </span>
      </Link>

      {heroSetlist && (
        <button
          type="button"
          onClick={onToggleMembership}
          aria-label={
            isMember
              ? `Remove "${song.title}" from ${formatServiceDate(heroSetlist.date)}`
              : `Add "${song.title}" to ${formatServiceDate(heroSetlist.date)}`
          }
          className="border-0 bg-transparent p-0 text-right focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-signal"
        >
          {isMember ? (
            <Badge tone="signal" className="cursor-pointer">
              IN SETLIST
            </Badge>
          ) : (
            <span className="inline-flex cursor-pointer items-center gap-1 border border-dim/50 px-1.5 py-[3px] font-mono text-[8.5px] font-semibold uppercase leading-none tracking-[0.08em] text-dim hover:border-dim hover:text-soft">
              + ADD
            </span>
          )}
        </button>
      )}
    </li>
  )
}

// ─── Formatting helpers ────────────────────────────────────────────────

/** "SUN APR 19" — the setlist-membership column header. */
function formatSetlistHeaderDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return date
    .toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
    .toUpperCase()
    .replace(',', '')
}

// Tiny inline formatter — avoids pulling in Intl.RelativeTimeFormat
// ceremony for a handful of buckets. "Just now / 5m / 2h / 3d / Apr 3"
// is the whole vocabulary we need.
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return ''
  const diffMs = Date.now() - then
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  // Older than a week → show month + day
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric'
  })
}
