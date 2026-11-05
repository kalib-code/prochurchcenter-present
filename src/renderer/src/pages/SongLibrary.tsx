/**
 * SongLibrary — the list view of every song on disk.
 *
 * Layout:
 *   PageHeader "Songs" with the song count as its description, and the
 *   search field + primary New song button in the actions slot. (No
 *   "← Home" link: the AppShell sidebar owns navigation.)
 *   Body is a sticky-header table — title, author, tag badges (language +
 *   categories, all neutral), and last-updated. A fifth column binds to
 *   whichever setlist Home is spotlighting (`pickHero`) so operators can
 *   build next Sunday's setlist without leaving the library: an
 *   "Add to {setlist}" ghost action appears on row hover, and songs
 *   already in it show an `ok` "In setlist" badge (click to remove). When
 *   there is no setlist at all, the column — and its grid track —
 *   disappear entirely.
 *
 * Rows are rounded and get a hover background rather than hairlines, so
 * the page scans like a music library rather than a spreadsheet.
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
import { Input } from '../components/ui/Input'
import { MonoLabel } from '../components/ui/MonoLabel'
import { CheckIcon, MusicIcon, PlusIcon, SearchIcon } from '../components/icons'

const LANGUAGE_LABELS: Record<SongLanguage, string> = {
  en: 'English',
  tl: 'Tagalog',
  ceb: 'Cebuano',
  ilo: 'Ilocano',
  other: 'Other'
}

// Grid templates for the song table. The trailing 180px track is the
// setlist-membership column — present only while `pickHero` resolves to
// a real setlist. Both literal strings need to stay intact in this file
// (not string-concatenated) so Tailwind's JIT scanner emits both
// grid-template-columns rules; only one is picked at runtime.
const GRID_WITH_SETLIST = 'grid-cols-[minmax(0,1fr)_200px_220px_92px_180px]'
const GRID_WITHOUT_SETLIST = 'grid-cols-[minmax(0,1fr)_200px_220px_92px]'

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
        title="Songs"
        description={
          songs.length > 0 ? `${songs.length} song${songs.length === 1 ? '' : 's'} in your library` : undefined
        }
        action={
          <>
            <SearchInput value={query} onChange={setQuery} />
            <Button variant="primary" size="md" onClick={handleNew}>
              <PlusIcon size={16} />
              New song
            </Button>
          </>
        }
      />

      <main className="scroll-hairline flex-1 overflow-y-auto px-5 pb-10">
        {loading && songs.length === 0 && (
          <p className="px-3 py-4 text-[13px] text-muted-foreground">Loading library…</p>
        )}

        {error && (
          <p
            role="alert"
            className="mx-3 mt-2 rounded-lg bg-live/10 px-3.5 py-2.5 text-[13px] text-live ring-1 ring-inset ring-live/25"
          >
            Couldn&apos;t load the library: {error}
          </p>
        )}

        {!loading && !error && songs.length === 0 && (
          <div className="px-3 pt-2">
            <EmptyState
              icon={<MusicIcon size={30} />}
              title="No songs yet"
              description="Your song library is where every hymn, worship song and chorus lives. Add one to get started."
              cta={
                <Button variant="primary" size="md" onClick={handleNew}>
                  <PlusIcon size={16} />
                  New song
                </Button>
              }
            />
          </div>
        )}

        {!loading && !error && songs.length > 0 && filtered.length === 0 && (
          <div className="px-3 pt-2">
            <EmptyState
              icon={<SearchIcon size={30} />}
              title={`No songs match "${query}"`}
              description="Try a different search, or clear it to see every song."
              cta={
                <Button variant="secondary" size="sm" onClick={() => setQuery('')}>
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
              className={`sticky top-0 z-10 grid ${gridCols} items-center gap-4 border-b border-rule bg-panel px-3 pb-2.5 pt-1`}
            >
              <MonoLabel>Title</MonoLabel>
              <MonoLabel>Author</MonoLabel>
              <MonoLabel>Tags</MonoLabel>
              <MonoLabel className="text-right">Updated</MonoLabel>
              {heroSetlist && (
                <MonoLabel className="truncate text-right" title={heroSetlist.name}>
                  {formatSetlistHeaderDate(heroSetlist.date)}
                </MonoLabel>
              )}
            </div>

            <ul className="flex flex-col gap-px pt-1.5">
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
    <div className="relative w-[280px]">
      <SearchIcon
        size={16}
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search title, author, tag…"
        aria-label="Search songs"
        className="pl-9"
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
  const shownTags = song.categories.slice(0, 2)
  const moreTags = song.categories.length - shownTags.length

  // The setlist-membership toggle must be a real <button> for keyboard/
  // screen-reader access, and a <button> cannot nest inside the <Link>'s
  // <a> (invalid HTML). So the <li> — not the Link — owns the row grid:
  // the Link spans the first four tracks as one item (col-span-4) with
  // its own identical inner grid (GRID_WITHOUT_SETLIST, same gap), which
  // lines its four cells up with the header's four columns exactly. The
  // toggle button is a sibling grid item in the fifth track. Mirrors
  // Home's setlist card, where delete is a sibling of the Link.
  return (
    <li
      className={`group grid ${gridCols} min-h-[52px] items-center gap-4 rounded-lg px-3 transition-colors hover:bg-hover focus-within:bg-hover`}
    >
      <Link
        to={`/library/${song.id}`}
        className={`col-span-4 grid ${GRID_WITHOUT_SETLIST} -mx-3 items-center gap-4 self-stretch rounded-lg px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/70`}
      >
        <span className="min-w-0 truncate text-[14px] font-medium text-foreground">
          {song.title}
        </span>

        <span className="min-w-0 truncate text-[13.5px] text-soft">
          {song.author || <span className="text-muted-foreground">Unknown</span>}
        </span>

        <span className="flex min-w-0 items-center gap-1 overflow-hidden">
          <Badge tone="neutral" className="shrink-0">
            {LANGUAGE_LABELS[song.language]}
          </Badge>
          {shownTags.map((tag) => (
            <Badge key={tag} tone="neutral" className="min-w-0 truncate">
              {tag}
            </Badge>
          ))}
          {moreTags > 0 && (
            <span className="shrink-0 text-[12px] text-muted-foreground">+{moreTags}</span>
          )}
          {song.sections.length === 0 && (
            <span className="shrink-0 text-[12px] text-muted-foreground">No lyrics</span>
          )}
        </span>

        <span className="text-right text-[13px] tabular-nums text-muted-foreground">
          {relativeTime(song.updatedAt)}
        </span>
      </Link>

      {heroSetlist && (
        <div className="flex min-w-0 justify-end">
          <button
            type="button"
            onClick={onToggleMembership}
            aria-label={
              isMember
                ? `Remove "${song.title}" from ${formatServiceDate(heroSetlist.date)}`
                : `Add "${song.title}" to ${formatServiceDate(heroSetlist.date)}`
            }
            title={isMember ? 'In setlist — click to remove' : undefined}
            className={
              isMember
                ? 'rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70'
                : 'inline-flex h-8 min-w-0 max-w-full items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium text-soft opacity-0 transition hover:bg-raised hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 group-hover:opacity-100'
            }
          >
            {isMember ? (
              <Badge tone="ok" className="cursor-pointer py-1">
                <CheckIcon size={12} strokeWidth={2.25} />
                In setlist
              </Badge>
            ) : (
              <>
                <PlusIcon size={14} className="shrink-0" />
                <span className="truncate">Add to {heroSetlist.name || 'setlist'}</span>
              </>
            )}
          </button>
        </div>
      )}
    </li>
  )
}

// ─── Formatting helpers ────────────────────────────────────────────────

/** "Sun, Apr 19" — the setlist-membership column header. */
function formatSetlistHeaderDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

// Tiny inline formatter — avoids pulling in Intl.RelativeTimeFormat
// ceremony for a handful of buckets. "Just now / 5m / 2h / 3d / Apr 3"
// is the whole vocabulary we need.
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return ''
  const diffMs = Date.now() - then
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 1) return 'Just now'
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
