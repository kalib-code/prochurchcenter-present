/**
 * lyricsEdit — text edits the song editor makes on the operator's behalf:
 * inserting a `[Section]` header and reordering whole sections.
 *
 * Insertions are returned as { at, text } rather than a new string so the
 * editor can apply them through the textarea itself, which keeps them on
 * the native undo stack (⌘Z).
 */

import type { LyricsLayout } from './lyricsLayout'
import { offsetOfLine } from './lyricsLayout'

export type SectionKind = 'verse' | 'chorus' | 'pre-chorus' | 'bridge' | 'tag' | 'intro' | 'outro'

export const SECTION_KINDS: { kind: SectionKind; label: string }[] = [
  { kind: 'verse', label: 'Verse' },
  { kind: 'chorus', label: 'Chorus' },
  { kind: 'pre-chorus', label: 'Pre-Chorus' },
  { kind: 'bridge', label: 'Bridge' },
  { kind: 'tag', label: 'Tag' },
  { kind: 'intro', label: 'Intro' },
  { kind: 'outro', label: 'Outro' }
]

/** "Verse 3" after Verse 1 and 2; the plain name for everything else. */
export function nextSectionLabel(kind: SectionKind, layout: LyricsLayout): string {
  const base = SECTION_KINDS.find((k) => k.kind === kind)!.label
  if (kind !== 'verse') return base
  let max = 0
  for (const s of layout.sections) {
    if (s.type !== 'verse') continue
    const n = Number(s.label.match(/\d+/)?.[0] ?? 1)
    if (n > max) max = n
  }
  return `Verse ${max + 1}`
}

export interface Insertion {
  /** Character offset to insert at. */
  at: number
  text: string
}

/**
 * Where and what to insert for a new `[label]` header with the cursor at
 * `caret`. The header goes after the cursor's line, separated from lyrics
 * above by a blank line, and the cursor lands on a fresh line under it.
 */
export function sectionInsertion(raw: string, caret: number, label: string): Insertion {
  const header = `[${label}]\n`
  if (raw.trim() === '') return { at: 0, text: header }
  const lineEnd = raw.indexOf('\n', caret)
  const end = lineEnd < 0 ? raw.length : lineEnd
  const lineStart = raw.lastIndexOf('\n', caret - 1) + 1
  const current = raw.slice(lineStart, end).trim()
  if (current === '') {
    const prevStart = raw.lastIndexOf('\n', lineStart - 2) + 1
    const previous = lineStart > 0 ? raw.slice(prevStart, lineStart - 1).trim() : ''
    return { at: lineStart, text: (previous ? '\n' : '') + header }
  }
  // Mid-text: the existing line break supplies the newline after the header.
  return { at: end, text: end < raw.length ? `\n\n[${label}]` : `\n\n${header}` }
}

/**
 * Move section `from` to position `to` (indices into layout.sections).
 * Sections are rejoined with one blank line between them. Lyrics before
 * the first header have no header to travel with, so that block never
 * moves and nothing moves above it. Returns `raw` unchanged when the move
 * isn't possible.
 */
export function moveSection(raw: string, layout: LyricsLayout, from: number, to: number): string {
  const { sections } = layout
  if (from === to || !sections[from] || !sections[to]) return raw
  if (sections[from].headerLine === null || sections[to].headerLine === null) return raw

  const rows = raw.replace(/\r\n?/g, '\n').split('\n')
  const block = (i: number): string[] => {
    const lines = rows.slice(sections[i].startLine, sections[i].endLine)
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop()
    return lines
  }
  const prefix = rows.slice(0, sections[0].startLine)
  const order = sections.map((_, i) => i)
  order.splice(to, 0, order.splice(from, 1)[0])

  const body = order.map((i) => block(i).join('\n')).join('\n\n')
  const trailingNewline = raw.endsWith('\n') ? '\n' : ''
  return [...prefix, body].join('\n') + trailingNewline
}

/** Offset of the start of section `i`'s first line (for jump-to-section). */
export function sectionOffset(raw: string, layout: LyricsLayout, i: number): number {
  const s = layout.sections[i]
  return s ? offsetOfLine(raw, s.startLine) : 0
}
