import { describe, expect, it } from 'vitest'
import { layoutLyrics } from './lyricsLayout'
import { moveSection, nextSectionLabel, sectionInsertion } from './lyricsEdit'

const apply = (raw: string, caret: number, label: string): string => {
  const { at, text } = sectionInsertion(raw, caret, label)
  return raw.slice(0, at) + text + raw.slice(at)
}

describe('nextSectionLabel', () => {
  it('numbers verses after the highest existing one', () => {
    const layout = layoutLyrics('[Verse 1]\na\n[Verse 3]\nb\n[Verse]\nc', 4)
    expect(nextSectionLabel('verse', layout)).toBe('Verse 4')
    expect(nextSectionLabel('verse', layoutLyrics('', 4))).toBe('Verse 1')
    expect(nextSectionLabel('chorus', layout)).toBe('Chorus')
  })
})

describe('sectionInsertion', () => {
  it('starts an empty song with the header', () => {
    expect(apply('', 0, 'Verse 1')).toBe('[Verse 1]\n')
  })

  it('adds a blank line and the header after a lyric line', () => {
    const raw = '[Verse 1]\nline one\nline two'
    expect(apply(raw, raw.indexOf('one'), 'Chorus')).toBe('[Verse 1]\nline one\n\n[Chorus]\nline two')
    expect(apply(raw, raw.length, 'Chorus')).toBe('[Verse 1]\nline one\nline two\n\n[Chorus]\n')
  })

  it('reuses an empty line under lyrics, keeping one blank line between', () => {
    const raw = '[Verse 1]\nline one\n'
    expect(apply(raw, raw.length, 'Chorus')).toBe('[Verse 1]\nline one\n\n[Chorus]\n')
  })

  it('writes onto an empty line that already follows a blank line', () => {
    const raw = '[Verse 1]\nline one\n\n'
    expect(apply(raw, raw.length, 'Chorus')).toBe('[Verse 1]\nline one\n\n[Chorus]\n')
  })
})

describe('moveSection', () => {
  const raw = '[Verse 1]\na\n\n[Chorus]\nb\nc\n\n\n[Bridge]\nd\n'
  const layout = layoutLyrics(raw, 4)

  it('moves a section and rejoins with single blank lines', () => {
    expect(moveSection(raw, layout, 2, 0)).toBe('[Bridge]\nd\n\n[Verse 1]\na\n\n[Chorus]\nb\nc\n')
    expect(moveSection(raw, layout, 0, 2)).toBe('[Chorus]\nb\nc\n\n[Bridge]\nd\n\n[Verse 1]\na\n')
  })

  it('never moves headerless lyrics or anything above them', () => {
    const r = 'intro words\n[Chorus]\nb\n[Bridge]\nd'
    const l = layoutLyrics(r, 4)
    expect(moveSection(r, l, 0, 1)).toBe(r)
    expect(moveSection(r, l, 2, 0)).toBe(r)
    expect(moveSection(r, l, 2, 1)).toBe('intro words\n\n[Bridge]\nd\n\n[Chorus]\nb')
  })

  it('keeps every line of the song', () => {
    const moved = moveSection(raw, layout, 1, 2)
    const words = (s: string): string[] => s.split(/\s+/).filter(Boolean).sort()
    expect(words(moved)).toEqual(words(raw))
  })
})
