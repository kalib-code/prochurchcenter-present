/**
 * serviceClock — the setlist editor's running clock.
 *
 * Pure: no React, no IPC, no Date.now(). The schedule depends only on its
 * inputs, so the same setlist always renders the same times.
 *
 * Task 1 seeds the time parser; Task 14 adds computeSchedule.
 */

import type { SetlistItem } from '@shared/types'

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

export interface Schedule {
  /** Wall-clock start per item, "H:MM", parallel to the input array. */
  at: string[]
  totalMinutes: number
  /** Projected end, "H:MM AM/PM". */
  endsAt: string
}

/** Minutes since midnight → "H:MM", 12-hour, no meridiem. */
function formatClock(totalMinutes: number): string {
  const wrapped = ((totalMinutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
  const h24 = Math.floor(wrapped / 60)
  const mm = wrapped % 60
  // 0 renders as 12 (midnight), 13 as 1, and 12 stays 12 (noon).
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h12}:${String(mm).padStart(2, '0')}`
}

/** Minutes since midnight → "H:MM AM/PM". */
function formatClockMeridiem(totalMinutes: number): string {
  const wrapped = ((totalMinutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
  const meridiem = Math.floor(wrapped / 60) < 12 ? 'AM' : 'PM'
  return `${formatClock(wrapped)} ${meridiem}`
}

/**
 * Section dividers never reach the projector, so they cannot consume
 * service time — even if a duration somehow got stored on one.
 */
function durationOf(item: SetlistItem): number {
  if (item.kind === 'section-divider') return 0
  const d = item.durationMinutes
  if (typeof d !== 'number' || !Number.isFinite(d) || d < 0) return 0
  return Math.floor(d)
}

export function computeSchedule(items: SetlistItem[], startTime?: string): Schedule {
  const start = parseStart(startTime)
  const at: string[] = []
  let running = start

  for (const item of items) {
    // Record the time this item BEGINS, then advance past it.
    at.push(formatClock(running))
    running += durationOf(item)
  }

  return {
    at,
    totalMinutes: running - start,
    endsAt: formatClockMeridiem(running)
  }
}
