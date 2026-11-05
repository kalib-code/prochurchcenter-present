/**
 * NextServiceCard — Home's lead card for the setlist `pickHero` chose
 * (today's service, else the next upcoming one, else the latest past one).
 *
 * Left: name, date · items · slides, the optional pre-flight nudge, then
 * one primary action (Start service) with Edit / Rehearse beside it and
 * Clone last Sunday / Delete as quiet ghost actions underneath.
 * Right: the service plan — the first five items, kind badges neutral.
 */

import { useMemo, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { Setlist, SetlistItem, Song } from '@shared/types'
import { formatServiceDate, isToday } from '../../lib/setlist-helpers'
import { slideifySetlist } from '../../lib/slideify'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { StatusDot } from '../ui/StatusDot'
import { itemKindLabel } from '../ItemKindIcon'
import { CopyIcon, PlayIcon, TrashIcon } from '../icons'

export function NextServiceCard({
  setlist,
  songsById,
  preflightNudge,
  onDelete,
  onCloneLast,
  canCloneLast,
  busy
}: {
  setlist: Setlist
  songsById: Map<string, Song>
  preflightNudge: ReactNode
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
  const today = isToday(setlist)

  return (
    <section
      aria-label="Next service"
      className="grid grid-cols-1 gap-6 rounded-xl bg-raised p-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:p-7"
    >
      {/* ── Left: headline + actions ─────────────────────────── */}
      <div className="flex min-w-0 flex-col">
        <div className="mb-2 flex items-center gap-2 text-[13px] font-medium text-soft">
          {today && <StatusDot tone="ok" />}
          {today ? 'Today' : 'Next service'}
        </div>

        <h2 className="truncate text-[34px] font-semibold leading-tight tracking-[-0.025em] text-foreground">
          {setlist.name}
        </h2>

        <p className="mt-1.5 text-[14px] tabular-nums text-soft">
          {formatServiceDate(setlist.date)}
          <Sep />
          {itemCount} item{itemCount === 1 ? '' : 's'}
          <Sep />
          {slideCount} slide{slideCount === 1 ? '' : 's'}
        </p>

        {preflightNudge && <div className="mt-5">{preflightNudge}</div>}

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
          <span className="text-[12px] tabular-nums text-muted-foreground">
            {itemCount} item{itemCount === 1 ? '' : 's'}
          </span>
        </div>

        {planRows.length === 0 ? (
          <p className="px-2.5 py-6 text-center text-[13px] text-muted-foreground">
            This setlist is empty. Open it to add your first items.
          </p>
        ) : (
          <ol className="flex flex-col">
            {planRows.map((item, i) => (
              <li
                key={item.id}
                className="flex h-10 items-center gap-3 rounded-md px-2.5"
              >
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
                <Badge tone="neutral" className="shrink-0">
                  {itemKindLabel(item.kind)}
                </Badge>
              </li>
            ))}
            {hiddenCount > 0 && (
              <li className="px-2.5 pb-1 pt-1.5 text-[12.5px] text-muted-foreground">
                + {hiddenCount} more
              </li>
            )}
          </ol>
        )}
      </div>
    </section>
  )
}

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
