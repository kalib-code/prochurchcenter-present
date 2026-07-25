import { describe, expect, it } from 'vitest'
import { THEME_FIELDS, formatFieldValue } from './themeFields'

describe('THEME_FIELDS', () => {
  it('covers the twelve overridable fields', () => {
    expect(THEME_FIELDS).toHaveLength(12)
  })

  it('has a unique key per field', () => {
    const keys = THEME_FIELDS.map((f) => f.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('groups fields into the design’s six sections', () => {
    const groups = new Set(THEME_FIELDS.map((f) => f.group))
    expect(groups).toEqual(
      new Set(['TYPE', 'BACKDROP', 'PLACEMENT', 'LEGIBILITY', 'MOTION', 'STANDBY'])
    )
  })

  it('gives every seg and swatch field at least two options', () => {
    for (const f of THEME_FIELDS) {
      if (f.kind === 'seg' || f.kind === 'swatch') {
        expect(f.options.length).toBeGreaterThanOrEqual(2)
      }
    }
  })

  it('gives every step field a coherent range', () => {
    for (const f of THEME_FIELDS) {
      if (f.kind === 'step') {
        expect(f.min).toBeLessThan(f.max)
        expect(f.step).toBeGreaterThan(0)
      }
    }
  })
})

describe('formatFieldValue', () => {
  it('appends the unit for step fields', () => {
    const size = THEME_FIELDS.find((f) => f.key === 'fontSizePercent')!
    expect(formatFieldValue(size, 130)).toBe('130%')
  })

  it('appends ms for the fade duration', () => {
    const dur = THEME_FIELDS.find((f) => f.key === 'transitionDurationMs')!
    expect(formatFieldValue(dur, 200)).toBe('200ms')
  })

  it('shows the option label rather than the raw value for seg fields', () => {
    const align = THEME_FIELDS.find((f) => f.key === 'textAlign')!
    expect(formatFieldValue(align, 'center')).toBe('CENTER')
  })

  it('renders a null file path as an em dash', () => {
    const logo = THEME_FIELDS.find((f) => f.key === 'logoPath')!
    expect(formatFieldValue(logo, null)).toBe('—')
  })

  it('shows only the basename of a file path', () => {
    const logo = THEME_FIELDS.find((f) => f.key === 'logoPath')!
    expect(formatFieldValue(logo, '/Users/rose/Media/Paint Sweeps.png')).toBe('Paint Sweeps.png')
  })
})
