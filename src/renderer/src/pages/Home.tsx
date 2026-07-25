/**
 * Home — the first screen Ate Rose sees when she opens Present.
 *
 * Two-pane hero layout:
 *   - Left pane  : today-or-next headline, date, item count, CTAs
 *   - Right pane : a compact preview of the first few items in that
 *                  setlist so the operator can see AT A GLANCE what
 *                  the service looks like without opening it. This
 *                  was the single biggest weakness of the previous
 *                  layout — the hero had lots of empty space and
 *                  gave zero context about contents.
 *
 * Header keeps nav + a permanent "+ New Setlist" button so creating a
 * fresh service never requires scrolling or hunting for a CTA.
 *
 * Other setlists render as cards. Each card shows a date "tile", the
 * name, and a condensed item-kind row (icon chips) so recent setlists
 * don't all look identical — the visual weight of "song song scripture
 * deck" vs "countdown video scripture" is different.
 */

import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { Setlist, SetlistItem, Song } from '@shared/types'
import { useSetlistStore } from '../stores/useSetlistStore'
import { useLibraryStore } from '../stores/useLibraryStore'
import {
  formatServiceDate,
  isToday,
  nextSundayISO,
  suggestCloneDefaults
} from '../lib/setlist-helpers'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { EmptyState } from '../components/ui/EmptyState'
import { ItemKindIcon, itemKindLabel } from '../components/ItemKindIcon'

