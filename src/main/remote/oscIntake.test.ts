import { describe, expect, it } from 'vitest'
import { isIPv4 } from '@shared/remote'
import { OSC_MAX_COMMANDS_PER_PACKET, oscPacketToCommands } from './oscIntake'

const pad = (s: string): Buffer => {
  const b = Buffer.from(s + '\0', 'utf8')
  return Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)])
}
const i32 = (n: number): Buffer => {
  const b = Buffer.alloc(4)
  b.writeInt32BE(n)
  return b
}
const msg = (addr: string): Buffer => Buffer.concat([pad(addr), pad(',')])
const bundle = (...els: Buffer[]): Buffer =>
  Buffer.concat([pad('#bundle'), Buffer.alloc(8), ...els.flatMap((e) => [i32(e.length), e])])

describe('oscPacketToCommands', () => {
  it('accepts any sender when allowFrom is null', () => {
    expect(oscPacketToCommands(msg('/present/next'), '10.1.2.3', null)).toEqual([{ type: 'next' }])
  })
  it('only accepts the allowed sender, including IPv4-mapped form', () => {
    const p = msg('/present/next')
    expect(oscPacketToCommands(p, '192.168.1.20', '192.168.1.20')).toHaveLength(1)
    expect(oscPacketToCommands(p, '::ffff:192.168.1.20', '192.168.1.20')).toHaveLength(1)
    expect(oscPacketToCommands(p, '192.168.1.21', '192.168.1.20')).toEqual([])
  })
  it('caps commands per packet', () => {
    const p = bundle(...Array.from({ length: 40 }, () => msg('/present/next')))
    expect(OSC_MAX_COMMANDS_PER_PACKET).toBe(16)
    expect(oscPacketToCommands(p, '1.1.1.1', null)).toHaveLength(16)
  })
  it('returns [] for junk and drops unmapped addresses', () => {
    expect(oscPacketToCommands(Buffer.from('garbage!'), '1.1.1.1', null)).toEqual([])
    expect(oscPacketToCommands(msg('/nope'), '1.1.1.1', null)).toEqual([])
  })
})

describe('isIPv4', () => {
  it('validates dotted quads', () => {
    expect(isIPv4('192.168.1.20')).toBe(true)
    for (const s of ['256.1.1.1', '1.2.3', '1.2.3.4.5', ' 1.2.3.4', 'abc', '', '+1.2.3.4', '1.2.3.-4'])
      expect(isIPv4(s)).toBe(false)
  })
})
