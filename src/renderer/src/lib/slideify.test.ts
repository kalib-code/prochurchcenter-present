import { describe, it, expect } from 'vitest'
import {
  formatCountdown,
  previewSongSlides,
  slideifySetlist,
  splitBalanced
} from './slideify'
import { parseSongText } from '@shared/parser'
import type { Setlist, Song } from '@shared/types'

function setlistWith(items: Setlist['items']): Setlist {
  return {
    id: 's1',
    name: 'Test',
    date: '2026-07-26',
    items,
    createdAt: '2026-07-26T00:00:00.000Z',
    updatedAt: '2026-07-26T00:00:00.000Z'
  }
}

describe('slideifySetlist with pptx items', () => {
  it('fans a pptx item into one payload per visible slide', () => {
    const result = slideifySetlist(
      setlistWith([
        {
          kind: 'pptx',
          id: 'i1',
          pptxPath: '/decks/announcements.pptx',
          slideCount: 6,
          title: 'announcements'
        }
      ]),
      new Map()
    )

    expect(result).toHaveLength(1)
    expect(result[0].kind).toBe('pptx')
    expect(result[0].label).toBe('announcements')
    expect(result[0].slides).toHaveLength(6)
    expect(result[0].slides.map((s) => s.kind)).toEqual(
      Array(6).fill('pptx-slide')
    )
  })

  it('numbers ordinals 1..N so operator slide numbers match', () => {
    const result = slideifySetlist(
      setlistWith([
        {
          kind: 'pptx',
          id: 'i1',
          pptxPath: '/decks/d.pptx',
          slideCount: 3
        }
      ]),
      new Map()
    )

    const ordinals = result[0].slides.map((s) =>
      s.kind === 'pptx-slide' ? s.slideOrdinal : null
    )
    expect(ordinals).toEqual([1, 2, 3])
  })

  it('falls back to a generic label when title is absent', () => {
    const result = slideifySetlist(
      setlistWith([
        { kind: 'pptx', id: 'i1', pptxPath: '/d.pptx', slideCount: 1 }
      ]),
      new Map()
    )
    expect(result[0].label).toBe('PowerPoint')
  })

  it('drops a deck with no visible slides, matching deck behaviour', () => {
    const result = slideifySetlist(
      setlistWith([
        { kind: 'pptx', id: 'i1', pptxPath: '/d.pptx', slideCount: 0 }
      ]),
      new Map()
    )
    expect(result).toHaveLength(0)
  })

  it('drops a deck with an empty path', () => {
    const result = slideifySetlist(
      setlistWith([{ kind: 'pptx', id: 'i1', pptxPath: '', slideCount: 4 }]),
      new Map()
    )
    expect(result).toHaveLength(0)
  })
})

const nLines = (n: number): string[] => Array.from({ length: n }, (_, i) => `line ${i + 1}`)
const sizes = (chunks: string[][]): number[] => chunks.map((c) => c.length)

describe('splitBalanced', () => {
  it('leaves a slide at or under the limit untouched', () => {
    expect(sizes(splitBalanced(nLines(4), 4))).toEqual([4])
    expect(sizes(splitBalanced(nLines(1), 4))).toEqual([1])
    expect(splitBalanced([], 4)).toEqual([[]])
  })

  it('never strands a lone last line', () => {
    expect(sizes(splitBalanced(nLines(5), 4))).toEqual([3, 2])
    expect(sizes(splitBalanced(nLines(9), 4))).toEqual([3, 3, 3])
    expect(sizes(splitBalanced(nLines(7), 4))).toEqual([4, 3])
    expect(sizes(splitBalanced(nLines(8), 4))).toEqual([4, 4])
    expect(sizes(splitBalanced(nLines(10), 3))).toEqual([3, 3, 2, 2]) // not 3+3+3+1
    expect(sizes(splitBalanced(nLines(10), 4))).toEqual([4, 3, 3])
    expect(sizes(splitBalanced(nLines(3), 2))).toEqual([2, 1]) // unavoidable at max 2
  })

  it('uses the fewest chunks, none over the limit, preserving order', () => {
    for (let max = 2; max <= 6; max++) {
      for (let n = 1; n <= 30; n++) {
        const chunks = splitBalanced(nLines(n), max)
        expect(chunks.length).toBe(Math.ceil(n / max))
        expect(Math.max(...sizes(chunks))).toBeLessThanOrEqual(max)
        expect(Math.max(...sizes(chunks)) - Math.min(...sizes(chunks))).toBeLessThanOrEqual(1)
        expect(chunks.flat()).toEqual(nLines(n))
      }
    }
  })
})

describe('song max-lines splitting', () => {
  const raw = ['[Verse 1]', ...nLines(5), '', '[Chorus]', ...nLines(9)].join('\n')
  const song: Song = {
    id: 'song1',
    title: 'Song',
    author: null,
    ccli: null,
    copyright: null,
    year: null,
    language: 'en',
    categories: [],
    rawText: raw,
    sections: parseSongText(raw),
    notes: '',
    themeOverride: null,
    createdAt: '2026-07-26T00:00:00.000Z',
    updatedAt: '2026-07-26T00:00:00.000Z'
  }

  it('balances chunks in the setlist (projector) path', () => {
    const [rendered] = slideifySetlist(
      setlistWith([{ kind: 'song', id: 'i1', songId: 'song1' }]),
      new Map([['song1', song]]),
      { maxLinesPerSlide: 4, songTransitionSlide: false }
    )
    expect(rendered.slides.map((s) => (s.kind === 'text' ? s.lines.length : -1))).toEqual([
      3, 2, 3, 3, 3
    ])
    expect(rendered.slides.map((s) => (s.kind === 'text' ? s.sectionLabel : null))).toEqual([
      'Verse 1',
      'Verse 1',
      'Chorus',
      'Chorus',
      'Chorus'
    ])
  })

  it('editor preview splits identically to the setlist path', () => {
    const [rendered] = slideifySetlist(
      setlistWith([{ kind: 'song', id: 'i1', songId: 'song1' }]),
      new Map([['song1', song]]),
      { maxLinesPerSlide: 4, songTransitionSlide: false }
    )
    const preview = previewSongSlides(raw, 4)
    expect(preview.map((p) => p.lines)).toEqual(
      rendered.slides.map((s) => (s.kind === 'text' ? s.lines : []))
    )
    expect(preview.map((p) => `${p.slideIndex}/${p.slideCount}`)).toEqual([
      '0/2',
      '1/2',
      '0/3',
      '1/3',
      '2/3'
    ])
  })
})

describe('formatCountdown', () => {
  const now = Date.parse('2026-07-26T09:00:00.000Z')

  it('formats time remaining', () => {
    expect(formatCountdown('2026-07-26T09:15:32.000Z', now)).toBe('15:32')
    expect(formatCountdown('2026-07-26T10:02:45.000Z', now)).toBe('1:02:45')
  })

  it('says "Starting now" once the target has passed', () => {
    expect(formatCountdown('2026-07-26T09:00:00.000Z', now)).toBe('Starting now')
    expect(formatCountdown('2026-07-26T08:00:00.000Z', now)).toBe('Starting now')
  })

  it('shows a neutral placeholder for an unparseable target, not "Starting now"', () => {
    expect(formatCountdown('', now)).toBe('--:--')
    expect(formatCountdown('not a date', now)).toBe('--:--')
    expect(formatCountdown('2026-13-45T99:99', now)).toBe('--:--')
  })
})
