/**
 * NextServiceCard — Home's lead card for the setlist `pickHero` chose
 * (today's service, else the next upcoming one, else the latest past one).
 *
 * Left: a live countdown ("Starts in 1h 52m"), name, date · start–end ·
 * items · slides, then one primary action (Start service) with Edit /
 * Rehearse beside it and Clone last Sunday / Delete as quiet ghost
 * actions underneath.
 * Right: the service plan — the first five items, kind badges neutral.
 * Items with a problem (deleted song, moved media file) get an amber
 * badge in place of their kind, and problems past row five are counted
 * in the footer, so nothing broken hides behind "+N more".
 */

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Setlist, SetlistItem, Song } from '@shared/types'
import { mediaPathOf } from '@shared/setlist-media'
import { formatServiceDate, itemIssue, type ItemIssue } from '../../lib/setlist-helpers'
import { serviceCountdown, type CountdownPhase } from '../../lib/serviceCountdown'
import { slideifySetlist } from '../../lib/slideify'
import { cn } from '../../lib/utils'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { StatusDot } from '../ui/StatusDot'
import { itemKindLabel } from '../ItemKindIcon'
import { AlertIcon, CopyIcon, PlayIcon, TrashIcon } from '../icons'

const ISSUE_LABEL: Record<ItemIssue, string> = {
  'missing-song': 'Song deleted',
  'missing-media': 'File missing'
}

/** The current time, refreshed every minute on the minute. */
function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined
    const tick = (): void => setNow(new Date())
    const timeout = setTimeout(() => {
      tick()
      interval = setInterval(tick, 60_000)
    }, 60_000 - (Date.now() % 60_000))
    return () => {
      clearTimeout(timeout)
      if (interval) clearInterval(interval)
    }
  }, [])
  return now
}

/**
 * Which media files in the setlist are missing. Re-checks when the set
 * of paths changes. A path absent from the result is still unchecked.
 */
function useMediaExists(items: SetlistItem[]): Record<string, boolean> {
  const key = useMemo(
    () => [...new Set(items.map(mediaPathOf).filter((p): p is string => !!p))].sort().join('\n'),
    [items]
  )
  const [exists, setExists] = useState<Record<string, boolean>>({})
  useEffect(() => {
    if (!key) return
    let cancelled = false
    window.api.files
      .checkExists(key.split('\n'))
      .then((r) => {
        if (!cancelled) setExists(r)
      })
      .catch(() => {
        // Pre-flight still reports media; the plan just shows no badges.
      })
    return () => {
      cancelled = true
    }
  }, [key])
  return exists
}

/** Green dot on the day of the service; it pulses while it's running. */
const PHASE_DOT: Record<CountdownPhase, boolean | 'pulse'> = {
  today: true,
  running: 'pulse',
  tomorrow: false,
  later: false,
  ended: false
}

