/**
 * Small pure helpers for setlist UI logic.
 *
 * Keep business logic here (not inside components) so it can be tested
 * and reasoned about in isolation. Dates everywhere are ISO YYYY-MM-DD
 * strings, NOT Date objects — we never need time-of-day for a setlist,
 * and string comparisons sort correctly without Date-constructor gotchas
 * around timezones.
 */

import type { Setlist, SetlistItem } from '@shared/types'

/** Today's local date as ISO YYYY-MM-DD. Not UTC — Sunday is local. */
export function todayISO(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * The ISO date of the next upcoming Sunday, relative to a given
 * anchor date (default: today). If the anchor itself is a Sunday,
 * this returns that Sunday — "today's service" is what we want when
 * Ate Rose opens the app Sunday morning.
 */
export function nextSundayISO(anchor: string = todayISO()): string {
  const [y, m, d] = anchor.split('-').map(Number)
  const date = new Date(y, m - 1, d) // local midnight
  const dow = date.getDay() // 0 = Sunday
  const daysUntilSunday = dow === 0 ? 0 : 7 - dow
  date.setDate(date.getDate() + daysUntilSunday)
  const ny = date.getFullYear()
  const nm = String(date.getMonth() + 1).padStart(2, '0')
  const nd = String(date.getDate()).padStart(2, '0')
  return `${ny}-${nm}-${nd}`
}

/** Human-readable label for a setlist date: "Sunday, March 15" */
export function formatServiceDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric'
  })
}

/** True if the setlist is for today's date (local). */
export function isToday(setlist: Setlist): boolean {
  return setlist.date === todayISO()
}

// ─────────────────────────────────────────────────────────────────────────────
// TODO (learning mode — user contribution)
// ─────────────────────────────────────────────────────────────────────────────
//
// When Ate Rose clicks "Clone Last Sunday" on an existing setlist, we need
// to pre-fill two fields for the new setlist: `name` and `date`. The form
// still lets her edit them, but a good default saves a step.
//
// This is a domain call — you know how PH churches name services. Consider:
//
//   - DATE: probably nextSundayISO(). But what if source.date is IN THE
//     FUTURE (e.g. she's pre-building 3 weeks in advance)? Maybe next
//     Sunday AFTER source.date, not after today.
//
//   - NAME: three plausible options —
//       (a) Just reuse source.name verbatim ("Sunday Worship")
//       (b) Append "(copy)" — safe but ugly
//       (c) Try to bump a date in the name: "March 8 Service" → "March 15 Service"
//           This is clever but fragile — what if the name is "Easter Sunday"?
//           Option (c) should probably only fire when source.name contains
//           the source.date somewhere, otherwise fall back to (a).
//
//   - Bonus: if the name ends with a number like "Week 3", should we bump it
//     to "Week 4"? Probably overkill for v1.0, but decide deliberately.
//
// Implement suggestCloneDefaults below. Keep it under ~15 lines. When done,
// remove this comment block and the stub throw.
//
// Tests? Write a couple of inline runtime assertions at the bottom of this
// file if you feel like it, or add a proper vitest file later.
// ─────────────────────────────────────────────────────────────────────────────

export interface CloneDefaults {
  name: string
  date: string
}

export function suggestCloneDefaults(source: Setlist): CloneDefaults {
  // Stub — replace with your implementation.
  void source
  // Temporary safe fallback so the app doesn't crash if someone clicks clone
  // before this is implemented. The real version should be smarter.
  return {
    name: source.name,
    date: nextSundayISO()
  }
}

/**
 * Choose the setlist most worth spotlighting.
 *   1. If one is today, use it.
 *   2. Else use the next upcoming future setlist (earliest date >= today).
 *   3. Else use the most recent past setlist (for recap / rehearsal).
 *   4. Else null (no setlists at all).
 */
