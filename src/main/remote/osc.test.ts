import { describe, expect, it } from 'vitest'
import { decodeOscPacket } from './osc'

const pad = (s: string): Buffer => {
  const b = Buffer.from(s + '\0', 'utf8')
  return Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)])
}
const i32 = (n: number): Buffer => {
  const b = Buffer.alloc(4)
  b.writeInt32BE(n)
  return b
}
const f32 = (n: number): Buffer => {
  const b = Buffer.alloc(4)
  b.writeFloatBE(n)
  return b
}
const msg = (addr: string, tags: string | null, ...data: Buffer[]): Buffer =>
  Buffer.concat([pad(addr), ...(tags === null ? [] : [pad(tags)]), ...data])
const bundle = (...els: Buffer[]): Buffer =>
  Buffer.concat([pad('#bundle'), Buffer.alloc(8), ...els.flatMap((e) => [i32(e.length), e])])

describe('decodeOscPacket', () => {
  it('decodes a message with no args', () => {
    expect(decodeOscPacket(msg('/next', ','))).toEqual([{ address: '/next', args: [] }])
  })
  it('decodes i, f, s, T, F args', () => {
    expect(decodeOscPacket(msg('/a', ',i', i32(-7)))[0].args).toEqual([-7])
    expect(decodeOscPacket(msg('/a', ',f', f32(0.5)))[0].args).toEqual([0.5])
    expect(decodeOscPacket(msg('/a', ',s', pad('hello')))[0].args).toEqual(['hello'])
    expect(decodeOscPacket(msg('/a', ',T'))[0].args).toEqual([true])
    expect(decodeOscPacket(msg('/a', ',F'))[0].args).toEqual([false])
  })
  it('flattens bundles in order', () => {
    const p = bundle(msg('/one', ','), bundle(msg('/two', ',i', i32(2))))
    expect(decodeOscPacket(p)).toEqual([
      { address: '/one', args: [] },
      { address: '/two', args: [2] }
    ])
  })
  it('caps bundle depth', () => {
    let p = msg('/deep', ',')
    for (let i = 0; i < 8; i++) p = bundle(p)
    expect(decodeOscPacket(p)).toEqual([])
  })
  it('never throws on junk', () => {
    expect(decodeOscPacket(Buffer.alloc(0))).toEqual([])
    expect(decodeOscPacket(msg('/a', ',i', i32(1)).subarray(0, 10))).toEqual([])
    expect(decodeOscPacket(msg('/a', ',x', i32(1)))).toEqual([])
    expect(decodeOscPacket(Buffer.from('garbage!'))).toEqual([])
    expect(decodeOscPacket(Buffer.concat([pad('#bundle'), Buffer.alloc(8), i32(999)]))).toEqual([])
  })
  it('treats a missing type-tag string as no args', () => {
    expect(decodeOscPacket(msg('/old', null))).toEqual([{ address: '/old', args: [] }])
  })
})