export function NextServiceCard({
  setlist,
  songsById,
  songsLoaded,
  onDelete,
  onCloneLast,
  canCloneLast,
  busy
}: {
  setlist: Setlist
  songsById: Map<string, Song>
  /** False until the library has loaded — until then no song is "deleted". */
  songsLoaded: boolean
  onDelete: () => void
  onCloneLast: () => void
  canCloneLast: boolean
  busy: boolean
}): JSX.Element {
  const itemCount = setlist.items.length
  // Show up to 5 items in the service-plan preview; the rest collapse
  // into a "+N more" footer so the card never grows unpredictably long.
  const planRows = setlist.items.slice(0, 5)
  const hiddenCount = Math.max(0, itemCount - planRows.length)

  const rendered = useMemo(() => slideifySetlist(setlist, songsById), [setlist, songsById])
  const slideCount = rendered.reduce((sum, item) => sum + item.slides.length, 0)
  const countdown = serviceCountdown(setlist, useMinuteClock())
  const dot = PHASE_DOT[countdown.phase]

  const exists = useMediaExists(setlist.items)
  const issues = useMemo(() => {
    const m = new Map<string, ItemIssue>()
    for (const item of setlist.items) {
      const issue = itemIssue(
        item,
        songsLoaded ? songsById : ALL_SONGS,
        exists,
        mediaPathOf(item)
      )
      if (issue) m.set(item.id, issue)
    }
    return m
  }, [setlist.items, songsById, songsLoaded, exists])
  const hiddenIssues = setlist.items.slice(planRows.length).filter((i) => issues.has(i.id)).length

  return (
    <section
      aria-label="Next service"
      className="grid grid-cols-1 gap-6 rounded-xl bg-raised p-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:p-7"
    >
      {/* ── Left: headline + actions ─────────────────────────── */}
      <div className="flex min-w-0 flex-col">
        <div className="mb-2 flex items-center gap-2 text-[13px] font-medium text-soft">
          {dot && <StatusDot tone="ok" pulse={dot === 'pulse'} />}
          {countdown.phase === 'later' || countdown.phase === 'tomorrow'
            ? `Next service · ${countdown.label}`
            : countdown.phase === 'ended' && countdown.label === 'Past service'
              ? 'Most recent service'
              : countdown.label}
        </div>

        <h2 className="truncate text-[34px] font-semibold leading-tight tracking-[-0.025em] text-foreground">
          {setlist.name}
        </h2>

        <p className="mt-1.5 text-[14px] tabular-nums text-soft">
          {formatServiceDate(setlist.date)}
          <Sep />
          {countdown.startsAt}
          {countdown.endsAt && ` – ${countdown.endsAt}`}
          <Sep />
          {itemCount} item{itemCount === 1 ? '' : 's'}
          <Sep />
          {slideCount} slide{slideCount === 1 ? '' : 's'}
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-2">
          <Button variant="primary" size="lg" asChild>
            <Link to={`/service/${setlist.id}`}>
              <PlayIcon size={16} />
              Start service
            </Link>
          </Button>
          <Button variant="secondary" size="lg" asChild>
            <Link to={`/setlists/${setlist.id}`}>Edit</Link>
          </Button>
          <Button variant="ghost" size="lg" asChild>
            <Link to={`/service/${setlist.id}`}>Rehearse</Link>
          </Button>
        </div>

        {/* Quiet secondary / destructive actions. */}
        <div className="-ml-3 mt-auto flex items-center gap-1 pt-5">
          {canCloneLast && (
            <Button variant="ghost" size="sm" onClick={onCloneLast} disabled={busy}>
              <CopyIcon size={15} />
              Clone last Sunday
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            className="hover:bg-live/10 hover:text-live"
          >
            <TrashIcon size={15} />
            Delete
          </Button>
        </div>
      </div>

      {/* ── Right: service plan preview ─────────────────────── */}
      <div className="flex min-w-0 flex-col self-start rounded-lg bg-panel/70 p-2">
        <div className="flex items-baseline justify-between px-2.5 pb-2 pt-1.5">
          <span className="text-[13px] font-medium text-quiet">Service plan</span>
          {issues.size > 0 ? (
            <span className="flex items-center gap-1.5 text-[12px] text-warn">
              <AlertIcon size={13} />
              {issues.size} need{issues.size === 1 ? 's' : ''} fixing
            </span>
          ) : (
            <span className="text-[12px] tabular-nums text-muted-foreground">
              {itemCount} item{itemCount === 1 ? '' : 's'}
            </span>
          )}
        </div>

        {planRows.length === 0 ? (
          <p className="px-2.5 py-6 text-center text-[13px] text-muted-foreground">
            This setlist is empty. Open it to add your first items.
          </p>
        ) : (
          <ol className="flex flex-col">
            {planRows.map((item, i) => {
              const issue = issues.get(item.id)
              const row = (
                <>
                  <span className="w-4 shrink-0 text-right text-[12px] tabular-nums text-muted-foreground">
                    {i + 1}
                  </span>
                  <span
                    className={
                      item.kind === 'section-divider'
                        ? 'min-w-0 flex-1 truncate text-[13px] font-medium text-quiet'
                        : 'min-w-0 flex-1 truncate text-[13.5px] text-bone'
                    }
                  >
                    {previewLabel(item, songsById)}
                  </span>
                  {issue ? (
                    <Badge tone="warn" className="shrink-0">
                      <AlertIcon size={12} />
                      {ISSUE_LABEL[issue]}
                    </Badge>
                  ) : (
                    <Badge tone="neutral" className="shrink-0">
                      {itemKindLabel(item.kind)}
                    </Badge>
                  )}
                </>
              )
              const rowClass = 'flex h-10 items-center gap-3 rounded-md px-2.5'
              return (
                <li key={item.id}>
                  {issue ? (
                    // A broken row opens the editor, where Relink lives.
                    <Link
                      to={`/setlists/${setlist.id}`}
                      title="Open the setlist to fix this"
                      className={cn(
                        rowClass,
                        'transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70'
                      )}
                    >
                      {row}
                    </Link>
                  ) : (
                    <div className={rowClass}>{row}</div>
                  )}
                </li>
              )
            })}
            {hiddenCount > 0 && (
              <li className="px-2.5 pb-1 pt-1.5 text-[12.5px] text-muted-foreground">
                + {hiddenCount} more
                {hiddenIssues > 0 && (
                  <span className="text-warn">
                    {' '}
                    · {hiddenIssues} need{hiddenIssues === 1 ? 's' : ''} fixing
                  </span>
                )}
              </li>
            )}
          </ol>
        )}
      </div>
    </section>
  )
}

/** Stand-in library before songs load: claims every id, so none is flagged. */
const ALL_SONGS = { has: () => true } as unknown as Map<string, unknown>

function Sep(): JSX.Element {
  return (
    <span aria-hidden="true" className="mx-2 text-muted-foreground">
      ·
    </span>
  )
}

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
