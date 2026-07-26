/**
 * Small pure helpers for setlist UI logic.
 *
 * Keep business logic here (not inside components) so it can be tested
 * and reasoned about in isolation. Dates everywhere are ISO YYYY-MM-DD
 * strings, NOT Date objects — we never need time-of-day for a setlist,
 * and string comparisons sort correctly without Date-constructor gotchas
 * around timezones.
 */

import type { Setlist } from '@shared/types'

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

  const todayIso = new Date().toISOString().slice(0, 10)
  const upcoming = setlists
    .filter((s) => s.date >= todayIso)
    .sort((a, b) => a.date.localeCompare(b.date))
  if (upcoming[0]) return upcoming[0]

  return setlists[0] ?? null
}
