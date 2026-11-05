import { describe, expect, it } from 'vitest'
import { previewSongSlides } from './slideify'
import { layoutLyrics, lineAtOffset, offsetOfLine, sectionChip, slideAtLine } from './lyricsLayout'

const HOLY = `[Intro]
(Holy)
(Holy)

[Verse 1]
A thousand generations falling down in worship
To sing the song of ages to the Lamb
And all who've gone before us, and all who will believe
Will sing the song of ages to the Lamb

[Chorus]
Holy forever

[Bridge]`

const FIXTURES: Record<string, string> = {
  holy: HOLY,
  headerless: 'Line one\nLine two\n\nLine three',
  messy: '\n\n  [Verse]  \n  a \n b\n c\n\n\n d \n[Chorus]\n\n e\n[Empty]\n[Tag]\nf',
  crlf: '[Verse 1]\r\none\r\ntwo\r\n\r\nthree',
  empty: '',
  onlyHeaders: '[Verse 1]\n[Chorus]'
}

describe('layoutLyrics', () => {
  it.each(Object.entries(FIXTURES))(
    'produces exactly the slides previewSongSlides does (%s)',
    (_name, raw) => {
      for (const max of [2, 3, 4]) {
        const layout = layoutLyrics(raw, max)
        const preview = previewSongSlides(raw, max)
        expect(layout.slides.map((s) => s.lines)).toEqual(preview.map((p) => p.lines))
        expect(layout.slides.map((s) => s.sectionLabel)).toEqual(preview.map((p) => p.sectionLabel))
      }
    }
  )

  it('numbers slides on their first line and marks automatic splits', () => {
    const layout = layoutLyrics(HOLY, 2)
    // Verse 1 has 4 lines → split into two slides of 2 at max 2.
    expect(layout.lines[5]).toMatchObject({ kind: 'text', slide: 1, slideStart: true, autoSplit: false })
    expect(layout.lines[6]).toMatchObject({ slide: 1, slideStart: false })
    expect(layout.lines[7]).toMatchObject({ slide: 2, slideStart: true, autoSplit: true })
  })

  it('lists sections with slide counts, including empty ones', () => {
    const layout = layoutLyrics(HOLY, 2)
    expect(
      layout.sections.map((s) => [s.label, s.chip, s.slideCount, s.headerLine, s.startLine, s.endLine])
    ).toEqual([
      ['Intro', 'I', 1, 0, 0, 4],
      ['Verse 1', 'V1', 2, 4, 4, 10],
      ['Chorus', 'C', 1, 10, 10, 13],
      ['Bridge', 'B', 0, 13, 13, 14]
    ])
    expect(layout.sections[3].firstSlide).toBeNull()
  })

  it('treats lyrics before the first header as a headerless section', () => {
    const layout = layoutLyrics('one\ntwo\n[Chorus]\nthree', 4)
    expect(layout.sections[0]).toMatchObject({ label: '', headerLine: null, startLine: 0, endLine: 2 })
  })
})

describe('slideAtLine', () => {
  const layout = layoutLyrics(HOLY, 2)
  it('maps text, header and blank lines to a slide', () => {
    expect(slideAtLine(layout, 6)).toBe(1) // text
    expect(slideAtLine(layout, 4)).toBe(1) // [Verse 1] header → its first slide
    expect(slideAtLine(layout, 9)).toBe(2) // blank after verse → slide above
    expect(slideAtLine(layout, 13)).toBeNull() // empty [Bridge] → nothing after it
  })
})

describe('offset helpers', () => {
  it('convert between offsets and line numbers', () => {
    const t = 'ab\ncd\n\nef'
    expect(lineAtOffset(t, 0)).toBe(0)
    expect(lineAtOffset(t, 3)).toBe(1)
    expect(lineAtOffset(t, t.length)).toBe(3)
    expect(offsetOfLine(t, 3)).toBe(7)
    expect(offsetOfLine(t, 9)).toBe(t.length)
  })
})

describe('sectionChip', () => {
  it('abbreviates by type', () => {
    expect(sectionChip('Verse 2', 'verse')).toBe('V2')
    expect(sectionChip('Pre-Chorus', 'pre-chorus')).toBe('PC')
    expect(sectionChip('Ending', 'other')).toBe('E')
  })
})
