/**
 * Tests for the pure override-editing helpers behind ThemeOverrideEditor.
 *
 * These cover the two things Task 12 exists to get right:
 *   1. Promotion is a visual no-op — adding a field to the override must
 *      never change the effective (merged) theme, for every control kind,
 *      including the background-media row across all three global states
 *      it can be in.
 *   2. The two-key background-media problem — backgroundImagePath and
 *      backgroundVideoPath are treated as ONE logical field everywhere
 *      (overridden-detection, revert, extension routing, display value).
 */

import { describe, expect, it } from 'vitest'
import type { Theme, ThemeOverride } from '@shared/types'
import { THEME_FIELDS, type ThemeFieldDef } from './themeFields'
import { mergeThemeOverride } from './themeOverride'
import {
  applyOverridePatch,
  effectiveDisplayValue,
  fieldPatch,
  fieldsPatch,
  isFieldOverridden,
  isVideoPath,
  pickField,
  promoteField,
  revertField
} from './themeOverrideFields'

const BASE_THEME: Theme = {
  id: 'test-theme',
  name: 'Test',
  backgroundColor: '#000000',
  backgroundImagePath: null,
  backgroundVideoPath: null,
  textColor: '#FFFFFF',
  fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
  fontSizePercent: 100,
  textAlign: 'center',
  textPosition: 'center',
  textEffect: 'none',
  highlightColor: '#E23C0F',
  transition: 'fade',
  transitionDurationMs: 200,
  logoPath: null
}

function fieldByKey(key: string): ThemeFieldDef {
  const def = THEME_FIELDS.find((f) => f.key === key)
  if (!def) throw new Error(`No THEME_FIELDS entry for ${key}`)
  return def
}

/** Narrows to the 'file' variant — asserts rather than silently widening,
 * since a wrong key here would otherwise fail deep inside a test with a
 * confusing "companionKey doesn't exist" TS error instead of at the source. */
function fileFieldByKey(key: string): Extract<ThemeFieldDef, { kind: 'file' }> {
  const def = fieldByKey(key)
  if (def.kind !== 'file') throw new Error(`THEME_FIELDS entry for ${key} is not a 'file' field`)
  return def
}

const textAlignDef = fieldByKey('textAlign') // seg
const textColorDef = fieldByKey('textColor') // swatch
const fontSizeDef = fieldByKey('fontSizePercent') // step
const fontFamilyDef = fieldByKey('fontFamily') // select
const backgroundMediaDef = fileFieldByKey('backgroundImagePath') // file, with companionKey
const logoDef = fileFieldByKey('logoPath') // file, no companionKey

describe('isVideoPath', () => {
  it('matches every extension dialog.ts\'s video filter offers', () => {
    for (const ext of ['mp4', 'mov', 'webm', 'mkv', 'm4v']) {
      expect(isVideoPath(`/media/clip.${ext}`)).toBe(true)
    }
  })

  it('is case-insensitive', () => {
    expect(isVideoPath('/media/CLIP.MP4')).toBe(true)
  })

  it('treats a compound filename by its trailing extension only', () => {
    expect(isVideoPath('/media/file.mp4.jpg')).toBe(false)
    expect(isVideoPath('/media/file.jpg.mp4')).toBe(true)
  })

  it('treats a non-video extension as not-a-video', () => {
    expect(isVideoPath('/media/bg.jpg')).toBe(false)
    expect(isVideoPath('/media/no-extension')).toBe(false)
  })
})

describe('isFieldOverridden', () => {
  it('is false when the override is empty', () => {
    expect(isFieldOverridden(textColorDef, {})).toBe(false)
    expect(isFieldOverridden(backgroundMediaDef, {})).toBe(false)
  })

  it('is true for an ordinary field once its key is present', () => {
    expect(isFieldOverridden(textColorDef, { textColor: '#FF0000' })).toBe(true)
  })

  // The original bug: the naive check only ever tested backgroundImagePath.
  it('reports the media row as overridden when only backgroundVideoPath is set', () => {
    const override: ThemeOverride = { backgroundVideoPath: '/media/clip.mp4' }
    expect(isFieldOverridden(backgroundMediaDef, override)).toBe(true)
  })

  it('reports the media row as overridden when only backgroundImagePath is set', () => {
    const override: ThemeOverride = { backgroundImagePath: '/media/bg.jpg' }
    expect(isFieldOverridden(backgroundMediaDef, override)).toBe(true)
  })

  it('reports the media row as inherited when neither key is present', () => {
    expect(isFieldOverridden(backgroundMediaDef, { textColor: '#FFFFFF' })).toBe(false)
  })
})

