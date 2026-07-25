import { describe, it, expect } from 'vitest'
import {
  visibleSlideCount,
  ordinalToSourceIndex,
  type PptxSlideMeta
} from './pptxSlides'

/** Mirrors test-deck.pptx: 5 slides, none hidden. */
const PLAIN: PptxSlideMeta[] = [1, 2, 3, 4, 5].map((sourceIndex) => ({
  sourceIndex,
  hidden: false
}))

/**
 * Mirrors test-deck-hidden.pptx: 7 parts, the 6th hidden. The hidden slide
 * sits in the MIDDLE on purpose — every slide after it shifts, so an
 * off-by-one implementation fails loudly instead of only breaking the last.
 */
const WITH_HIDDEN: PptxSlideMeta[] = [1, 2, 3, 4, 5, 6, 7].map((sourceIndex) => ({
  sourceIndex,
  hidden: sourceIndex === 6
}))

describe('visibleSlideCount', () => {
  it('counts every slide when none are hidden', () => {
    expect(visibleSlideCount(PLAIN)).toBe(5)
  })

  it('excludes hidden slides', () => {
    expect(visibleSlideCount(WITH_HIDDEN)).toBe(6)
  })

  it('returns 0 for an empty deck', () => {
    expect(visibleSlideCount([])).toBe(0)
  })

  it('returns 0 when every slide is hidden', () => {
    expect(visibleSlideCount([{ sourceIndex: 1, hidden: true }])).toBe(0)
  })
})

describe('ordinalToSourceIndex', () => {
  it('maps ordinals straight through when nothing is hidden', () => {
    expect(ordinalToSourceIndex(PLAIN, 1)).toBe(1)
    expect(ordinalToSourceIndex(PLAIN, 5)).toBe(5)
  })

  it('skips the hidden slide', () => {
    expect(ordinalToSourceIndex(WITH_HIDDEN, 5)).toBe(5)
    // ordinal 6 is the slide AFTER the hidden one — source index 7, not 6
    expect(ordinalToSourceIndex(WITH_HIDDEN, 6)).toBe(7)
  })

  it('returns null for ordinals outside the visible range', () => {
    expect(ordinalToSourceIndex(WITH_HIDDEN, 0)).toBeNull()
    expect(ordinalToSourceIndex(WITH_HIDDEN, 7)).toBeNull()
    expect(ordinalToSourceIndex(WITH_HIDDEN, -1)).toBeNull()
  })

  it('returns null for a non-integer ordinal', () => {
    expect(ordinalToSourceIndex(PLAIN, 1.5)).toBeNull()
  })

  it('returns null for an empty deck', () => {
    expect(ordinalToSourceIndex([], 1)).toBeNull()
  })
})