export function Home(): JSX.Element {
  const navigate = useNavigate()
  const { setlists, loading, error, load, create, remove, clone } = useSetlistStore()
  const { songs, load: loadSongs } = useLibraryStore()
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    load()
    // Lazy-load the song library so hero + card previews can resolve
    // song titles. Cheap and cached by the store.
    if (songs.length === 0) loadSongs()
  }, [load, loadSongs, songs.length])

  const songsById = useMemo(() => {
    const m = new Map<string, Song>()
    for (const s of songs) m.set(s.id, s)
    return m
  }, [songs])

  const heroSetlist = pickHero(setlists)
  const otherSetlists = setlists.filter((s) => s.id !== heroSetlist?.id)

  const handleNew = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      const created = await create({
        name: 'New Service',
        date: nextSundayISO()
      })
      navigate(`/setlists/${created.id}`)
    } finally {
      setBusy(false)
    }
  }

  const handleCloneLast = async (): Promise<void> => {
    if (busy) return
    const source = setlists[0]
    if (!source) return
    setBusy(true)
    try {
      const defaults = suggestCloneDefaults(source)
      const created = await clone(source.id, defaults.name, defaults.date)
      navigate(`/setlists/${created.id}`)
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async (id: string, name: string): Promise<void> => {
    const ok = window.confirm(`Delete "${name}"?`)
    if (!ok) return
    await remove(id)
  }

  return (
    <div className="flex h-screen w-screen flex-col bg-background text-foreground">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between border-b border-border/40 px-10 py-5">
        <div className="flex items-baseline gap-3">
          <h1 className="font-editorial text-2xl font-semibold tracking-tight text-foreground">
            Present
          </h1>
          <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-brand/70">
            ProChurchCenter
          </span>
        </div>
        <nav className="flex items-center gap-1.5">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/library">Song Library</Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/settings">Settings</Link>
          </Button>
          <div className="mx-2 h-5 w-px bg-border/60" />
          <Button variant="signal" size="sm" onClick={handleNew} disabled={busy}>
            + New Setlist
          </Button>
        </nav>
      </header>

      {/* ── Body ───────────────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto px-10 py-10">
        <div className="mx-auto max-w-6xl">
          {loading && !heroSetlist && (
            <p className="text-sm text-muted-foreground">Loading setlists…</p>
          )}
          {error && (
            <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              Failed to load: {error}
            </p>
          )}

          {/* Hero: today/upcoming setlist */}
          {heroSetlist && (
            <HeroSetlist
              setlist={heroSetlist}
              songsById={songsById}
              onDelete={() => handleDelete(heroSetlist.id, heroSetlist.name)}
              onCloneLast={handleCloneLast}
              canCloneLast={setlists.length > 0}
              busy={busy}
            />
          )}

          {/* Other setlists */}
          <section className="mt-12">
            <div className="mb-4 flex items-baseline justify-between">
              <h2 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                {heroSetlist ? 'Other setlists' : 'Setlists'}
              </h2>
              {otherSetlists.length > 0 && (
                <span className="text-xs text-muted-foreground/70">
                  {otherSetlists.length} total
                </span>
              )}
            </div>

            {otherSetlists.length === 0 && !heroSetlist && !loading && (
              <EmptyState
                icon="✦"
                title="No setlists yet"
                description="Plan your first service to see it here. You'll be able to add songs, scripture, PDFs, and videos."
                cta={
                  <Button variant="signal" size="md" onClick={handleNew}>
                    + Create your first setlist
                  </Button>
                }
              />
            )}

            {otherSetlists.length > 0 && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {otherSetlists.map((s) => (
                  <SetlistCard
                    key={s.id}
                    setlist={s}
                    onDelete={() => handleDelete(s.id, s.name)}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  )
}

// ─── Hero setlist ─────────────────────────────────────────────────────

function HeroSetlist({
  setlist,
  songsById,
  onDelete,
  onCloneLast,
  canCloneLast,
  busy
}: {
  setlist: Setlist
  songsById: Map<string, Song>
  onDelete: () => void
  onCloneLast: () => void
  canCloneLast: boolean
  busy: boolean
}): JSX.Element {
  const today = isToday(setlist)
  const eyebrow = today ? 'Today · Live service' : 'Next up'
  const itemCount = setlist.items.length
  // Show up to 4 items in the preview panel; the rest collapse into
  // a "+N more" footer so the hero never grows unpredictably long.
  const previewItems = setlist.items.slice(0, 4)
  const hiddenCount = Math.max(0, setlist.items.length - previewItems.length)

  return (
    <section className="relative overflow-hidden rounded-2xl border border-border/50 bg-gradient-to-br from-card/80 via-card/40 to-background shadow-[0_24px_80px_-40px_hsl(var(--brand)/0.45)]">
      {/* Subtle brand glow corners — stayed because they give the hero
          a distinct "this is the star of the page" silhouette. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-brand/10 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-32 -left-20 h-80 w-80 rounded-full bg-brand/5 blur-3xl"
      />

      <div className="relative grid grid-cols-1 gap-8 p-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:gap-10">
        {/* ── Left: headline + CTAs ─────────────────────────────── */}
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-brand">
              {eyebrow}
            </div>
            {today && <Badge tone="signal">Today</Badge>}
          </div>

          <h2 className="mt-3 truncate font-editorial text-[44px] font-semibold leading-[1.05] tracking-tight text-foreground">
            {setlist.name}
          </h2>

          <div className="mt-3 flex items-center gap-3 text-sm text-muted-foreground">
            <span>{formatServiceDate(setlist.date)}</span>
            <span className="text-muted-foreground/50">·</span>
            <span>
              {itemCount} item{itemCount === 1 ? '' : 's'}
            </span>
          </div>

          <div className="mt-7 flex flex-wrap items-center gap-2">
            <Button variant="signal" size="lg" asChild>
              <Link to={today ? `/service/${setlist.id}` : `/setlists/${setlist.id}`}>
                {today ? 'Start Service →' : 'Open setlist'}
              </Link>
            </Button>
            <Button variant="secondary" size="lg" asChild>
              <Link to={`/setlists/${setlist.id}`}>Edit</Link>
            </Button>
            {!today && (
              <Button variant="secondary" size="lg" asChild>
                <Link to={`/service/${setlist.id}`}>Rehearse</Link>
              </Button>
            )}
          </div>

          {/* Low-key row for secondary / destructive actions. Grouped
              together so neither fights the preview panel on the right
              nor the primary CTAs above. */}
          <div className="mt-5 flex items-center gap-3 text-[11px] text-muted-foreground">
            {canCloneLast && (
              <>
                <button
                  onClick={onCloneLast}
                  disabled={busy}
                  className="underline-offset-4 hover:text-foreground hover:underline disabled:opacity-50"
                >
                  Clone last Sunday
                </button>
                <span className="text-muted-foreground/40">·</span>
              </>
            )}
            <button
              onClick={onDelete}
              className="underline-offset-4 hover:text-destructive hover:underline"
            >
              Delete setlist
            </button>
          </div>
        </div>

        {/* ── Right: preview panel ──────────────────────────────── */}
        <div className="min-w-0">
          <div className="rounded-xl border border-border/50 bg-background/30 p-4 backdrop-blur-sm">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground/80">
                Service plan
              </div>
              <div className="text-[10px] text-muted-foreground/60">
                {itemCount} total
              </div>
            </div>
            {previewItems.length === 0 ? (
              <div className="py-6 text-center text-[11px] text-muted-foreground/70">
                This setlist is empty. Open it to add your first items.
              </div>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {previewItems.map((item, i) => (
                  <li
                    key={item.id}
                    className="flex items-center gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-card/60"
                  >
                    <span className="w-4 text-right text-[10px] font-medium tabular-nums text-muted-foreground/60">
                      {i + 1}
                    </span>
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted/50 text-muted-foreground">
                      <ItemKindIcon kind={item.kind} size={15} />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground/90">
                      {previewLabel(item, songsById)}
                    </span>
                  </li>
                ))}
                {hiddenCount > 0 && (
                  <li className="mt-1 pl-[52px] text-[11px] text-muted-foreground/70">
                    + {hiddenCount} more
                  </li>
                )}
              </ul>
            )}
          </div>
        </div>
      </div>

    </section>
  )
}

// ─── Small grid card for other setlists ────────────────────────────────

function SetlistCard({
  setlist,
  onDelete
}: {
  setlist: Setlist
  onDelete: () => void
}): JSX.Element {
  const itemCount = setlist.items.length
  const parts = setlist.date.split('-')
  const month = parts[1]
    ? new Date(setlist.date + 'T00:00:00').toLocaleString(undefined, {
        month: 'short'
      })
    : '—'
  const day = parts[2] ?? '—'
  // Icon chip strip — up to 5 glyphs so the card footprint is stable.
  const glyphs = setlist.items.slice(0, 5)
  const remaining = Math.max(0, setlist.items.length - glyphs.length)

  return (
    <Card className="group relative overflow-hidden p-4 transition-all hover:border-border hover:bg-card/80 hover:-translate-y-0.5 hover:shadow-[0_14px_40px_-28px_hsl(var(--brand)/0.5)]">
      <Link to={`/setlists/${setlist.id}`} className="flex flex-col gap-3">
        <div className="flex items-start gap-4">
          <div className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-lg border border-border/60 bg-background/60">
            <div className="text-[9px] font-semibold uppercase tracking-widest text-brand/80">
              {month}
            </div>
            <div className="font-editorial text-xl font-semibold leading-none text-foreground">
              {day}
            </div>
          </div>

          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold text-foreground">
              {setlist.name}
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span>{formatServiceDate(setlist.date)}</span>
              <span className="text-muted-foreground/50">·</span>
              <span>
                {itemCount} item{itemCount === 1 ? '' : 's'}
              </span>
            </div>
          </div>
        </div>

        {/* Item-kind glyph strip — gives each card a visual fingerprint */}
        {glyphs.length > 0 && (
          <div className="flex items-center gap-1.5 border-t border-border/30 pt-3">
            {glyphs.map((item) => (
              <span
                key={item.id}
                className="flex h-6 w-6 items-center justify-center rounded-md bg-muted/40 text-muted-foreground/80"
                title={itemKindLabel(item.kind)}
              >
                <ItemKindIcon kind={item.kind} size={13} />
              </span>
            ))}
            {remaining > 0 && (
              <span className="text-[10px] text-muted-foreground/60">
                +{remaining}
              </span>
            )}
          </div>
        )}
      </Link>

      <button
        onClick={onDelete}
        className="absolute right-3 top-3 rounded p-1 text-[11px] text-muted-foreground/60 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
        aria-label={`Delete ${setlist.name}`}
      >
        ✕
      </button>
    </Card>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────

/**
 * Label to show in the hero preview panel for a given item. Resolves
 * songs against the library so the operator sees the song title
 * rather than an opaque ID.
 */
function previewLabel(item: SetlistItem, songsById: Map<string, Song>): string {
  switch (item.kind) {
    case 'song': {
      const song = songsById.get(item.songId)
      return song ? song.title : '(missing song)'
    }
    case 'scripture':
      return item.reference.trim() || 'Scripture'
    case 'image':
      return item.caption?.trim() || 'Image'
    case 'video':
      return item.title?.trim() || 'Video'
    case 'deck':
      return item.title?.trim() || 'PDF deck'
    case 'countdown':
      return item.label.trim() || 'Countdown'
    case 'section-divider':
      return item.label.trim() || 'Section'
  }
}

/**
 * Choose the setlist most worth spotlighting.
 *   1. If one is today, use it.
 *   2. Else use the next upcoming future setlist (earliest date >= today).
 *   3. Else use the most recent past setlist (for recap / rehearsal).
 *   4. Else null (no setlists at all).
 */
function pickHero(setlists: Setlist[]): Setlist | null {
  if (setlists.length === 0) return null
  const todayOne = setlists.find(isToday)
  if (todayOne) return todayOne

  const todayIso = new Date().toISOString().slice(0, 10)
  const upcoming = setlists
    .filter((s) => s.date >= todayIso)
    .sort((a, b) => a.date.localeCompare(b.date))
  if (upcoming[0]) return upcoming[0]

  return setlists[0] ?? null
}
