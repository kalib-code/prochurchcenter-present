/**
 * Home — the first screen Ate Rose sees when she opens Present.
 *
 * Hero panel (signal-bordered, `Panel emphasis`):
 *   - Left pane  : NEXT UP eyebrow, setlist name, date/item/slide meta,
 *                  the pre-flight warning banner (if any), CTAs, and the
 *                  quiet Clone/Delete row.
 *   - Right pane : SERVICE PLAN — a compact preview of the first five
 *                  items in that setlist so the operator can see AT A
 *                  GLANCE what the service looks like without opening it.
 *
 * Below the hero: the full pre-flight readiness panel (checked on
 * launch and on demand — never polled), then the other saved setlists
 * as a seamless hairline grid.
 *
 * Header keeps nav + a permanent "+ New Setlist" button so creating a
 * fresh service never requires scrolling or hunting for a CTA.
 */

import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { PreflightCheck, PreflightReport } from '@shared/ipc-contract'
import type { Setlist, SetlistItem, Song } from '@shared/types'
import { useSetlistStore } from '../stores/useSetlistStore'
import { useLibraryStore } from '../stores/useLibraryStore'
import {
  formatServiceDate,
  isToday,
  nextSundayISO,
  pickHero,
  suggestCloneDefaults
} from '../lib/setlist-helpers'
import { slideifySetlist } from '../lib/slideify'
import { summarize } from '../lib/preflight'
import { Button } from '../components/ui/Button'
import { Panel } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { EmptyState } from '../components/ui/EmptyState'
import { MonoLabel } from '../components/ui/MonoLabel'
import { StatusDot } from '../components/ui/StatusDot'
import { TitleDot } from '../components/ui/TitleDot'
import { HairlineGrid } from '../components/ui/HairlineGrid'
import { PreflightBanner, PreflightPanel } from '../components/PreflightPanel'
import { itemKindCode, itemKindLabel } from '../components/ItemKindIcon'

export function Home(): JSX.Element {
  const navigate = useNavigate()
  const { setlists, loading, error, load, create, remove, clone } = useSetlistStore()
  const { songs, load: loadSongs } = useLibraryStore()
  const [busy, setBusy] = useState(false)
  const [preflight, setPreflight] = useState<PreflightReport | null>(null)
  const [preflightBusy, setPreflightBusy] = useState(false)

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
  const heroId = heroSetlist?.id ?? null

  // Pre-flight is checked once we know which setlist to check against
  // (heroId starts null until setlists finish loading, then settles),
  // and again on demand via RE-CHECK. Never polled.
  useEffect(() => {
    let cancelled = false
    window.api.system.getPreflight(heroId).then((report) => {
      if (!cancelled) setPreflight(report)
    })
    return () => {
      cancelled = true
    }
  }, [heroId])

  const handleRecheck = async (): Promise<void> => {
    setPreflightBusy(true)
    try {
      const report = await window.api.system.getPreflight(heroId)
      setPreflight(report)
    } finally {
      setPreflightBusy(false)
    }
  }

  const handlePreflightRemedy = (check: PreflightCheck): void => {
    const remedy = check.remedy
    if (!remedy) return
    if (remedy.kind === 'external') {
      window.api.system.openExternal(remedy.target)
    } else {
      navigate(remedy.target)
    }
  }

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
      <header className="flex h-[60px] shrink-0 items-center justify-between border-b border-border bg-card px-6">
        <div className="flex items-baseline gap-3">
          <span className="text-[22px] font-extrabold tracking-[-0.03em] text-foreground">
            Present
            <TitleDot />
          </span>
          <MonoLabel size="xs" className="tracking-[0.18em]">
            PROCHURCHCENTER
          </MonoLabel>
        </div>
        <nav className="flex items-center">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/library">SONG LIBRARY</Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/settings">SETTINGS</Link>
          </Button>
          <div className="mx-3.5 h-[22px] w-px bg-border" />
          <Button variant="signal" size="md" onClick={handleNew} disabled={busy}>
            + NEW SETLIST
          </Button>
        </nav>
      </header>

      {/* ── Body ───────────────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto px-6 pb-10 pt-[26px]">
        {loading && !heroSetlist && (
          <p className="mb-4 text-[13px] text-muted-foreground">Loading setlists…</p>
        )}
        {error && (
          <p className="mb-4 border border-destructive/30 bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
            Failed to load: {error}
          </p>
        )}

        {/* Hero: today/upcoming setlist */}
        {heroSetlist && (
          <HeroSetlist
            setlist={heroSetlist}
            songsById={songsById}
            preflight={preflight}
            onPreflightAct={handlePreflightRemedy}
            onDelete={() => handleDelete(heroSetlist.id, heroSetlist.name)}
            onCloneLast={handleCloneLast}
            canCloneLast={setlists.length > 0}
            busy={busy}
          />
        )}

        {/* Pre-flight readiness */}
        <PreflightPanel report={preflight} onRecheck={handleRecheck} busy={preflightBusy} />

        {/* Other setlists */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <MonoLabel>{heroSetlist ? 'OTHER SETLISTS' : 'SETLISTS'}</MonoLabel>
            {otherSetlists.length > 0 && (
              <MonoLabel tone="dim">{otherSetlists.length} SAVED</MonoLabel>
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
            <HairlineGrid cols={3}>
              {otherSetlists.map((s) => (
                <SetlistCell key={s.id} setlist={s} onDelete={() => handleDelete(s.id, s.name)} />
              ))}
            </HairlineGrid>
          )}
        </section>
      </main>
    </div>
  )
}

