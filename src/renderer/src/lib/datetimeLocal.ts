/**
 * Conversions between a stored UTC ISO timestamp and the value of an
 * `<input type="datetime-local">`, which is wall-clock LOCAL time with no
 * zone ("YYYY-MM-DDTHH:mm").
 *
 * Why not `iso.slice(0, 16)` / `new Date(v).toISOString()`: slicing shows
 * the UTC wall clock, then parsing treats it as local — so every edit in a
 * non-UTC zone (Manila is UTC+8) shifted the countdown target by the
 * offset. And a cleared field gives '', where `toISOString()` throws.
 */

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** UTC ISO → "YYYY-MM-DDTHH:mm" in the local zone; '' if missing/invalid. */
export function isoToLocalInput(iso: string | undefined | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  )
}

/** datetime-local value (local wall clock) → UTC ISO; null if empty/invalid. */
export function localInputToIso(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(value)
  if (!m) return null
  const [, y, mo, da, h, mi, s] = m
  // Built from parts (not `new Date(string)`) so local-time interpretation
  // never depends on the engine's string-parsing rules.
  const d = new Date(+y, +mo - 1, +da, +h, +mi, s ? +s : 0)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}
