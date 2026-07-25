/**
 * serviceClock — the setlist editor's running clock.
 *
 * Pure: no React, no IPC, no Date.now(). The schedule depends only on its
 * inputs, so the same setlist always renders the same times.
 *
 * Task 1 seeds the time parser; Task 14 adds computeSchedule.
 */

export const DEFAULT_START_MINUTES = 10 * 60 // 10:00
export const MINUTES_PER_DAY = 24 * 60

/**
 * "HH:MM" → minutes since midnight.
 *
 * Falls back to 10:00 on anything invalid rather than throwing: this
 * parses a value that round-trips through JSON on disk, and a corrupt
 * startTime must not be able to break the whole setlist editor.
 */
export function parseStart(startTime: string | undefined): number {
  if (!startTime) return DEFAULT_START_MINUTES
  const m = startTime.match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return DEFAULT_START_MINUTES
  const hours = Number(m[1])
  const minutes = Number(m[2])
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return DEFAULT_START_MINUTES
  }
  return hours * 60 + minutes
}
