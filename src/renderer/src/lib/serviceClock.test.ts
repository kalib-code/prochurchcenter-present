import { describe, expect, it } from 'vitest'
import type { SetlistItem } from '@shared/types'
import { computeSchedule, parseStart } from './serviceClock'

describe('parseStart', () => {
  it('parses a valid time to minutes since midnight', () => {
    expect(parseStart('09:30')).toBe(570)
  })

  it('accepts a single-digit hour', () => {
    expect(parseStart('9:05')).toBe(545)
  })

  it('defaults to 10:00 when absent', () => {
    expect(parseStart(undefined)).toBe(600)
  })

  it('defaults to 10:00 on a malformed string', () => {
    expect(parseStart('not-a-time')).toBe(600)
  })

  it('defaults to 10:00 on an out-of-range time', () => {
    expect(parseStart('25:99')).toBe(600)
  })
})

const video = (id: string, durationMinutes?: number): SetlistItem => ({
  kind: 'video',
  id,
  videoPath: `/tmp/${id}.mp4`,
  durationMinutes
})
const divider = (id: string, durationMinutes?: number): SetlistItem => ({
  kind: 'section-divider',
  id,
  label: 'Worship',
  durationMinutes
})

describe('computeSchedule', () => {
  it('returns an empty schedule for no items', () => {
    const s = computeSchedule([], '10:00')
    expect(s.at).toEqual([])
    expect(s.totalMinutes).toBe(0)
    expect(s.endsAt).toBe('10:00 AM')
  })

  it('starts the first item at the service start time', () => {
    const s = computeSchedule([video('a', 5)], '10:00')
    expect(s.at[0]).toBe('10:00')
  })

  it('accumulates durations across items', () => {
    const s = computeSchedule([video('a', 5), video('b', 10), video('c', 3)], '10:00')
    expect(s.at).toEqual(['10:00', '10:05', '10:15'])
    expect(s.totalMinutes).toBe(18)
    expect(s.endsAt).toBe('10:18 AM')
  })

  it('treats an absent duration as zero', () => {
    const s = computeSchedule([video('a'), video('b', 10)], '10:00')
    expect(s.at).toEqual(['10:00', '10:00'])
    expect(s.totalMinutes).toBe(10)
  })

  // Dividers are grouping only — they never reach the projector, so they
  // cannot consume service time even if a duration was somehow stored.
  it('ignores a duration stored on a section divider', () => {
    const s = computeSchedule([divider('d', 99), video('a', 5)], '10:00')
    expect(s.at).toEqual(['10:00', '10:00'])
    expect(s.totalMinutes).toBe(5)
  })

  it('defaults the start time to 10:00 when absent', () => {
    const s = computeSchedule([video('a', 30)])
    expect(s.at[0]).toBe('10:00')
    expect(s.endsAt).toBe('10:30 AM')
  })

  it('crosses noon with the correct meridiem', () => {
    const s = computeSchedule([video('a', 90)], '11:00')
    expect(s.endsAt).toBe('12:30 PM')
  })

  it('renders midnight as 12:00 AM, not 0:00', () => {
    const s = computeSchedule([video('a', 60)], '23:00')
    expect(s.endsAt).toBe('12:00 AM')
  })

  it('wraps past midnight without going negative', () => {
    const s = computeSchedule([video('a', 120)], '23:00')
    expect(s.endsAt).toBe('1:00 AM')
  })

  it('pads minutes to two digits', () => {
    const s = computeSchedule([video('a', 5)], '9:05')
    expect(s.at[0]).toBe('9:05')
    expect(s.endsAt).toBe('9:10 AM')
  })

  it('falls back to the default start on a malformed start time', () => {
    const s = computeSchedule([video('a', 10)], 'not-a-time')
    expect(s.at[0]).toBe('10:00')
  })
})
