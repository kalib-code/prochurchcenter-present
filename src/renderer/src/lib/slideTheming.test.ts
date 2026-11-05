/**
 * Tests for the shared themed-slide-card style calculation used by both
 * SlideCard.tsx (Service Mode's grid) and SongEditor.tsx's
 * SlidePreviewCard (the Song Editor's own grid). The whole point of the
 * extraction was to make it impossible for these two grids to silently
 * disagree on how a theme's colors/fonts translate to CSS — these tests
 * pin the actual computed values so a future change to either grid has
 * to change this shared module (and this file) rather than drifting one
 * copy out of sync with the other.
 */

import { describe, expect, it } from 'vitest'
import type { Theme } from '@shared/types'
import { fileUrl, themedBodyStyle, themedTextStyle } from './slideTheming'

const BASE_THEME: Theme = {
  id: 'test-theme',
  name: 'Test',
  backgroundColor: '#101822',
  backgroundImagePath: null,
  backgroundVideoPath: null,
  textColor: '#ECE9E4',
  fontFamily: 'Inter, system-ui, sans-serif',
  fontWeight: 600,
  fontStyle: 'normal',
  fontSizePercent: 100,
  textAlign: 'center',
  textPosition: 'center',
  textEffect: 'none',
  highlightColor: '#E23C0F',
  transition: 'fade',
  transitionDurationMs: 200,
  logoPath: null
}

describe('fileUrl', () => {
  it('builds a present-media:// URL for a local path', () => {
    expect(fileUrl('/Users/rose/Media/bg.jpg')).toBe(
      'present-media://local/Users/rose/Media/bg.jpg'
    )
  })

  it('percent-encodes spaces and other special characters', () => {
    expect(fileUrl('/Users/rose/Media/Paint Sweeps.png')).toBe(
      'present-media://local/Users/rose/Media/Paint%20Sweeps.png'
    )
  })
})

describe('themedBodyStyle', () => {
  it('uses the theme background colour when there is no image', () => {
    const style = themedBodyStyle(BASE_THEME)
    expect(style.backgroundColor).toBe('#101822')
    expect(style.backgroundImage).toBeUndefined()
  })

  it('resolves a background image through fileUrl and sets cover/center sizing', () => {
    const theme: Theme = { ...BASE_THEME, backgroundImagePath: '/media/bg.jpg' }
    const style = themedBodyStyle(theme)
    expect(style.backgroundImage).toBe(`url(${fileUrl('/media/bg.jpg')})`)
    expect(style.backgroundSize).toBe('cover')
    expect(style.backgroundPosition).toBe('center')
  })

  it('skips the image when showImage is false, even if the theme has one', () => {
    const theme: Theme = { ...BASE_THEME, backgroundImagePath: '/media/bg.jpg' }
    const style = themedBodyStyle(theme, false)
    expect(style.backgroundImage).toBeUndefined()
    // color fallback still applies underneath whatever is covering it
    expect(style.backgroundColor).toBe('#101822')
  })

  it('falls back to black when there is no theme at all', () => {
    expect(themedBodyStyle(null).backgroundColor).toBe('#000000')
    expect(themedBodyStyle(undefined).backgroundColor).toBe('#000000')
  })
})

describe('themedTextStyle', () => {
  it('returns an empty style when there is no theme yet', () => {
    expect(themedTextStyle(null)).toEqual({})
    expect(themedTextStyle(undefined)).toEqual({})
  })

  it('picks up the theme text colour and font family', () => {
    const style = themedTextStyle(BASE_THEME)
    expect(style.color).toBe('#ECE9E4')
    expect(style.fontFamily).toBe('Inter, system-ui, sans-serif')
  })

  it('uses the theme weight and style so previews match the projector', () => {
    const style = themedTextStyle({ ...BASE_THEME, fontWeight: 300, fontStyle: 'italic' })
    expect(style.fontWeight).toBe(300)
    expect(style.fontStyle).toBe('italic')
  })

  it('adds a legibility shadow when a background image is showing', () => {
    const theme: Theme = { ...BASE_THEME, backgroundImagePath: '/media/bg.jpg' }
    const style = themedTextStyle(theme)
    expect(style.textShadow).toBe('0 1px 2px rgba(0,0,0,0.85)')
  })

  it('omits the shadow when there is no background image', () => {
    const style = themedTextStyle(BASE_THEME)
    expect(style.textShadow).toBeUndefined()
  })

  it('omits the shadow when showImage is false, even with an image set', () => {
    const theme: Theme = { ...BASE_THEME, backgroundImagePath: '/media/bg.jpg' }
    const style = themedTextStyle(theme, false)
    expect(style.textShadow).toBeUndefined()
  })
})
