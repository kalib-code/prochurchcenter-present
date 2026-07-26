import { describe, expect, it } from 'vitest'
import {
  formatSeconds,
  videoModeLabel,
  videoProgressPercent,
  videoTimeReadout
} from './videoRunway'

describe('formatSeconds', () => {
  it('formats sub-minute values', () => {
    expect(formatSeconds(5)).toBe('0:05')
    expect(formatSeconds(0)).toBe('0:00')
  })

  it('formats minutes with zero-padded seconds', () => {
    expect(formatSeconds(90)).toBe('1:30')
    expect(formatSeconds(61)).toBe('1:01')
  })

  it('floors fractional seconds', () => {
    expect(formatSeconds(89.9)).toBe('1:29')
  })

  it('clamps NaN, Infinity, and negative values to 0:00', () => {
    expect(formatSeconds(NaN)).toBe('0:00')
    expect(formatSeconds(Infinity)).toBe('0:00')
    expect(formatSeconds(-5)).toBe('0:00')
  })
})

describe('videoModeLabel', () => {
  it('is always the looping label when loop is true, ignoring duration', () => {
    expect(videoModeLabel(true, 90, 30)).toBe('LOOPING · WILL NOT ADVANCE')
    expect(videoModeLabel(true, NaN, 0)).toBe('LOOPING · WILL NOT ADVANCE')
  })

  it('computes the remaining time when duration is finite', () => {
    expect(videoModeLabel(false, 90, 30)).toBe('PLAYS ONCE · ADVANCES IN 1:00')
  })

  it('clamps remaining time to zero when currentTime has drifted past duration', () => {
    expect(videoModeLabel(false, 90, 120)).toBe('PLAYS ONCE · ADVANCES IN 0:00')
  })

  it('shows PLAYS ONCE alone (no placeholder time) while duration is NaN', () => {
    expect(videoModeLabel(false, NaN, 0)).toBe('PLAYS ONCE')
  })

  it('shows PLAYS ONCE alone for an Infinity duration (live stream)', () => {
    expect(videoModeLabel(false, Infinity, 30)).toBe('PLAYS ONCE')
  })
})

describe('videoTimeReadout', () => {
  it('renders elapsed / total in m:ss', () => {
    expect(videoTimeReadout(30, 90)).toBe('0:30 / 1:30')
  })

  it('renders a placeholder total (not 0:00) while duration is not finite', () => {
    expect(videoTimeReadout(5, NaN)).toBe('0:05 / --:--')
    expect(videoTimeReadout(5, Infinity)).toBe('0:05 / --:--')
  })
})

describe('videoProgressPercent', () => {
  it('computes a proportional fill', () => {
    expect(videoProgressPercent(45, 90)).toBe(50)
  })

  it('returns 0 for a non-finite duration instead of NaN', () => {
    expect(videoProgressPercent(5, NaN)).toBe(0)
    expect(videoProgressPercent(5, Infinity)).toBe(0)
  })

  it('returns 0 for a zero or negative duration', () => {
    expect(videoProgressPercent(5, 0)).toBe(0)
    expect(videoProgressPercent(5, -10)).toBe(0)
  })

  it('clamps to 100 when currentTime exceeds duration', () => {
    expect(videoProgressPercent(200, 90)).toBe(100)
  })

  it('clamps to 0 for a negative or non-finite currentTime', () => {
    expect(videoProgressPercent(-5, 90)).toBe(0)
    expect(videoProgressPercent(NaN, 90)).toBe(0)
  })
})