describe('effectiveDisplayValue — background-media row', () => {
  it('prefers the video path when both image and video are set', () => {
    const theme: Theme = {
      ...BASE_THEME,
      backgroundImagePath: '/media/bg.jpg',
      backgroundVideoPath: '/media/clip.mp4'
    }
    expect(effectiveDisplayValue(backgroundMediaDef, theme)).toBe('/media/clip.mp4')
  })

  it('falls back to the image path when only the image is set', () => {
    const theme: Theme = { ...BASE_THEME, backgroundImagePath: '/media/bg.jpg' }
    expect(effectiveDisplayValue(backgroundMediaDef, theme)).toBe('/media/bg.jpg')
  })

  it('is null when neither is set', () => {
    expect(effectiveDisplayValue(backgroundMediaDef, BASE_THEME)).toBeNull()
  })
})

describe('fieldPatch / fieldsPatch', () => {
  it('fieldPatch builds a single-key patch', () => {
    expect(fieldPatch('textColor', '#FF0000')).toEqual({ textColor: '#FF0000' })
  })

  it('fieldsPatch builds a multi-key patch from entries', () => {
    expect(
      fieldsPatch([
        ['backgroundImagePath', '/a.jpg'],
        ['backgroundVideoPath', null]
      ])
    ).toEqual({ backgroundImagePath: '/a.jpg', backgroundVideoPath: null })
  })
})

describe('applyOverridePatch', () => {
  it('merges a patch onto the existing override', () => {
    const result = applyOverridePatch({ textColor: '#FFFFFF' }, { fontSizePercent: 120 })
    expect(result).toEqual({ textColor: '#FFFFFF', fontSizePercent: 120 })
  })

  it('drops null/undefined patch values instead of persisting them as explicit overrides', () => {
    const result = applyOverridePatch(
      { backgroundImagePath: '/a.jpg' },
      { backgroundImagePath: null, backgroundVideoPath: '/b.mp4' }
    )
    expect(result).toEqual({ backgroundVideoPath: '/b.mp4' })
  })
})

describe('revertField — background-media row', () => {
  it('deletes both backgroundImagePath and backgroundVideoPath, leaving other fields alone', () => {
    const override: ThemeOverride = {
      backgroundImagePath: '/media/bg.jpg',
      backgroundVideoPath: null,
      textColor: '#FFFFFF'
    }
    const reverted = revertField(override, backgroundMediaDef)
    expect(reverted).not.toHaveProperty('backgroundImagePath')
    expect(reverted).not.toHaveProperty('backgroundVideoPath')
    expect(reverted.textColor).toBe('#FFFFFF')
  })

  it('is idempotent', () => {
    const override: ThemeOverride = { backgroundVideoPath: '/media/clip.mp4' }
    const once = revertField(override, backgroundMediaDef)
    const twice = revertField(once, backgroundMediaDef)
    expect(twice).toEqual(once)
  })

  it('deletes only the single key for a field with no companion', () => {
    const override: ThemeOverride = { logoPath: '/media/logo.png', textColor: '#FFFFFF' }
    const reverted = revertField(override, logoDef)
    expect(reverted).toEqual({ textColor: '#FFFFFF' })
  })
})