// ─── Hero setlist ─────────────────────────────────────────────────────

function HeroSetlist({
  setlist,
  songsById,
  preflight,
  onPreflightAct,
  onDelete,
  onCloneLast,
  canCloneLast,
  busy
}: {
  setlist: Setlist
  songsById: Map<string, Song>
  preflight: PreflightReport | null
  onPreflightAct: (check: PreflightCheck) => void
  onDelete: () => void
  onCloneLast: () => void
  canCloneLast: boolean
  busy: boolean
}): JSX.Element {
  const itemCount = setlist.items.length
  // Show up to 5 items in the service-plan preview; the rest collapse
  // into a "+N more" footer so the hero never grows unpredictably long.
  const planRows = setlist.items.slice(0, 5)
  const hiddenCount = Math.max(0, itemCount - planRows.length)

  const rendered = useMemo(
    () => slideifySetlist(setlist, songsById),
    [setlist, songsById]
  )
  const slideCount = rendered.reduce((sum, item) => sum + item.slides.length, 0)

  const preflightSummary = preflight ? summarize(preflight.checks) : null
  const showBanner = preflightSummary && preflightSummary.warningCount > 0 && preflightSummary.firstWarning

  return (
    <Panel emphasis className="mb-[34px] grid grid-cols-1 lg:grid-cols-[1.25fr_1fr]">
      {/* ── Left: headline + CTAs ─────────────────────────────── */}
      <div className="min-w-0 px-[34px] pb-[30px] pt-[34px]">
        <div className="mb-5 flex items-center gap-2.5">
          <StatusDot tone="signal" pulse />
          <MonoLabel tone="signal">
            {isToday(setlist) ? 'TODAY · LIVE SERVICE' : 'NEXT UP'}
          </MonoLabel>
        </div>

        <h2 className="mb-4 truncate text-[56px] font-extrabold leading-[1.02] tracking-[-0.035em] text-foreground">
          {setlist.name}
          <TitleDot />
        </h2>

        <div className="mb-[30px] font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-soft">
          {formatServiceDate(setlist.date)} &nbsp;·&nbsp; {itemCount} item
          {itemCount === 1 ? '' : 's'} &nbsp;·&nbsp; {slideCount} slide
          {slideCount === 1 ? '' : 's'}
        </div>

        {showBanner && preflightSummary && preflightSummary.firstWarning && (
          <PreflightBanner
            check={preflightSummary.firstWarning}
            count={preflightSummary.warningCount}
            onAct={onPreflightAct}
          />
        )}

        <div className="mb-[22px] flex">
          <Button variant="signal" size="lg" asChild>
            <Link to={`/service/${setlist.id}`}>START SERVICE →</Link>
          </Button>
          <Button variant="outline" size="lg" className="border-l-0" asChild>
            <Link to={`/setlists/${setlist.id}`}>EDIT</Link>
          </Button>
          <Button variant="outline" size="lg" className="border-l-0" asChild>
            <Link to={`/service/${setlist.id}`}>REHEARSE</Link>
          </Button>
        </div>

        {/* Low-key row for secondary / destructive actions. */}
        <div className="flex items-center gap-3.5 text-[12px] text-muted-foreground">
          {canCloneLast && (
            <>
              <button
                onClick={onCloneLast}
                disabled={busy}
                className="text-soft hover:text-foreground disabled:opacity-50"
              >
                Clone last Sunday
              </button>
              <span className="text-border">|</span>
            </>
          )}
          <button onClick={onDelete} className="text-soft hover:text-signal-deep">
            Delete setlist
          </button>
        </div>
      </div>

      {/* ── Right: service plan preview ───────────────────────── */}
      <div className="flex min-w-0 flex-col border-l border-border">
        <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-3.5">
          <MonoLabel tone="soft">SERVICE PLAN</MonoLabel>
          <MonoLabel>{itemCount} TOTAL</MonoLabel>
        </div>

        {planRows.length === 0 ? (
          <div className="px-5 py-8 text-center text-[11px] text-muted-foreground">
            This setlist is empty. Open it to add your first items.
          </div>
        ) : (
          <>
            {planRows.map((item, i) => (
              <div
                key={item.id}
                className="flex items-center gap-3.5 border-b border-rule px-5 py-3"
              >
                <span className="w-3.5 shrink-0 text-right font-mono text-[10px] text-dim">
                  {i + 1}
                </span>
                <Badge
                  tone={itemKindTone(item.kind)}
                  className="w-10 shrink-0 justify-center"
                  title={itemKindLabel(item.kind)}
                >
                  {itemKindCode(item.kind)}
                </Badge>
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-bone">
                  {previewLabel(item, songsById)}
                </span>
              </div>
            ))}
            {hiddenCount > 0 && (
              <div className="px-5 py-3 font-mono text-[9.5px] font-medium tracking-[0.1em] text-muted-foreground">
                + {hiddenCount} MORE
              </div>
            )}
          </>
        )}
      </div>
    </Panel>
  )
}

