import { describe, expect, it } from 'vitest'
import { packScripture, scriptureCharBudget } from './scriptureSlides'

/** A verse of exactly `n` characters made of short words. */
function verse(n: number, word = 'grace'): string {
  let s = ''
  while (s.length < n) s += (s ? ' ' : '') + word
  return s.slice(0, n).trimEnd()
}

const joined = (slides: string[][]): string => slides.flat().join(' ').replace(/\s+/g, ' ')

describe('packScripture', () => {
  it('keeps a single ordinary verse (John 3:16) on one slide', () => {
    const john316 =
      'For God so loved the world, that he gave his one and only Son, that whoever believes in him should not perish, but have eternal life.'
    expect(packScripture(john316, 4)).toEqual([[john316]])
  })

  it('does not stack long verses onto one slide just because the line count fits', () => {
    // Four ~130-char verses used to land on one slide (4 lines ≤ maxLines 4)
    // and auto-fit shrank them unreadably small.
    const text = [verse(130), verse(130), verse(130), verse(130)].join('\n')
    const slides = packScripture(text, 4)
    expect(slides.length).toBeGreaterThanOrEqual(3)
    for (const s of slides) {
      expect(s.join(' ').length).toBeLessThanOrEqual(scriptureCharBudget(4))
    }
  })

  it('packs several short verses together but never exceeds maxLines lines', () => {
    const text = Array.from({ length: 10 }, () => verse(20)).join('\n')
    const slides = packScripture(text, 4)
    for (const s of slides) expect(s.length).toBeLessThanOrEqual(4)
    expect(slides.flat()).toHaveLength(10)
  })

  it('splits one very long verse across slides at punctuation without losing text', () => {
    const long =
      'Paul, a prisoner of Christ Jesus, and Timothy our brother, to Philemon our beloved fellow worker; ' +
      'and to the beloved Apphia, and to Archippus our fellow soldier, and to the church in your house: ' +
      'grace to you and peace from God our Father and the Lord Jesus Christ.'
    const slides = packScripture(long, 2) // budget 90
    expect(slides.length).toBeGreaterThan(1)
    for (const s of slides) expect(s.join(' ').length).toBeLessThanOrEqual(scriptureCharBudget(2))
    expect(joined(slides)).toBe(long)
    // Prefers clause boundaries: the first slide ends on punctuation.
    expect(slides[0].join(' ')).toMatch(/[,;:.]$/)
  })

  it('falls back to word boundaries when a clause has no punctuation', () => {
    const run = verse(300)
    const slides = packScripture(run, 2)
    for (const s of slides) {
      expect(s.join(' ').length).toBeLessThanOrEqual(scriptureCharBudget(2))
      for (const line of s) expect(line).not.toMatch(/^\s|\s$/)
    }
    expect(joined(slides)).toBe(run)
  })

  it('treats a blank line typed by the operator as a hard slide break', () => {
    const slides = packScripture('Jesus wept.\n\nRejoice always.', 4)
    expect(slides).toEqual([['Jesus wept.'], ['Rejoice always.']])
  })

  it('fits more per slide when the operator raises max lines', () => {
    const text = Array.from({ length: 8 }, () => verse(60)).join('\n')
    expect(packScripture(text, 8).length).toBeLessThan(packScripture(text, 3).length)
  })

  it('returns no slides for empty or whitespace-only text', () => {
    expect(packScripture('', 4)).toEqual([])
    expect(packScripture('  \n\n  ', 4)).toEqual([])
  })
})
