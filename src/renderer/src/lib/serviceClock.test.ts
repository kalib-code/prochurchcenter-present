import { describe, expect, it } from 'vitest'
import { parseStart } from './serviceClock'

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
