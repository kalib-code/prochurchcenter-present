import { describe, expect, it } from 'vitest'
import { selectLastCueSummary, type RemoteActivity } from './useRemoteStore'

const act = (summary: string): RemoteActivity => ({
  at: new Date().toISOString(),
  source: 'osc',
  from: null,
  summary,
  result: { ok: true, position: null }
})

describe('selectLastCueSummary', () => {
  it('is a primitive, so a repeat of the same cue does not re-render the chip', () => {
    const a = selectLastCueSummary({ activity: [act('Next slide')] })
    const b = selectLastCueSummary({ activity: [act('Next slide'), act('Next slide')] })
    expect(Object.is(a, b)).toBe(true)
    expect(a).toBe('Next slide')
  })
  it('is null before any cue', () => {
    expect(selectLastCueSummary({ activity: [] })).toBeNull()
  })
})
