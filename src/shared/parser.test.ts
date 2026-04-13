import { describe, it, expect } from 'vitest'
import { parseSongText, serializeSongSections } from './parser'

describe('parseSongText', () => {
  it('returns empty array for empty input', () => {
    expect(parseSongText('')).toEqual([])
  })

  it('parses a single section with one slide', () => {
    const result = parseSongText('[Verse 1]\nAmazing grace\nHow sweet the sound')
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('verse')
    expect(result[0].label).toBe('Verse 1')
    expect(result[0].slides).toEqual([['Amazing grace', 'How sweet the sound']])
  })

  it('parses multiple sections', () => {
    const input = '[Verse 1]\nLine1\n\n[Chorus]\nLine2'
    const result = parseSongText(input)
    expect(result).toHaveLength(2)
    expect(result[0].label).toBe('Verse 1')
    expect(result[0].type).toBe('verse')
    expect(result[1].label).toBe('Chorus')
    expect(result[1].type).toBe('chorus')
  })

  it('splits slides on blank lines within a section', () => {
    const input = '[Verse]\nLine1\nLine2\n\nLine3\nLine4'
    const result = parseSongText(input)
    expect(result[0].slides).toEqual([
      ['Line1', 'Line2'],
      ['Line3', 'Line4']
    ])
  })

  it("handles content before first header as an 'other' section", () => {
    const input = 'Spoken intro\n\n[Verse 1]\nLyrics'
    const result = parseSongText(input)
    expect(result).toHaveLength(2)
    expect(result[0].type).toBe('other')
    expect(result[0].label).toBe('')
    expect(result[0].slides).toEqual([['Spoken intro']])
    expect(result[1].type).toBe('verse')
  })

  it('normalizes Windows line endings (\\r\\n)', () => {
    const input = '[Verse]\r\nLine1\r\nLine2'
    const result = parseSongText(input)
    expect(result[0].slides).toEqual([['Line1', 'Line2']])
  })

  it('normalizes bare \\r line endings', () => {
    const input = '[Verse]\rLine1\rLine2'
    const result = parseSongText(input)
    expect(result[0].slides).toEqual([['Line1', 'Line2']])
  })

  it('trims leading and trailing whitespace from lines', () => {
    const input = '[Verse]\n  Line with spaces  \n\n  Another  '
    const result = parseSongText(input)
    expect(result[0].slides).toEqual([['Line with spaces'], ['Another']])
  })

  it('drops empty sections silently', () => {
    const input = '[Verse 1]\n\n[Chorus]\nLine1'
    const result = parseSongText(input)
    expect(result).toHaveLength(1)
    expect(result[0].label).toBe('Chorus')
  })

  it('infers section types from label heuristics', () => {
    const input = [
      '[Intro]\nA',
      '[Verse 1]\nB',
      '[Pre-Chorus]\nC',
      '[Chorus]\nD',
      '[Bridge]\nE',
      '[Tag]\nF',
      '[Outro]\nG',
      '[Something weird]\nH'
    ].join('\n\n')
    const result = parseSongText(input)
    expect(result.map((s) => s.type)).toEqual([
      'intro',
      'verse',
      'pre-chorus',
      'chorus',
      'bridge',
      'tag',
      'outro',
      'other'
    ])
  })

  it('handles Tagalog unicode lyrics with accents', () => {
    const input = '[Verse 1]\nAng Pag-ibig ay matiyagâ\nMabait at hindî nagsasalítâ'
    const result = parseSongText(input)
    expect(result[0].slides[0]).toEqual([
      'Ang Pag-ibig ay matiyagâ',
      'Mabait at hindî nagsasalítâ'
    ])
  })

  it('ignores trailing blank lines', () => {
    const input = '[Verse]\nLine1\n\n\n\n'
    const result = parseSongText(input)
    expect(result[0].slides).toEqual([['Line1']])
  })

  it('generates stable deterministic section ids', () => {
    const input = '[Verse 1]\nA\n\n[Chorus]\nB\n\n[Verse 2]\nC'
    const result = parseSongText(input)
    expect(result.map((s) => s.id)).toEqual(['verse-0', 'chorus-1', 'verse-2'])
  })

  it('treats header-like text with extra whitespace as a header', () => {
    const input = '  [Verse 1]  \nLine1'
    const result = parseSongText(input)
    expect(result[0].label).toBe('Verse 1')
  })

  it('preserves mid-line whitespace inside lyrics', () => {
    const input = '[Verse]\nAmazing  grace'
    const result = parseSongText(input)
    expect(result[0].slides[0]).toEqual(['Amazing  grace'])
  })
})

describe('serializeSongSections round-trip', () => {
  const roundTrip = (input: string): void => {
    const parsed = parseSongText(input)
    const serialized = serializeSongSections(parsed)
    const reparsed = parseSongText(serialized)
    expect(reparsed).toEqual(parsed)
  }

  it('round-trips a single section', () => {
    roundTrip('[Verse 1]\nLine1\nLine2')
  })

  it('round-trips multi-section with slide splits', () => {
    roundTrip('[Verse 1]\nA\nB\n\nC\nD\n\n[Chorus]\nE\nF')
  })

  it('round-trips content before first header', () => {
    roundTrip('Spoken intro\n\n[Verse]\nLyrics')
  })

  it('round-trips Tagalog lyrics', () => {
    roundTrip('[Verse 1]\nAng Pag-ibig ay matiyagâ\n\n[Chorus]\nHallelujah')
  })

  it('round-trips a full song structure', () => {
    const input = [
      '[Intro]',
      'Instrumental',
      '',
      '[Verse 1]',
      'Line one',
      'Line two',
      '',
      'Line three',
      'Line four',
      '',
      '[Chorus]',
      'Chorus line',
      '',
      '[Verse 2]',
      'Second verse',
      '',
      '[Bridge]',
      'Bridge line'
    ].join('\n')
    roundTrip(input)
  })
})
