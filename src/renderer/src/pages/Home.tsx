/**
 * Home — the first screen Ate Rose sees when she opens Present.
 *
 * Layout:
 *   - Header with the serif wordmark and nav links (Settings / Library)
 *   - Today-or-next hero: big gradient card anchored by the next
 *     scheduled service. If one is on today's date we call it TODAY;
 *     otherwise we call it UPCOMING and show the date nicely.
 *   - Quick actions row (New / Clone)
 *   - Upcoming + recent setlist grid (cards, not list rows)
 *   - Empty state with action when nothing exists
 *
 * Design notes:
 *   - One primary (gold) button per view — the hero CTA, which becomes
 *     either "Start Service →" if today, or "Edit Setlist" otherwise.
 *   - Setlist cards have hover elevation + a date "tile" on the left so
 *     the grid scans like a calendar.
 *   - Deleted setlists show a confirm dialog — this hasn't changed.
 */

import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { Setlist } from '@shared/types'
import { useSetlistStore } from '../stores/useSetlistStore'
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

export function Home(): JSX.Element {
  const navigate = useNavigate()
  const { setlists, loading, error, load, create, remove, clone } = useSetlistStore()
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    load()
  }, [load])

  // The hero anchor: today's setlist if we have one, else the nearest
  // future setlist by date. Falls back to the most recent past setlist
  // if there are no upcoming ones.
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
      <header className="flex items-center justify-between border-b border-border/40 px-10 py-6">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-brand/80">
            Sunday Task
          </div>
          <h1 className="font-editorial text-3xl font-semibold tracking-tight text-foreground">
            Present
          </h1>
        </div>
        <nav className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/library">Song Library</Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/settings">Settings</Link>
          </Button>
        </nav>
      </header>

      {/* ── Body ───────────────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto px-10 py-8">
        <div className="mx-auto max-w-5xl">
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
              onDelete={() => handleDelete(heroSetlist.id, heroSetlist.name)}
            />
          )}

          {/* Quick actions — shown below hero so they never compete
              with it for primary attention. When no hero exists, these
              ARE the primary actions and get more visual weight. */}
          <section className="mt-8 flex flex-wrap items-center gap-2">
            <Button
              variant={heroSetlist ? 'secondary' : 'primary'}
              size="md"
              onClick={handleNew}
              disabled={busy}
            >
              + New Setlist
            </Button>
            <Button
              variant="secondary"
              size="md"
              onClick={handleCloneLast}
              disabled={busy || setlists.length === 0}
              title={
                setlists.length === 0
                  ? 'No previous setlists yet'
                  : 'Clone your most recent setlist'
              }
            >
              Clone last Sunday
            </Button>
          </section>

          {/* Other setlists */}
          <section className="mt-10">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
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
                  <Button variant="primary" size="md" onClick={handleNew}>
                    + Create your first setlist
                  </Button>
                }
              />
            )}

            {otherSetlists.length > 0 && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
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

// ─── Hero setlist card ────────────────────────────────────────────────

function HeroSetlist({
  setlist,
  onDelete
}: {
  setlist: Setlist
  onDelete: () => void
}): JSX.Element {
  const today = isToday(setlist)
  const eyebrow = today ? 'Today · Live service' : 'Next up'
  const itemCount = setlist.items.length

  return (
    <section className="relative overflow-hidden rounded-2xl border border-border/50 bg-gradient-to-br from-card/80 via-card/50 to-background p-8 shadow-[0_24px_80px_-40px_hsl(var(--brand)/0.45)]">
      {/* Subtle brand glow corner */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-brand/10 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-32 -left-20 h-80 w-80 rounded-full bg-brand/5 blur-3xl"
      />

      <div className="relative flex items-start justify-between gap-6">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-brand">
              {eyebrow}
            </div>
            {today && <Badge tone="brand">Today</Badge>}
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
            <Button variant="primary" size="lg" asChild>
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
        </div>
      </div>

      <button
        onClick={onDelete}
        className="absolute right-5 top-5 text-[11px] text-muted-foreground/70 transition-colors hover:text-destructive"
      >
        Delete
      </button>
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

  return (
    <Card className="group relative overflow-hidden p-4 transition-all hover:border-border hover:bg-card/80 hover:-translate-y-0.5">
      <Link to={`/setlists/${setlist.id}`} className="flex items-start gap-4">
        <div className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-lg border border-border/60 bg-background/60">
          <div className="text-[9px] font-semibold uppercase tracking-widest text-brand/70">
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

  // Fallback: most recent (the store already returns desc-by-date).
  return setlists[0] ?? null
}
