/**
 * Present — plain-text song parser
 *
 * Rules (frozen per docs/BLUEPRINT.md):
 *   1. A line matching /^\s*\[(.+?)\]\s*$/ starts a new section.
 *      The bracket content becomes `label`. The `type` is inferred.
 *   2. Content before the first section header → section with type 'other',
 *      label ''.
 *   3. A blank line within a section starts a new slide within that section.
 *   4. Leading and trailing whitespace on each line is trimmed.
 *   5. Empty sections are dropped silently.
 *   6. Section `id`s are deterministic (`${type}-${sectionIndex}`), re-derived
 *      from rawText on every parse.
 */

import type { SongSection, SectionType } from './types'

// Longer keys first so "pre-chorus" is matched before "chorus".
const SECTION_TYPE_HEURISTICS: Array<[string, SectionType]> = [
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

function inferSectionType(label: string): SectionType {
  const normalized = label.trim().toLowerCase()
  for (const [keyword, type] of SECTION_TYPE_HEURISTICS) {
    if (normalized.startsWith(keyword)) return type
  }
  return 'other'
}

interface PendingSection {
  type: SectionType
  label: string
  slides: string[][]
}

const HEADER_PATTERN = /^\[(.+?)\]$/

/**
 * Parse raw song text into structured sections.
 *
 * Pure function: same input always produces the same output, including
 * section IDs (they're positional, not UUID-based).
 */
export function parseSongText(raw: string): SongSection[] {
  if (!raw) return []

  // Normalize line endings: \r\n and \r → \n
  const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = normalized.split('\n')

  const sections: SongSection[] = []
  let current: PendingSection | null = null
  let currentSlide: string[] = []
  let sectionIndex = 0

  const flushSlide = (): void => {
    if (currentSlide.length > 0 && current) {
      current.slides.push([...currentSlide])
      currentSlide = []
    }
  }

  const flushSection = (): void => {
    flushSlide()
    if (current && current.slides.length > 0) {
      sections.push({
        id: `${current.type}-${sectionIndex}`,
        type: current.type,
        label: current.label,
        slides: current.slides
      })
      sectionIndex++
    }
    current = null
  }

  for (const rawLine of lines) {
    const line = rawLine.trim()
    const headerMatch = line.match(HEADER_PATTERN)

    if (headerMatch) {
      // New section header
      flushSection()
      const label = headerMatch[1].trim()
      current = {
        type: inferSectionType(label),
        label,
        slides: []
      }
    } else if (line === '') {
      // Blank line: slide boundary within a section
      flushSlide()
    } else {
      // Content line
      if (!current) {
        // Implicit 'other' section for content before any header
        current = { type: 'other', label: '', slides: [] }
      }
      currentSlide.push(line)
    }
  }

  flushSection()

  return sections
}

/**
 * Serialize structured sections back to plain text.
 *
 * Round-trip property: parseSongText(serializeSongSections(s)) should equal s
 * for any valid s. Used for testing and future import/export.
 */
export function serializeSongSections(sections: SongSection[]): string {
  const parts: string[] = []

  for (const section of sections) {
    if (section.label) {
      parts.push(`[${section.label}]`)
    }
    const slideBlocks = section.slides.map((slide) => slide.join('\n'))
    parts.push(slideBlocks.join('\n\n'))
  }

  return parts.join('\n\n')
}