// ─── Small grid cell for other setlists ────────────────────────────────

function SetlistCell({
  setlist,
  onDelete
}: {
  setlist: Setlist
  onDelete: () => void
}): JSX.Element {
  const itemCount = setlist.items.length
  const parts = setlist.date.split('-')
  const month = parts[1]
    ? new Date(setlist.date + 'T00:00:00').toLocaleString(undefined, { month: 'short' })
    : '—'
  const day = parts[2] ?? '—'
  // Item-kind badge strip — up to 5 glyphs so the cell footprint is stable.
  const glyphs = setlist.items.slice(0, 5)
  const remaining = Math.max(0, setlist.items.length - glyphs.length)

  return (
    <div className="group relative bg-card p-5 hover:bg-panel-hi">
      <Link to={`/setlists/${setlist.id}`} className="flex gap-4">
        <div className="flex h-[52px] w-[52px] shrink-0 flex-col items-center justify-center border border-border">
          <span className="font-mono text-[8.5px] font-semibold uppercase tracking-[0.12em] text-signal">
            {month}
          </span>
          <span className="text-[20px] font-extrabold leading-[1.1] tracking-[-0.03em] text-foreground">
            {day}
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-bold tracking-[-0.01em] text-foreground">
            {setlist.name}
          </div>
          <div className="mb-3 mt-[5px] font-mono text-[9.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
            {formatServiceDate(setlist.date)} &nbsp;·&nbsp; {itemCount} item
            {itemCount === 1 ? '' : 's'}
          </div>
          {glyphs.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              {glyphs.map((item) => (
                <Badge key={item.id} title={itemKindLabel(item.kind)}>
                  {itemKindCode(item.kind)}
                </Badge>
              ))}
              {remaining > 0 && (
                <span className="font-mono text-[8px] text-dim">+{remaining}</span>
              )}
            </div>
          )}
        </div>
      </Link>

      <button
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onDelete()
        }}
        className="absolute right-3 top-3 p-1 text-[11px] text-dim opacity-0 transition-opacity hover:text-signal-deep group-hover:opacity-100"
        aria-label={`Delete ${setlist.name}`}
      >
        ✕
      </button>
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────

/**
 * Label to show in the service-plan preview for a given item. Resolves
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
    case 'pptx':
      return item.title?.trim() || 'PowerPoint'
  }
}

/**
 * Service Plan badge tone. Section dividers are grouping only — they never
 * reach the projector — so they read neutral while every real content kind
 * reads signal. Mirrors the design's kindFg/kindBd split.
 */
function itemKindTone(kind: SetlistItem['kind']): 'signal' | 'neutral' {
  return kind === 'section-divider' ? 'neutral' : 'signal'
}
