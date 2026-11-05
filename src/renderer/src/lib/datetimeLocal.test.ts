import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { isoToLocalInput, localInputToIso } from './datetimeLocal'

// Node re-reads process.env.TZ on assignment, so stubbing it here switches
// the zone for every Date created after this point in the file.
beforeAll(() => {
  vi.stubEnv('TZ', 'Asia/Manila')
})
afterAll(() => {
  vi.unstubAllEnvs()
})

describe('datetime-local conversions (Asia/Manila, UTC+8)', () => {
  it('actually runs in UTC+8', () => {
    expect(new Date('2026-11-08T00:00:00Z').getTimezoneOffset()).toBe(-480)
  })

  it('shows a UTC ISO as Manila wall-clock time', () => {
    expect(isoToLocalInput('2026-11-08T01:45:00.000Z')).toBe('2026-11-08T09:45')
  })

  it('crosses the date line correctly', () => {
    expect(isoToLocalInput('2026-11-07T20:30:00.000Z')).toBe('2026-11-08T04:30')
  })

  it('parses Manila wall-clock input back to UTC', () => {
    expect(localInputToIso('2026-11-08T09:45')).toBe('2026-11-08T01:45:00.000Z')
  })

  it('round-trips without drifting (the old slice/parse shifted 8h per edit)', () => {
    const iso = '2026-11-08T01:45:00.000Z'
    let v = iso
    for (let i = 0; i < 3; i++) v = localInputToIso(isoToLocalInput(v))!
    expect(v).toBe(iso)
  })

  it('accepts a seconds component', () => {
    expect(localInputToIso('2026-11-08T09:45:30')).toBe('2026-11-08T01:45:30.000Z')
  })

  it('returns null for a cleared or partial field instead of throwing', () => {
    expect(localInputToIso('')).toBeNull()
    expect(localInputToIso('2026-11-08')).toBeNull()
    expect(localInputToIso('garbage')).toBeNull()
  })

  it('renders an empty input for a missing or invalid ISO', () => {
    expect(isoToLocalInput(undefined)).toBe('')
    expect(isoToLocalInput('')).toBe('')
    expect(isoToLocalInput('not a date')).toBe('')
  })
})
