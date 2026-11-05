/**
 * SongRotationPanel — Home's planning hints from past setlists:
 * songs on a streak (maybe give them a rest) and favourites that have
 * gone quiet (maybe bring them back). Each song opens in the editor.
 *
 * Hidden entirely when there's nothing to say, including when there's
 * too little history (see songRotation.MIN_SERVICES).
 */

import { Link } from 'react-router-dom'
import type { SongRotation } from '../../lib/songRotation'
import { formatSince } from '../../lib/songRotation'
import { RefreshCwIcon, ClockIcon } from '../icons'

export function SongRotationPanel({ rotation }: { rotation: SongRotation }): JSX.Element | null {
  const { streaks, resting, serviceCount } = rotation
  if (streaks.length === 0 && resting.length === 0) return null

  return (
    <section aria-labelledby="rotation-heading">
      <div className="mb-3 flex items-baseline gap-3">
        <h2 id="rotation-heading" className="text-[16px] font-semibold text-foreground">
          Song rotation
        </h2>
        <span className="text-[13px] tabular-nums text-muted-foreground">
          From your last {serviceCount} services
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Column
          icon={<RefreshCwIcon size={15} />}
          title="Sung a lot lately"
          empty="No song has been in three services in a row."
          rows={streaks.map((h) => ({
            id: h.song.id,
            title: h.song.title,
            meta: `${h.count} services in a row`
          }))}
        />
        <Column
          icon={<ClockIcon size={15} />}
          title="Haven't sung in a while"
          empty="Every song you've used has been sung in the last 3 months."
          rows={resting.map((h) => ({
            id: h.song.id,
            title: h.song.title,
            meta: `${formatSince(h.daysSince)} ago · sung ${h.timesUsed} time${h.timesUsed === 1 ? '' : 's'}`
          }))}
        />
      </div>
    </section>
  )
}

function Column({
  icon,
  title,
  empty,
  rows
}: {
  icon: JSX.Element
  title: string
  empty: string
  rows: { id: string; title: string; meta: string }[]
}): JSX.Element {
  return (
    <div className="rounded-xl bg-raised p-2">
      <div className="flex items-center gap-2 px-2.5 pb-1.5 pt-1.5 text-[13px] font-medium text-quiet">
        <span className="text-muted-foreground">{icon}</span>
        {title}
      </div>
      {rows.length === 0 ? (
        <p className="px-2.5 pb-2.5 pt-1 text-[13px] text-muted-foreground">{empty}</p>
      ) : (
        <ul className="flex flex-col">
          {rows.map((r) => (
            <li key={r.id}>
              <Link
                to={`/library/${r.id}`}
                className="flex h-10 items-center gap-3 rounded-md px-2.5 transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
              >
                <span className="min-w-0 flex-1 truncate text-[13.5px] text-bone">{r.title}</span>
                <span className="shrink-0 text-[12.5px] tabular-nums text-muted-foreground">
                  {r.meta}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
