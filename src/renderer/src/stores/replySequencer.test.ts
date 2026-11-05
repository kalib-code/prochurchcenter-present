import { describe, expect, it } from 'vitest'
import { createReplySequencer } from './replySequencer'

describe('createReplySequencer', () => {
  it('applies a lone successful reply immediately', () => {
    const seq = createReplySequencer<number>()
    const a = seq.begin(1)
    expect(seq.succeed(a, 2)).toEqual({ value: 2 })
  })

  it('holds replies while newer requests are in flight, then applies the newest', () => {
    const seq = createReplySequencer<number>()
    const a = seq.begin(0)
    const b = seq.begin(10)
    const c = seq.begin(20)
    // Out of order: c lands first, then the stale a and b.
    expect(seq.succeed(c, 30)).toBeNull()
    expect(seq.succeed(a, 10)).toBeNull()
    expect(seq.succeed(b, 20)).toEqual({ value: 30 })
  })

  it('rolls back to the baseline when the only request fails', () => {
    const seq = createReplySequencer<number>()
    const a = seq.begin(5)
    expect(seq.fail(a)).toEqual({ value: 5 })
  })

  it('rolls back to the newest successful reply when the latest request fails', () => {
    const seq = createReplySequencer<number>()
    const a = seq.begin(0)
    const b = seq.begin(1)
    expect(seq.fail(b)).toBeNull()
    // a's reply arrives after b failed — it is what main actually holds.
    expect(seq.succeed(a, 1)).toEqual({ value: 1 })
  })

  it('takes a fresh baseline once everything has settled', () => {
    const seq = createReplySequencer<number>()
    seq.succeed(seq.begin(0), 1)
    const b = seq.begin(1)
    expect(seq.fail(b)).toEqual({ value: 1 })
  })
})
