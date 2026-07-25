/**
 * Declarative descriptor table for the per-song theme override editor.
 *
 * The chip-promotion UI needs to enumerate every overridable field
 * generically — to list what is inherited, render the right control per
 * field, and format a value for a chip. Hand-writing twelve bespoke rows
 * in JSX would make "which fields can be overridden" a fact scattered
 * across a component instead of a table you can read.
 *
 * Mirrors the design file's FIELDS constant (L815-828).
 */

import type { ThemeOverride } from '@shared/types'
import type { PickFileKind } from '@shared/ipc-contract'

export type ThemeFieldGroup =
  | 'TYPE'
  | 'BACKDROP'
  | 'PLACEMENT'
  | 'LEGIBILITY'
  | 'MOTION'
  | 'STANDBY'

interface FieldBase {
  key: keyof ThemeOverride
  group: ThemeFieldGroup
  label: string
  /** Short clarifier shown beside the label. Empty when self-evident. */
  hint: string
}

export interface FieldOption {
  value: string
  label: string
}

export type ThemeFieldDef =
  | (FieldBase & { kind: 'select'; options: FieldOption[] })
  | (FieldBase & { kind: 'seg'; options: FieldOption[] })
  | (FieldBase & { kind: 'swatch'; options: FieldOption[] })
  | (FieldBase & { kind: 'step'; step: number; min: number; max: number; unit: string })
  | (FieldBase & { kind: 'file'; pickKind: PickFileKind })

export const THEME_FIELDS: ThemeFieldDef[] = [
  {
    key: 'fontFamily',
    group: 'TYPE',
    label: 'Font',
    hint: 'built-in, uploaded or system',
    kind: 'select',
    // Values (and labels) copied verbatim from BUILT_IN_FONT_OPTIONS in
    // ThemeFields.tsx so global and per-song overrides produce identical
    // fontFamily strings.
    options: [
      { value: 'system-ui, -apple-system, Segoe UI, sans-serif', label: 'System' },
      { value: 'Inter, system-ui, sans-serif', label: 'Inter' },
      { value: 'Helvetica Neue, Helvetica, Arial, sans-serif', label: 'Helvetica' },
      { value: 'Arial, sans-serif', label: 'Arial' },
      { value: 'Georgia, serif', label: 'Georgia (serif)' },
      { value: 'Times New Roman, Times, serif', label: 'Times' },
      { value: 'Menlo, Courier New, monospace', label: 'Courier (mono)' }
    ]
  },
  {
    key: 'fontSizePercent',
    group: 'TYPE',
    label: 'Size',
    hint: 'scales the auto-fit baseline',
    kind: 'step',
    step: 10,
    min: 50,
    max: 150,
    unit: '%'
  },
  {
    key: 'textColor',
    group: 'TYPE',
    label: 'Text colour',
    hint: 'lyrics and scripture',
    kind: 'swatch',
    options: [
      { value: '#FFFFFF', label: 'WHITE' },
      { value: '#ECE9E4', label: 'BONE' },
      { value: '#E23C0F', label: 'SIGNAL' }
    ]
  },
  {
    key: 'backgroundColor',
    group: 'BACKDROP',
    label: 'Background colour',
    hint: 'base layer',
    kind: 'swatch',
    options: [
      { value: '#000000', label: 'BLACK' },
      { value: '#101822', label: 'NAVY' },
      { value: '#1A0F0B', label: 'EMBER' }
    ]
  },
  {
    key: 'backgroundImagePath',
    group: 'BACKDROP',
    label: 'Background media',
    hint: 'image or ambient video',
    kind: 'file',
    pickKind: 'media'
  },
  {
    key: 'textAlign',
    group: 'PLACEMENT',
    label: 'Horizontal',
    hint: '',
    kind: 'seg',
    options: [
      { value: 'left', label: 'LEFT' },
      { value: 'center', label: 'CENTER' },
      { value: 'right', label: 'RIGHT' }
    ]
  },
  {
    key: 'textPosition',
    group: 'PLACEMENT',
    label: 'Vertical',
    hint: '',
    kind: 'seg',
    // The 'center' value is TextPosition's real union member; the design
    // labels it MIDDLE. Label and value are deliberately different here.
    options: [
      { value: 'top', label: 'TOP' },
      { value: 'center', label: 'MIDDLE' },
      { value: 'bottom', label: 'BOTTOM' }
    ]
  },
  {
    key: 'textEffect',
    group: 'LEGIBILITY',
    label: 'Text effect',
    hint: 'against busy backgrounds',
    kind: 'seg',
    options: [
      { value: 'none', label: 'NONE' },
      { value: 'shadow', label: 'SHADOW' },
      { value: 'outline', label: 'OUTLINE' },
      { value: 'highlight', label: 'HIGHLIGHT' }
    ]
  },
  {
    key: 'highlightColor',
    group: 'LEGIBILITY',
    label: 'Highlight colour',
    hint: 'used by the highlight effect',
    kind: 'swatch',
    options: [
      { value: '#E23C0F', label: 'SIGNAL' },
      { value: '#111111', label: 'INK' },
      { value: '#ECE9E4', label: 'BONE' }
    ]
  },
  {
    key: 'transition',
    group: 'MOTION',
    label: 'Transition',
    hint: '',
    kind: 'seg',
    options: [
      { value: 'fade', label: 'FADE' },
      { value: 'instant', label: 'INSTANT' }
    ]
  },
  {
    key: 'transitionDurationMs',
    group: 'MOTION',
    label: 'Fade duration',
    hint: '',
    kind: 'step',
    step: 50,
    min: 50,
    max: 1000,
    unit: 'ms'
  },
  {
    key: 'logoPath',
    group: 'STANDBY',
    label: 'Standby image',
    hint: 'shown when you press L',
    kind: 'file',
    pickKind: 'image'
  }
]

/**
 * Render a field's current value for a chip or a summary row.
 *
 * File paths collapse to their basename — an override chip showing a full
 * /Users/... path would blow out the tray layout, and the filename is the
 * only part the operator recognises.
 */
export function formatFieldValue(def: ThemeFieldDef, value: unknown): string {
  if (def.kind === 'step') {
    return `${value ?? ''}${def.unit}`
  }

  if (def.kind === 'file') {
    if (typeof value !== 'string' || value.length === 0) return '—'
    const parts = value.split(/[/\\]/)
    return parts[parts.length - 1] || '—'
  }

  const match = def.options.find((o) => o.value === value)
  return match ? match.label : String(value ?? '—')
}
