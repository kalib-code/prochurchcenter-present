import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSenderRateLimiter } from './rateLimit'

let now: number
let warn: ReturnType<typeof vi.fn>
const make = (opts = {}) => createSenderRateLimiter({ now: () => now, warn, ...opts })
const passes = (allow: (s: string) => boolean, sender: string, n: number): number => {
  let ok = 0
  for (let i = 0; i < n; i++) if (allow(sender)) ok++
  return ok
}

describe('createSenderRateLimiter', () => {
  beforeEach(() => {
    now = 1_000_000
    warn = vi.fn()
  })

  it('lets a burst of 16 through, then drops', () => {
    const l = make()
    expect(passes(l.allow, '10.0.0.5', 40)).toBe(16)
  })

  it('refills 10 cues per second', () => {
    const l = make()
    passes(l.allow, '10.0.0.5', 40)
    now += 1000
    expect(passes(l.allow, '10.0.0.5', 40)).toBe(10)
    now += 100
    expect(passes(l.allow, '10.0.0.5', 5)).toBe(1)
  })

  it('never refills past the burst capacity', () => {
    const l = make()
    passes(l.allow, '10.0.0.5', 1)
    now += 60_000
    expect(passes(l.allow, '10.0.0.5', 40)).toBe(16)
  })

  it('keeps senders independent', () => {
    const l = make()
    expect(passes(l.allow, '10.0.0.5', 40)).toBe(16)
    expect(passes(l.allow, '10.0.0.6', 40)).toBe(16)
  })

  it('treats an IPv4-mapped IPv6 address as the same sender', () => {
    const l = make()
    expect(passes(l.allow, '::ffff:10.0.0.5', 10)).toBe(10)
    expect(passes(l.allow, '10.0.0.5', 10)).toBe(6)
  })

  it('warns at most once per sender every 10 s', () => {
    const l = make()
    passes(l.allow, '10.0.0.5', 40)
    passes(l.allow, '10.0.0.6', 40)
    expect(warn).toHaveBeenCalledTimes(2)
    expect(warn.mock.calls[0][0]).toContain('[remote]')
    expect(warn.mock.calls[0][0]).toContain('10.0.0.5')
    now += 9_000
    passes(l.allow, '10.0.0.5', 40)
    expect(warn).toHaveBeenCalledTimes(2)
    now += 1_000
    passes(l.allow, '10.0.0.5', 40)
    expect(warn).toHaveBeenCalledTimes(3)
  })

  it('stays bounded: evicts idle senders, then the least recently seen', () => {
    const l = make({ maxSenders: 4 })
    for (const s of ['a', 'b', 'c', 'd']) l.allow(s)
    expect(l.size()).toBe(4)
    now += 61_000
    l.allow('d')
    l.allow('e')
    expect(l.size()).toBe(2) // a, b, c were idle > 60 s
    for (const s of ['f', 'g', 'h']) l.allow(s)
    expect(l.size()).toBe(4)
  })

  it('defaults to 256 senders', () => {
    const l = make()
    for (let i = 0; i < 300; i++) l.allow(`10.0.${i >> 8}.${i & 255}`)
    expect(l.size()).toBe(256)
  })
})
