import { describe, expect, it } from 'vitest'
import { isFullyOnSomeDisplay } from './displayFit'

const laptop = { x: 0, y: 0, width: 1440, height: 900 }
const projector = { x: 1440, y: 0, width: 1920, height: 1080 }

describe('isFullyOnSomeDisplay', () => {
  it('accepts a window that exactly covers a display', () => {
    expect(isFullyOnSomeDisplay(projector, [laptop, projector])).toBe(true)
    expect(isFullyOnSomeDisplay({ x: 1440, y: 800, width: 1920, height: 280 }, [laptop, projector])).toBe(true)
  })

  it('rejects a window left where an unplugged display used to be', () => {
    expect(isFullyOnSomeDisplay(projector, [laptop])).toBe(false)
  })

  it('rejects a window the OS moved onto a smaller display at its old size', () => {
    expect(isFullyOnSomeDisplay({ x: 0, y: 0, width: 1920, height: 1080 }, [laptop])).toBe(false)
  })

  it('rejects a window straddling two displays', () => {
    expect(isFullyOnSomeDisplay({ x: 1000, y: 0, width: 1000, height: 500 }, [laptop, projector])).toBe(false)
  })

  it('handles displays at negative coordinates', () => {
    const left = { x: -1920, y: 0, width: 1920, height: 1080 }
    expect(isFullyOnSomeDisplay(left, [left, laptop])).toBe(true)
    expect(isFullyOnSomeDisplay(left, [laptop])).toBe(false)
  })

  it('is false when there are no displays', () => {
    expect(isFullyOnSomeDisplay(laptop, [])).toBe(false)
  })
})
