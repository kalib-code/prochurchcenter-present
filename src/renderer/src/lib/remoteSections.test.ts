import { describe, expect, it } from 'vitest'
import type { RenderableItem } from './slideify'
import { findSectionStart } from './remoteSections'

const slide = (label: string, lines: string[] = ['x']) => ({
  kind: 'text' as const,
  lines,
  sectionLabel: label
})

const song = (slides: RenderableItem['slides']): RenderableItem => ({
  id: 's',
  kind: 'song',
  label: 'Song',
  slides
})

describe('findSectionStart', () => {
  const item = song([
    slide('Intro', []),
    slide('Verse 1'),
    slide('Verse 1'),
    slide('Chorus'),
    slide('Chorus'),
    slide('Verse 2'),
    slide('Chorus'),
    slide('Bridge')
  ])

  it('jumps to the first matching run after the current slide', () => {
    expect(findSectionStart(item, 1, 'C')).toBe(3)
  })
  it('inside a run goes to the next run', () => {
    expect(findSectionStart(item, 4, 'C')).toBe(6)
  })
  it('wraps to the first run from the last run', () => {
    expect(findSectionStart(item, 6, 'C')).toBe(3)
  })
  it('matches verse numbers', () => {
    expect(findSectionStart(item, 0, '2')).toBe(5)
  })
  it('returns null when nothing matches', () => {
    expect(findSectionStart(item, 0, 'X')).toBeNull()
  })
  it('skips the empty transition slide when the run has lyrics', () => {
    const item2 = song([slide('Intro', []), slide('Intro', ['la la'])])
    expect(findSectionStart(item2, 3, 'I')).toBe(1)
  })
  it('keeps an all-empty run start', () => {
    const item3 = song([slide('Intro', []), slide('Verse 1')])
    expect(findSectionStart(item3, 1, 'I')).toBe(0)
  })
})