export function pickHero(setlists: Setlist[]): Setlist | null {
  if (setlists.length === 0) return null
  const todayOne = setlists.find(isToday)
  if (todayOne) return todayOne

  // Local date, same as isToday(). A UTC date here made Monday-morning
  // users east of UTC (e.g. Manila, UTC+8) see yesterday's setlist as
  // "upcoming" until 08:00.
  const todayIso = todayISO()
  const upcoming = setlists
    .filter((s) => s.date >= todayIso)
    .sort((a, b) => a.date.localeCompare(b.date))
  if (upcoming[0]) return upcoming[0]

  // Most recent past setlist — don't rely on the caller's ordering.
  const past = [...setlists].sort((a, b) => b.date.localeCompare(a.date))
  return past[0] ?? null
}

/**
 * Source for "Clone last Sunday": the most recent setlist dated on or
 * before `today`. The store sorts newest-first, so `setlists[0]` is a
 * pre-built FUTURE service whenever one exists — cloning that would
 * copy next month's plan instead of the one just used.
 * Falls back to the nearest upcoming setlist when every one is in the
 * future (still the closest thing to "last Sunday"); null when empty.
 */
export function pickCloneSource(setlists: Setlist[], today: string = todayISO()): Setlist | null {
  let best: Setlist | null = null
  for (const s of setlists) {
    if (s.date <= today && (!best || s.date > best.date)) best = s
  }
  if (best) return best
  for (const s of setlists) {
    if (!best || s.date < best.date) best = s
  }
  return best
}

/**
 * Setlists with at least one item pointing at `songId`, oldest service
 * first. Used before deleting a song: main's deleteSong only unlinks the
 * file, and slideify drops song items whose song is gone, so without this
 * the song would silently vanish from every service that used it.
 */
export function setlistsUsingSong(setlists: Setlist[], songId: string): Setlist[] {
  return setlists
    .filter((s) => s.items.some((i) => i.kind === 'song' && i.songId === songId))
    .sort((a, b) => a.date.localeCompare(b.date))
}

/** `items` with every song item referencing `songId` removed. */
export function itemsWithoutSong(items: SetlistItem[], songId: string): SetlistItem[] {
  return items.filter((i) => !(i.kind === 'song' && i.songId === songId))
}

/**
 * Confirm text for deleting a song, naming the services that use it, e.g.
 *   Delete "Amazing Grace"?
 *
 *   Used in: Sunday Worship (Sunday, November 9), Youth Night (…)
 *   It will be removed from these services.
 */
export function songDeleteConfirmText(title: string, usedIn: Setlist[]): string {
  const head = `Delete "${title}"?`
  if (usedIn.length === 0) return head
  const names = usedIn.map((s) => `${s.name} (${formatServiceDate(s.date)})`).join(', ')
  const tail =
    usedIn.length === 1 ? 'It will be removed from that service.' : 'It will be removed from these services.'
  return `${head}\n\nUsed in: ${names}\n${tail}`
}

/**
 * Home's "Other setlists", split by date. Upcoming is soonest first (what
 * the operator works on next); past is newest first (what they look back
 * at). `excludeId` is the next-service card's setlist, shown separately.
 * Today's services count as upcoming.
 */
export function splitByDate(
  setlists: Setlist[],
  excludeId: string | null,
  today: string = todayISO()
): { upcoming: Setlist[]; past: Setlist[] } {
  const rest = setlists.filter((s) => s.id !== excludeId)
  return {
    upcoming: rest.filter((s) => s.date >= today).sort((a, b) => a.date.localeCompare(b.date)),
    past: rest.filter((s) => s.date < today).sort((a, b) => b.date.localeCompare(a.date))
  }
}

export type ItemIssue = 'missing-song' | 'missing-media'

/**
 * What is wrong with one item, for the service-plan preview. `songsById`
 * must be loaded (an empty map would flag every song). `exists` comes
 * from files.checkExists; a path absent from it is still being checked
 * and is not flagged yet.
 */
export function itemIssue(
  item: SetlistItem,
  songsById: Map<string, unknown>,
  exists: Record<string, boolean>,
  mediaPath: string | null
): ItemIssue | null {
  if (item.kind === 'song' && !songsById.has(item.songId)) return 'missing-song'
  if (mediaPath && exists[mediaPath] === false) return 'missing-media'
  return null
}
