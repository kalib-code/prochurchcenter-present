import { describe, expect, it } from 'vitest'
import type { Setlist, SetlistItem } from '@shared/types'
import { formatDuration, serviceCountdown } from './serviceCountdown'

function setlist(date: string, items: SetlistItem[] = [], startTime?: string): Setlist {
  return { id: 's', name: 's', date, items, startTime, createdAt: '', updatedAt: '' }
}

const song = (min: number): SetlistItem => ({
  kind: 'song',
  id: String(min),
  songId: 'x',
  durationMinutes: min
})

// Thursday 2026-11-05, local time.
const at = (h: number, m = 0): Date => new Date(2026, 10, 5, h, m)

describe('formatDuration', () => {
  it('formats hours and minutes', () => {
    expect(formatDuration(112)).toBe('1h 52m')
    expect(formatDuration(45)).toBe('45m')
    expect(formatDuration(120)).toBe('2h')
    expect(formatDuration(-3)).toBe('0m')
  })
})

describe('serviceCountdown', () => {
  it('counts down to the start time today', () => {
    const c = serviceCountdown(setlist('2026-11-05', [song(30), song(35)], '10:00'), at(8, 8))
    expect(c.phase).toBe('today')
    expect(c.label).toBe('Starts in 1h 52m')
    expect(c.startsAt).toBe('10:00 AM')
    expect(c.endsAt).toBe('11:05 AM')
  })

  it('is in progress between start and projected end', () => {
    const c = serviceCountdown(setlist('2026-11-05', [song(90)], '10:00'), at(11, 0))
    expect(c.phase).toBe('running')
  })

  it('ends after the projected end', () => {
    const c = serviceCountdown(setlist('2026-11-05', [song(30)], '10:00'), at(10, 45))
    expect(c.phase).toBe('ended')
  })

  it('assumes one hour when no durations are planned', () => {
    const s = setlist('2026-11-05', [], '10:00')
    expect(serviceCountdown(s, at(10, 59)).phase).toBe('running')
    expect(serviceCountdown(s, at(11, 0)).phase).toBe('ended')
    expect(serviceCountdown(s, at(9, 0)).endsAt).toBeNull()
  })

  it('defaults the start to 10:00 AM', () => {
    expect(serviceCountdown(setlist('2026-11-05'), at(9, 30)).label).toBe('Starts in 30m')
  })

  it('says tomorrow, then days away', () => {
    expect(serviceCountdown(setlist('2026-11-06', [], '18:30'), at(9)).label).toBe(
      'Tomorrow at 6:30 PM'
    )
    expect(serviceCountdown(setlist('2026-11-08'), at(9)).label).toBe('In 3 days')
  })

  it('marks earlier dates as past', () => {
    expect(serviceCountdown(setlist('2026-11-01'), at(9)).phase).toBe('ended')
  })
})
