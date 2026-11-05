import { describe, it, expect } from 'vitest'
import { isPlaybackExpected, shouldRewindLoop } from './videoPlayback'

describe('shouldRewindLoop', () => {
  it('rewinds within the last 0.5s of a normal-length loop', () => {
    expect(shouldRewindLoop(9.4, 10)).toBe(false)
    expect(shouldRewindLoop(9.5, 10)).toBe(true)
    expect(shouldRewindLoop(10, 10)).toBe(true)
  })

  it('does not treat a very short clip as "near end" from the start', () => {
    expect(shouldRewindLoop(0, 0.4)).toBe(false)
    expect(shouldRewindLoop(0.25, 0.4)).toBe(false)
    expect(shouldRewindLoop(0.35, 0.4)).toBe(true) // last quarter
    expect(shouldRewindLoop(0.5, 1.2)).toBe(false)
    expect(shouldRewindLoop(0.9, 1.2)).toBe(true)
  })

  it('never rewinds when the duration is unknown, infinite, or zero', () => {
    expect(shouldRewindLoop(0, NaN)).toBe(false)
    expect(shouldRewindLoop(100, Infinity)).toBe(false)
    expect(shouldRewindLoop(0, 0)).toBe(false)
    expect(shouldRewindLoop(NaN, 10)).toBe(false)
  })
})

describe('isPlaybackExpected', () => {
  const playing = { currentTime: 3, duration: 10, paused: false }

  it('expects updates for a live, unpaused video — including before the first one', () => {
    expect(isPlaybackExpected(true, false, null)).toBe(true)
    expect(isPlaybackExpected(true, false, playing)).toBe(true)
    expect(isPlaybackExpected(true, false, { ...playing, duration: NaN })).toBe(true)
  })

  it('does not expect updates while blacked out or operator-paused', () => {
    expect(isPlaybackExpected(false, false, null)).toBe(false)
    expect(isPlaybackExpected(false, false, playing)).toBe(false)
    expect(isPlaybackExpected(true, true, playing)).toBe(false)
  })

  it('does not expect updates once the projector reports paused', () => {
    expect(isPlaybackExpected(true, false, { ...playing, paused: true })).toBe(false)
  })

  it('does not flag a play-once video that has reached its end', () => {
    expect(isPlaybackExpected(true, false, { currentTime: 10, duration: 10, paused: false })).toBe(
      false
    )
    expect(isPlaybackExpected(true, false, { currentTime: 9.9, duration: 10, paused: false })).toBe(
      false
    )
    expect(isPlaybackExpected(true, false, { currentTime: 9, duration: 10, paused: false })).toBe(
      true
    )
  })
})