describe('pickField — routes by extension like ThemeFields.tsx', () => {
  it('routes a .mp4 pick to backgroundVideoPath and clears backgroundImagePath', () => {
    const next = pickField({}, backgroundMediaDef, '/media/clip.mp4')
    expect(next.backgroundVideoPath).toBe('/media/clip.mp4')
    expect(next).not.toHaveProperty('backgroundImagePath')
  })

  it('routes a .jpg pick to backgroundImagePath and clears a previously-set backgroundVideoPath', () => {
    const next = pickField(
      { backgroundVideoPath: '/media/old.mp4' },
      backgroundMediaDef,
      '/media/bg.jpg'
    )
    expect(next.backgroundImagePath).toBe('/media/bg.jpg')
    expect(next).not.toHaveProperty('backgroundVideoPath')
  })

  it('treats an uppercase .MP4 extension as video', () => {
    const next = pickField({}, backgroundMediaDef, '/media/CLIP.MP4')
    expect(next.backgroundVideoPath).toBe('/media/CLIP.MP4')
    expect(next).not.toHaveProperty('backgroundImagePath')
  })

  it('treats a compound filename like file.mp4.jpg as an image, not a video', () => {
    const next = pickField({}, backgroundMediaDef, '/media/file.mp4.jpg')
    expect(next.backgroundImagePath).toBe('/media/file.mp4.jpg')
    expect(next).not.toHaveProperty('backgroundVideoPath')
  })

  it('routes a file field with no companion straight onto its own key', () => {
    const next = pickField({}, logoDef, '/media/logo.png')
    expect(next).toEqual({ logoPath: '/media/logo.png' })
  })
})

describe('promoteField — promotion is a visual no-op', () => {
  it.each([
    ['seg field (textAlign)', textAlignDef],
    ['swatch field (textColor)', textColorDef],
    ['step field (fontSizePercent)', fontSizeDef],
    ['select field (fontFamily)', fontFamilyDef],
    ['file field with no companion (logoPath)', logoDef]
  ])('promoting %s does not change the effective theme', (_label, def) => {
    const override: ThemeOverride = {}
    const before = mergeThemeOverride(BASE_THEME, override)
    const promoted = promoteField(override, def, BASE_THEME)
    const after = mergeThemeOverride(BASE_THEME, promoted)

    expect(after).toEqual(before)
    expect(isFieldOverridden(def, promoted)).toBe(true)
  })

  it('does not disturb fields already overridden by other promotions', () => {
    const override: ThemeOverride = { textColor: '#123456' }
    const before = mergeThemeOverride(BASE_THEME, override)
    const promoted = promoteField(override, fontSizeDef, BASE_THEME)
    const after = mergeThemeOverride(BASE_THEME, promoted)

    expect(after).toEqual(before)
    expect(promoted.textColor).toBe('#123456')
    expect(isFieldOverridden(fontSizeDef, promoted)).toBe(true)
  })
})

describe('promoteField — background-media row across global-theme states', () => {
  it('is a no-op when the global theme has an image only', () => {
    const global: Theme = {
      ...BASE_THEME,
      backgroundImagePath: '/media/bg.jpg',
      backgroundVideoPath: null
    }
    const before = mergeThemeOverride(global, {})
    const promoted = promoteField({}, backgroundMediaDef, global)
    const after = mergeThemeOverride(global, promoted)

    expect(after).toEqual(before)
    expect(isFieldOverridden(backgroundMediaDef, promoted)).toBe(true)
  })

  it('is a no-op when the global theme has a video only', () => {
    const global: Theme = {
      ...BASE_THEME,
      backgroundImagePath: null,
      backgroundVideoPath: '/media/clip.mp4'
    }
    const before = mergeThemeOverride(global, {})
    const promoted = promoteField({}, backgroundMediaDef, global)
    const after = mergeThemeOverride(global, promoted)

    expect(after).toEqual(before)
    expect(isFieldOverridden(backgroundMediaDef, promoted)).toBe(true)
  })

  it('is a no-op when the global theme has neither image nor video set', () => {
    const global: Theme = {
      ...BASE_THEME,
      backgroundImagePath: null,
      backgroundVideoPath: null
    }
    const before = mergeThemeOverride(global, {})
    const promoted = promoteField({}, backgroundMediaDef, global)
    const after = mergeThemeOverride(global, promoted)

    expect(after).toEqual(before)
    // Still becomes editable even though both underlying values are null.
    expect(isFieldOverridden(backgroundMediaDef, promoted)).toBe(true)
  })
})
