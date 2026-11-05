/**
 * songRotation — Home's "Song rotation" hints, worked out from the
 * setlists already on disk (no new stored fields).
 *
 *   - On a streak: songs in each of the last N services in a row.
 *   - Resting: songs the church has sung before but not for a while,
 *     favourites first, so they can be brought back.
 *
 * History runs up to and including `upTo` (Home passes the next
 * service's date), so a song already planned for next Sunday counts
 * toward its streak — that is the moment the hint is useful.
 *
 * A "service" is one date: two setlists on the same day (e.g. 8 AM and
 * 10 AM) are one service for rotation purposes.
 */

import type { Setlist, Song } from '@shared/types'

/** A song in this many consecutive services gets flagged. */
export const STREAK_MIN = 3
/**
 * Services further apart than this break a streak: "in a row" means
 * week after week, not April, July and October.
 */
export const STREAK_MAX_GAP_DAYS = 14
/** A song unused for this many days counts as resting. */
export const RESTING_DAYS = 90
/** Below this many services there isn't enough history to say anything. */
export const MIN_SERVICES = 4
export const MAX_HINTS = 5

export interface StreakHint {
  song: Song
  /** Consecutive services, counting back from the latest. */
  count: number
}

export interface RestingHint {
  song: Song
  /** ISO date it was last used. */
  lastUsed: string
  daysSince: number
  timesUsed: number
}

export interface SongRotation {
  streaks: StreakHint[]
  resting: RestingHint[]
  /** Distinct service dates considered. */
  serviceCount: number
}

function daysBetween(fromIso: string, toIso: string): number {
  const [y1, m1, d1] = fromIso.split('-').map(Number)
  const [y2, m2, d2] = toIso.split('-').map(Number)
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000)
}

export function songRotation(setlists: Setlist[], songs: Song[], upTo: string): SongRotation {
  // date → song ids sung that day
  const byDate = new Map<string, Set<string>>()
  for (const s of setlists) {
    if (s.date > upTo) continue
    let ids = byDate.get(s.date)
    if (!ids) byDate.set(s.date, (ids = new Set()))
    for (const item of s.items) if (item.kind === 'song') ids.add(item.songId)
  }
  const dates = [...byDate.keys()].sort().reverse() // newest first
  const empty = { streaks: [], resting: [], serviceCount: dates.length }
  if (dates.length < MIN_SERVICES) return empty

  const streaks: StreakHint[] = []
  const resting: RestingHint[] = []
  for (const song of songs) {
    let count = 0
    while (
      count < dates.length &&
      byDate.get(dates[count])!.has(song.id) &&
      (count === 0 || daysBetween(dates[count], dates[count - 1]) <= STREAK_MAX_GAP_DAYS)
    )
      count++
    if (count >= STREAK_MIN) streaks.push({ song, count })

    let lastUsed: string | null = null
    let timesUsed = 0
    for (const d of dates) {
      if (!byDate.get(d)!.has(song.id)) continue
      timesUsed++
      if (!lastUsed) lastUsed = d
    }
    if (lastUsed) {
      const daysSince = daysBetween(lastUsed, upTo)
      if (daysSince >= RESTING_DAYS) resting.push({ song, lastUsed, daysSince, timesUsed })
    }
  }

  streaks.sort((a, b) => b.count - a.count || a.song.title.localeCompare(b.song.title))
  // Favourites first: a song sung 20 times and dropped is a better
  // suggestion than one sung once.
  resting.sort((a, b) => b.timesUsed - a.timesUsed || b.daysSince - a.daysSince)
  return {
    streaks: streaks.slice(0, MAX_HINTS),
    resting: resting.slice(0, MAX_HINTS),
    serviceCount: dates.length
  }
}

/** 95 → "3 months"; 400 → "1 year"; 20 → "3 weeks". */
export function formatSince(days: number): string {
  if (days >= 365) {
    const y = Math.floor(days / 365)
    return `${y} year${y === 1 ? '' : 's'}`
  }
  if (days >= 60) return `${Math.floor(days / 30)} months`
  const w = Math.max(1, Math.floor(days / 7))
  return `${w} week${w === 1 ? '' : 's'}`
}
