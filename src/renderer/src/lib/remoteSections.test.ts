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

describe('findSectionStart cue names', () => {
  const item = song([
    slide('Intro', []),
    slide('Verse 1'),
    slide('Pre-Chorus'),
    slide('Chorus'),
    slide('Verse 2'),
    slide('Chorus 2'),
    slide('Bridge'),
    slide('Tag')
  ])

  it('unknown names never fall back to a first-letter match', () => {
    for (const cue of ['Coda', 'Channel', 'Breakdown', 'Instrumental', 'Interlude', 'Turnaround', 'Post-Chorus', 'Vamp']) {
      expect(findSectionStart(item, 0, cue)).toBeNull()
    }
  })

  it('known names and shortcut keys still match', () => {
    expect(findSectionStart(item, 0, 'Chorus')).toBe(3)
    expect(findSectionStart(item, 3, 'chorus 2')).toBe(5)
    expect(findSectionStart(item, 0, 'C')).toBe(3)
    expect(findSectionStart(item, 0, 'v2')).toBe(4)
    expect(findSectionStart(item, 0, 'Verse 2')).toBe(4)
    expect(findSectionStart(item, 0, ' verse  2 ')).toBe(4)
    expect(findSectionStart(item, 0, '2')).toBe(4)
    expect(findSectionStart(item, 0, 'Verse 02')).toBe(4)
    expect(findSectionStart(item, 0, 'Pre-Chorus')).toBe(2)
    expect(findSectionStart(item, 0, 'prechorus')).toBe(2)
  })

  it('MIDI section-note labels still match', () => {
    expect(findSectionStart(item, 3, 'Intro')).toBe(0)
    expect(findSectionStart(item, 0, 'Pre-Chorus')).toBe(2)
    expect(findSectionStart(item, 0, 'Chorus')).toBe(3)
    expect(findSectionStart(item, 0, 'Bridge')).toBe(6)
    expect(findSectionStart(item, 0, 'Tag')).toBe(7)
    expect(findSectionStart(item, 0, 'Verse 1')).toBe(1)
    const outro = song([slide('Verse 1'), slide('Outro')])
    expect(findSectionStart(outro, 0, 'Outro')).toBe(1)
  })

  it('an unknown name matches a run with that exact label', () => {
    const s = song([slide('Verse 1'), slide('Interlude'), slide('Post-Chorus'), slide('Coda')])
    expect(findSectionStart(s, 0, 'Interlude')).toBe(1)
    expect(findSectionStart(s, 0, 'interlude')).toBe(1)
    expect(findSectionStart(s, 0, 'Post Chorus')).toBe(2)
    expect(findSectionStart(s, 0, 'post-chorus')).toBe(2)
    expect(findSectionStart(s, 0, 'Coda')).toBe(3)
  })

  it('an exact label beats a shortcut-key match', () => {
    const s = song([slide('Verse 1'), slide('Interlude'), slide('Intro')])
    expect(findSectionStart(s, 0, 'Intro')).toBe(2)
    expect(findSectionStart(s, 0, 'Interlude')).toBe(1)
  })
})

describe('findSectionStart known-or-exact matching', () => {
  it('a known cue never lands on an unrecognised look-alike label', () => {
    expect(findSectionStart(song([slide('Verse 1'), slide('Post-Chorus')]), 0, 'Pre-Chorus')).toBeNull()
    expect(findSectionStart(song([slide('Verse 1'), slide('Coda')]), 0, 'Chorus')).toBeNull()
    expect(findSectionStart(song([slide('Verse 1'), slide('Breakdown')]), 0, 'Bridge')).toBeNull()
    expect(findSectionStart(song([slide('Verse 1'), slide('Turnaround')]), 0, 'Tag')).toBeNull()
    expect(findSectionStart(song([slide('Verse 1'), slide('Interlude'), slide('Instrumental')]), 0, 'Intro')).toBeNull()
  })

  it('Prechorus and Post-Chorus resolve to their own runs', () => {
    const s = song([slide('Verse 1'), slide('Pre-Chorus'), slide('Post-Chorus')])
    expect(findSectionStart(s, 0, 'Prechorus')).toBe(1)
    expect(findSectionStart(s, 0, 'Pre Chorus')).toBe(1)
    expect(findSectionStart(s, 0, 'Post-Chorus')).toBe(2)
  })

  it('suffixed labels match by their known prefix', () => {
    expect(findSectionStart(song([slide('Verse 1'), slide('Chorus (x2)')]), 0, 'Chorus')).toBe(1)
    expect(findSectionStart(song([slide('Intro'), slide('Verse 1 (alt)')]), 0, 'Verse 1')).toBe(1)
  })

  it('a single character keeps grid parity (first-letter keys)', () => {
    expect(findSectionStart(song([slide('Verse 1'), slide('Coda')]), 0, 'C')).toBe(1)
  })

  it('a free-text label that merely starts with a section name is not that section', () => {
    expect(findSectionStart(song([slide('Verse 1'), slide('Tagalog')]), 0, 'Tag')).toBeNull()
    expect(findSectionStart(song([slide('Verse 1'), slide('Introit')]), 0, 'Intro')).toBeNull()
  })
})
