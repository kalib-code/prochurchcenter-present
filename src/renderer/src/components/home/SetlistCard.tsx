/**
 * SetlistCard — one card in Home's "Other setlists" grid: a date tile,
 * the name, date · item count, and the item kinds it contains as
 * neutral badges. Delete is revealed on hover/focus and is a sibling of
 * the Link (a <button> can't nest inside an <a>).
 */

import { Link } from 'react-router-dom'
import type { Setlist, SetlistItem } from '@shared/types'
import { formatServiceDate } from '../../lib/setlist-helpers'
import { Badge } from '../ui/Badge'
import { itemKindLabel } from '../ItemKindIcon'
import { TrashIcon } from '../icons'

/** Distinct item kinds in first-seen order, with how many of each. */
function kindCounts(items: SetlistItem[]): { kind: SetlistItem['kind']; count: number }[] {
  const counts = new Map<SetlistItem['kind'], number>()
  for (const item of items) {
    if (item.kind === 'section-divider') continue
    counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1)
  }
  return [...counts].map(([kind, count]) => ({ kind, count }))
}

export function SetlistCard({
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
  const day = parts[2] ? String(Number(parts[2])) : '—'
  // Up to 4 kind badges so the card footprint stays stable.
  const kinds = kindCounts(setlist.items)
  const shown = kinds.slice(0, 4)
  const remaining = kinds.length - shown.length

  return (
    <div className="group relative rounded-xl bg-raised transition-colors hover:bg-hover focus-within:bg-hover">
      <Link
        to={`/setlists/${setlist.id}`}
        className="flex gap-4 rounded-xl p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
      >
        <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-lg bg-panel">
          <span className="text-[12px] font-medium leading-none text-muted-foreground">
            {month}
          </span>
          <span className="mt-0.5 text-[19px] font-semibold leading-none tabular-nums text-foreground">
            {day}
          </span>
        </div>

        <div className="min-w-0 flex-1 pr-6">
          <div className="truncate text-[14.5px] font-semibold text-foreground">
            {setlist.name}
          </div>
          <div className="mt-0.5 truncate text-[13px] tabular-nums text-muted-foreground">
            {formatServiceDate(setlist.date)} · {itemCount} item{itemCount === 1 ? '' : 's'}
          </div>
          {shown.length > 0 && (
            <div className="mt-2.5 flex flex-wrap items-center gap-1">
              {shown.map(({ kind, count }) => (
                <Badge key={kind} tone="neutral">
                  {itemKindLabel(kind)}
                  {count > 1 && <span className="tabular-nums text-muted-foreground">{count}</span>}
                </Badge>
              ))}
              {remaining > 0 && (
                <span className="text-[12px] text-muted-foreground">+{remaining}</span>
              )}
            </div>
          )}
        </div>
      </Link>

      <button
        type="button"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onDelete()
        }}
        className="absolute right-2.5 top-2.5 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground opacity-0 transition hover:bg-live/15 hover:text-live focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 group-hover:opacity-100"
        aria-label={`Delete ${setlist.name}`}
      >
        <TrashIcon size={15} />
      </button>
    </div>
  )
}
