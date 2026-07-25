/**
 * SongLibrary — the list view of every song on disk.
 *
 * Layout:
 *   PageHeader with search + New Song button in the actions slot.
 *   Body is a "table-lite" list — each row shows the song title, the
 *   author, metadata badges (language, CCLI, section count), and a
 *   last-updated relative time.
 *
 * Rows are divided by subtle borders rather than full card chrome so
 * the page scans like a hymnal index rather than a dashboard.
 */

import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { Song, SongLanguage } from '@shared/types'
import { useLibraryStore } from '../stores/useLibraryStore'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { PageHeader } from '../components/ui/PageHeader'
import { EmptyState } from '../components/ui/EmptyState'

const LANGUAGE_LABELS: Record<SongLanguage, string> = {
  en: 'EN',
  tl: 'TL',
  ceb: 'CEB',
  ilo: 'ILO',
  other: 'OTH'
}

export function SongLibrary(): JSX.Element {
  const navigate = useNavigate()
  const { songs, loading, error, load, create, remove } = useLibraryStore()
  const [query, setQuery] = useState('')

  useEffect(() => {
    load()
  }, [load])

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

  const handleDelete = async (id: string, title: string): Promise<void> => {
    const ok = window.confirm(`Delete "${title}"? This cannot be undone.`)
    if (!ok) return
    await remove(id)
  }

  return (
    <div className="flex h-screen w-screen flex-col bg-background text-foreground">
      <PageHeader
        eyebrow="Library"
        title="Songs"
        subtitle={
          songs.length > 0
            ? `${songs.length} song${songs.length === 1 ? '' : 's'} in your library`
            : 'Add the songs your team uses most often'
        }
        backTo="/"
        actions={
          <>
            <SearchInput value={query} onChange={setQuery} />
            <Button variant="signal" size="md" onClick={handleNew}>
              + New Song
            </Button>
          </>
        }
      />

      <main className="flex-1 overflow-y-auto px-8 py-6">
        <div className="mx-auto max-w-5xl">
          {loading && songs.length === 0 && (
            <p className="text-sm text-muted-foreground">Loading library…</p>
          )}

          {error && (
            <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              Failed to load library: {error}
            </p>
          )}

          {!loading && !error && songs.length === 0 && (
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
          )}

          {!loading &&
            !error &&
            songs.length > 0 &&
            filtered.length === 0 && (
              <EmptyState
                title={`No songs match "${query}"`}
                description="Try a different search, or clear the search to see all songs."
                cta={
                  <Button variant="secondary" size="sm" onClick={() => setQuery('')}>
                    Clear search
                  </Button>
                }
              />
            )}

          {filtered.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-border/50 bg-card/30">
              {/* Column headers — deliberately lowercase + spaced-out,
                  reads like a library catalog entry */}
              <div className="hidden grid-cols-[1fr_180px_140px_100px] items-center gap-4 border-b border-border/40 px-5 py-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground/70 md:grid">
                <div>Title</div>
                <div>Author</div>
                <div>Tags</div>
                <div className="text-right">Updated</div>
              </div>

              <ul className="divide-y divide-border/30">
                {filtered.map((song) => (
                  <SongRow
                    key={song.id}
                    song={song}
                    onDelete={() => handleDelete(song.id, song.title)}
                  />
                ))}
              </ul>
            </div>
          )}
        </div>
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
    <div className="relative">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search songs, authors, tags…"
        className="h-9 w-72 rounded-md border border-border/60 bg-background/60 pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground/60 outline-none transition-colors focus:border-brand/40 focus:bg-background"
      />
      <div className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
      </div>
    </div>
  )
}

// ─── Song row ─────────────────────────────────────────────────────────

function SongRow({
  song,
  onDelete
}: {
  song: Song
  onDelete: () => void
}): JSX.Element {
  return (
    <li className="group relative">
      <Link
        to={`/library/${song.id}`}
        className="grid grid-cols-1 items-center gap-3 px-5 py-4 transition-colors hover:bg-muted/30 md:grid-cols-[1fr_180px_140px_100px] md:gap-4"
      >
        {/* Title */}
        <div className="min-w-0">
          <div className="truncate font-semibold text-foreground">
            {song.title}
          </div>
          <div className="mt-0.5 truncate text-[11px] text-muted-foreground md:hidden">
            {song.author || 'Unknown author'} ·{' '}
            {song.sections.length} section
            {song.sections.length === 1 ? '' : 's'}
          </div>
        </div>

        {/* Author — desktop column */}
        <div className="hidden min-w-0 truncate text-sm text-muted-foreground md:block">
          {song.author || <span className="italic opacity-60">Unknown</span>}
        </div>

        {/* Tags — desktop column (language + CCLI + section count) */}
        <div className="hidden flex-wrap items-center gap-1 md:flex">
          <Badge tone="neutral">{LANGUAGE_LABELS[song.language]}</Badge>
          {song.ccli && (
            <Badge tone="neutral" title={`CCLI ${song.ccli}`}>
              CCLI
            </Badge>
          )}
          {song.sections.length > 0 && (
            <Badge tone="neutral">
              {song.sections.length}§
            </Badge>
          )}
        </div>

        {/* Updated — desktop column */}
        <div className="hidden text-right text-[11px] text-muted-foreground/80 md:block">
          {relativeTime(song.updatedAt)}
        </div>
      </Link>

      <button
        onClick={onDelete}
        className="absolute right-3 top-1/2 hidden -translate-y-1/2 rounded p-1 text-[11px] text-muted-foreground/60 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100 md:block"
        aria-label={`Delete ${song.title}`}
      >
        Delete
      </button>
    </li>
  )
}

// ─── Relative time helper ────────────────────────────────────────────
//
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
