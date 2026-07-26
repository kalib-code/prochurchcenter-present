import { describe, expect, it } from 'vitest'
import type { SlidePayload } from '@shared/ipc-contract'
import type { NextResolution } from './serviceNext'
import { describeNext, sectionLabelFor, slidePreviewText } from './serviceNextText'

const textSlide = (lines: string[], sectionLabel?: string): SlidePayload => ({
  kind: 'text',
  lines,
  sectionLabel
})

describe('describeNext', () => {
  it('describes the end-of-service resolution', () => {
    const resolution: NextResolution = { kind: 'end' }
    const d = describeNext(resolution)
    expect(d.tag).toBe('END OF SERVICE')
    expect(d.tagTone).toBe('signal')
    expect(d.label).toBe('SERVICE ENDS')
    expect(d.previewText).toBe('—')
    expect(d.hint).toBe('Blacks out the projector and ends the service.')
  })

  it('describes a same-item resolution as neutral, staying inside the current item', () => {
    const resolution: NextResolution = {
      kind: 'same-item',
      slide: textSlide(['line 1'], 'Verse 2'),
      itemLabel: 'Holy Forever',
      itemIndex: 1,
      slideIndex: 3
    }
    const d = describeNext(resolution)
    expect(d.tag).toBe('SAME ITEM')
    expect(d.tagTone).toBe('neutral')
    expect(d.label).toBe('Verse 2')
    expect(d.previewText).toBe('line 1')
    expect(d.hint).toBe('Stays inside Holy Forever.')
  })

  it('describes a new-item resolution as signal, naming both items', () => {
    const resolution: NextResolution = {
      kind: 'new-item',
      slide: textSlide(['p1'], 'Sermon'),
      itemLabel: 'Sermon',
      fromItemLabel: 'Holy Forever',
      itemIndex: 2,
      slideIndex: 0
    }
    const d = describeNext(resolution)
    expect(d.tag).toBe('NEW ITEM')
    expect(d.tagTone).toBe('signal')
    expect(d.hint).toBe('Leaves Holy Forever and starts Sermon.')
  })

  it('never reverses the from/to order in the new-item hint', () => {
    // A reversal ("Leaves Sermon and starts Holy Forever.") reads just
    // as fluently as the correct sentence — the only way to catch a
    // swap is to assert the exact string, not just that both labels
    // appear somewhere in it.
    const resolution: NextResolution = {
      kind: 'new-item',
      slide: textSlide([], undefined),
      itemLabel: 'Closing Song',
      fromItemLabel: 'Announcements',
      itemIndex: 4,
      slideIndex: 0
    }
    const d = describeNext(resolution)
    expect(d.hint).toBe('Leaves Announcements and starts Closing Song.')
    expect(d.hint).not.toBe('Leaves Closing Song and starts Announcements.')
  })
})

describe('sectionLabelFor', () => {
  it('prefers the slide sectionLabel when the slide is text with one set', () => {
    const resolution: NextResolution = {
      kind: 'same-item',
      slide: textSlide(['x'], 'Chorus'),
      itemLabel: 'Holy Forever',
      itemIndex: 0,
      slideIndex: 1
    }
    expect(sectionLabelFor(resolution)).toBe('Chorus')
  })

  it('falls back to the item label for a text slide with no sectionLabel', () => {
    const resolution: NextResolution = {
      kind: 'same-item',
      slide: textSlide(['x'], undefined),
      itemLabel: 'Holy Forever',
      itemIndex: 0,
      slideIndex: 1
    }
    expect(sectionLabelFor(resolution)).toBe('Holy Forever')
  })

  it('falls back to the item label for non-text slide kinds', () => {
    const resolution: NextResolution = {
      kind: 'new-item',
      slide: { kind: 'video', videoPath: '/tmp/a.mp4' },
      itemLabel: 'Welcome Video',
      fromItemLabel: 'Prelude',
      itemIndex: 1,
      slideIndex: 0
    }
    expect(sectionLabelFor(resolution)).toBe('Welcome Video')
  })
})

describe('slidePreviewText', () => {
  it('joins text lines with newlines', () => {
    expect(slidePreviewText(textSlide(['a', 'b', 'c']))).toBe('a\nb\nc')
  })

  it('describes an empty-lines text slide instead of rendering blank', () => {
    expect(slidePreviewText(textSlide([]))).toBe('No lyrics — background only')
  })

  it('labels an image slide', () => {
    expect(slidePreviewText({ kind: 'image', imagePath: '/tmp/a.png' })).toBe('Image')
  })

  it('labels a video slide', () => {
    expect(slidePreviewText({ kind: 'video', videoPath: '/tmp/a.mp4' })).toBe('Video')
  })

  it('labels a pdf-page slide with its page number', () => {
    expect(
      slidePreviewText({ kind: 'pdf-page', pdfPath: '/tmp/a.pdf', pageIndex: 3, pageCount: 10 })
    ).toBe('PDF page 3')
  })

  it('labels a countdown slide', () => {
    expect(
      slidePreviewText({ kind: 'countdown', label: 'Service starts in', targetTime: '2026-01-01T00:00:00.000Z' })
    ).toBe('Countdown')
  })
})
