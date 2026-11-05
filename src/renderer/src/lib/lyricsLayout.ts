/**
 * lyricsLayout — maps every line of a song's lyrics textarea to the slide
 * it becomes, so the editor can show slide numbers in the gutter, mark
 * automatic max-lines splits, follow the cursor in the preview, and jump
 * from a slide (or section) back to its text.
 *
 * It walks the text with the SAME rules as `parseSongText` (shared/parser)
 * and splits paragraphs with the SAME `splitBalanced` as
 * `previewSongSlides`, so slide N here is always slide N on the projector.
 * `lyricsLayout.test.ts` checks that against `previewSongSlides` directly.
 *
 * Pure and cheap: safe to run on every keystroke.
 */

import type { SectionType } from '@shared/types'
import { clampMaxLines, splitBalanced } from './slideify'

export interface LayoutLine {
  kind: 'header' | 'text' | 'blank'
  /** Index into `sections`, or null for blank lines before any section. */
  section: number | null
  /** 0-based slide this text line belongs to; null for headers and blanks. */
  slide: number | null
  /** First line of its slide — where the gutter shows the slide number. */
  slideStart: boolean
  /** Starts a slide created by the max-lines split rather than a blank line. */
  autoSplit: boolean
}

export interface LayoutSection {
  label: string
  type: SectionType
  /** Short tag for the outline: "V1", "C", "PC", "B"… */
  chip: string
  /** Line of the `[Header]`, or null for lyrics before the first header. */
  headerLine: number | null
  /** First line of the section (its header, or its first lyric line). */
  startLine: number
  /** One past the section's last line (the next section's start, or EOF). */
  endLine: number
  slideCount: number
  /** Global index of the section's first slide, or null when it has none. */
  firstSlide: number | null
}

export interface LayoutSlide {
  index: number
  section: number
  sectionLabel: string
  firstLine: number
  lastLine: number
  lines: string[]
}

export interface LyricsLayout {
  lines: LayoutLine[]
  sections: LayoutSection[]
  slides: LayoutSlide[]
}

// Same header rule and type heuristics as shared/parser.ts.
const HEADER = /^\[(.+?)\]$/
const TYPES: Array<[string, SectionType]> = [
  ['pre-chorus', 'pre-chorus'],
  ['prechorus', 'pre-chorus'],
  ['pre chorus', 'pre-chorus'],
  ['verse', 'verse'],
  ['chorus', 'chorus'],
  ['bridge', 'bridge'],
  ['intro', 'intro'],
  ['outro', 'outro'],
  ['tag', 'tag']
]

function typeOf(label: string): SectionType {
  const l = label.trim().toLowerCase()
  for (const [k, t] of TYPES) if (l.startsWith(k)) return t
  return 'other'
}

export function sectionChip(label: string, type: SectionType): string {
  switch (type) {
    case 'verse': {
      const n = label.match(/\d+/)
      return n ? `V${n[0]}` : 'V'
    }
    case 'chorus':
      return 'C'
    case 'pre-chorus':
      return 'PC'
    case 'bridge':
      return 'B'
    case 'intro':
      return 'I'
    case 'outro':
      return 'O'
    case 'tag':
      return 'T'
    default:
      return label.trim()[0]?.toUpperCase() ?? '·'
  }
}

export function layoutLyrics(raw: string, maxLinesPerSlide: number): LyricsLayout {
  const maxLines = clampMaxLines(maxLinesPerSlide)
  const text = raw.replace(/\r\n?/g, '\n')
  const rows = text.split('\n')

  const lines: LayoutLine[] = rows.map(() => ({
    kind: 'blank',
    section: null,
    slide: null,
    slideStart: false,
    autoSplit: false
  }))
  const sections: LayoutSection[] = []
  const paragraphs: number[][][] = [] // per section: paragraphs of line indices
  let para: number[] = []

  const closePara = (): void => {
    if (para.length > 0) paragraphs[sections.length - 1].push(para)
    para = []
  }
  const openSection = (label: string, headerLine: number | null, startLine: number): void => {
    closePara()
    const type = headerLine === null ? 'other' : typeOf(label)
    sections.push({
      label,
      type,
      chip: sectionChip(label, type),
      headerLine,
      startLine,
      endLine: rows.length,
      slideCount: 0,
      firstSlide: null
    })
    paragraphs.push([])
  }

  rows.forEach((row, i) => {
    const line = row.trim()
    const header = line.match(HEADER)
    if (header) {
      if (sections.length > 0) {
        closePara()
        sections[sections.length - 1].endLine = i
      }
      openSection(header[1].trim(), i, i)
      lines[i] = { ...lines[i], kind: 'header', section: sections.length - 1 }
    } else if (line === '') {
      closePara()
      if (sections.length > 0) lines[i].section = sections.length - 1
    } else {
      if (sections.length === 0) openSection('', null, i)
      para.push(i)
      lines[i] = { ...lines[i], kind: 'text', section: sections.length - 1 }
    }
  })
  closePara()

  const slides: LayoutSlide[] = []
  sections.forEach((section, si) => {
    for (const p of paragraphs[si]) {
      splitBalanced(p, maxLines).forEach((chunk, ci) => {
        const index = slides.length
        if (section.firstSlide === null) section.firstSlide = index
        section.slideCount++
        chunk.forEach((li, k) => {
          lines[li].slide = index
          lines[li].slideStart = k === 0
          lines[li].autoSplit = k === 0 && ci > 0
        })
        slides.push({
          index,
          section: si,
          // Same fallback previewSongSlides uses for headerless lyrics.
          sectionLabel: section.label || section.type,
          firstLine: chunk[0],
          lastLine: chunk[chunk.length - 1],
          lines: chunk.map((li) => rows[li].trim())
        })
      })
    }
  })

  return { lines, sections, slides }
}

/**
 * The slide a cursor on `line` is "in". Text lines map directly; a header
 * maps to its section's first slide; a blank line to the slide just above
 * it in the same section (else the next one). Null when there's no slide.
 */
export function slideAtLine(layout: LyricsLayout, line: number): number | null {
  const at = layout.lines[line]
  if (!at) return layout.slides.length > 0 ? layout.slides.length - 1 : null
  if (at.slide !== null) return at.slide
  if (at.kind === 'header' && at.section !== null) return layout.sections[at.section].firstSlide
  for (let i = line - 1; i >= 0; i--) {
    const l = layout.lines[i]
    if (l.kind === 'header') break
    if (l.slide !== null) return l.slide
  }
  for (let i = line + 1; i < layout.lines.length; i++) {
    const l = layout.lines[i]
    if (l.slide !== null) return l.slide
  }
  return null
}

/** 0-based line number of a character offset in `text`. */
export function lineAtOffset(text: string, offset: number): number {
  let n = 0
  for (let i = 0; i < offset && i < text.length; i++) if (text.charCodeAt(i) === 10) n++
  return n
}

/** Character offset where `line` starts in `text`. */
export function offsetOfLine(text: string, line: number): number {
  let offset = 0
  for (let n = 0; n < line; n++) {
    const next = text.indexOf('\n', offset)
    if (next < 0) return text.length
    offset = next + 1
  }
  return offset
}
