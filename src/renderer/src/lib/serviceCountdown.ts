/**
 * serviceCountdown — the "Starts in 1h 52m · ends ~11:05 AM" line on
 * Home's next-service card.
 *
 * Pure: `now` is passed in so tests (and the card's one-minute ticker)
 * control the clock. Start and end come from the same parseStart /
 * computeSchedule the setlist editor uses, so both screens always agree.
 */

import type { Setlist } from '@shared/types'
import { computeSchedule, parseStart } from './serviceClock'

export type CountdownPhase =
  /** More than a day away, e.g. "In 5 days". */
  | 'later'
  | 'tomorrow'
  /** Today, before the start time. */
  | 'today'
  /** Today, between start and projected end. */
  | 'running'
  /** Today, after the projected end — or any earlier date. */
  | 'ended'

export interface ServiceCountdown {
  phase: CountdownPhase
  /** Short status for the card's eyebrow, e.g. "Starts in 1h 52m". */
  label: string
  /** "10:00 AM" */
  startsAt: string
  /** "11:05 AM", or null when no item has a duration yet. */
  endsAt: string | null
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Minutes since midnight → "10:00 AM". */
function clock(minutes: number): string {
  const wrapped = ((minutes % 1440) + 1440) % 1440
  const h24 = Math.floor(wrapped / 60)
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h12}:${String(wrapped % 60).padStart(2, '0')} ${h24 < 12 ? 'AM' : 'PM'}`
}

/** 112 → "1h 52m"; 45 → "45m"; 120 → "2h". */
export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes))
  const h = Math.floor(m / 60)
  const r = m % 60
  if (h === 0) return `${r}m`
  return r === 0 ? `${h}h` : `${h}h ${r}m`
}

export function serviceCountdown(setlist: Setlist, now: Date): ServiceCountdown {
  const startMin = parseStart(setlist.startTime)
  const { totalMinutes } = computeSchedule(setlist.items, setlist.startTime)
  const startsAt = clock(startMin)
  const endsAt = totalMinutes > 0 ? clock(startMin + totalMinutes) : null

  const [y, mo, d] = setlist.date.split('-').map(Number)
  const serviceDay = new Date(y, mo - 1, d)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  // Round, don't floor: a DST change makes one day 23 or 25 hours long.
  const dayDiff = Math.round((serviceDay.getTime() - today.getTime()) / DAY_MS)

  const base = { startsAt, endsAt }
  if (Number.isNaN(dayDiff) || dayDiff < 0) return { ...base, phase: 'ended', label: 'Past service' }
  if (dayDiff === 1) return { ...base, phase: 'tomorrow', label: `Tomorrow at ${startsAt}` }
  if (dayDiff > 1) return { ...base, phase: 'later', label: `In ${dayDiff} days` }

  const nowMin = now.getHours() * 60 + now.getMinutes()
  // With no durations planned, treat the service as one hour long so
  // "In progress" still shows during it.
  const endMin = startMin + (totalMinutes > 0 ? totalMinutes : 60)
  if (nowMin < startMin) {
    return { ...base, phase: 'today', label: `Starts in ${formatDuration(startMin - nowMin)}` }
  }
  if (nowMin < endMin) return { ...base, phase: 'running', label: 'In progress' }
  return { ...base, phase: 'ended', label: 'Ended' }
}
