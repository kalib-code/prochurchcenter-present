/**
 * String-based shortcut computation used by the Service Mode grid.
 *
 * The Service Mode grid builds cards from `SlidePayload` objects (which
 * only carry a `sectionLabel` string, not a `SectionType`), so it needs
 * a version of shortcut lookup that works from the label alone. Uses
 * the same rules as `slideShortcutFor`, just from a free-form string.
 *
 *   "Verse 1"   → "1"
 *   "Verse 12"  → "12"
 *   "Chorus 2"  → "C"
 *   "Bridge"    → "B"
 *   "Pre-Chorus"→ "P"
 *   "John 3:16 (NIV)" → "J"   (scripture fallback: first letter)
 *   ""          → ""
 */
export function shortcutFromLabel(label: string): string {
  if (!label) return ''
  const lower = label.toLowerCase().trim()
  const verseMatch = lower.match(/verse\s*(\d+)/)
  if (verseMatch) return verseMatch[1]
  if (lower.startsWith('pre-chorus') || lower.startsWith('prechorus') || lower.startsWith('pre chorus')) return 'P'
  if (lower.startsWith('chorus')) return 'C'
  if (lower.startsWith('bridge')) return 'B'
  if (lower.startsWith('intro')) return 'I'
  if (lower.startsWith('outro')) return 'O'
  if (lower.startsWith('tag')) return 'T'
  return label.trim()[0]?.toUpperCase() ?? ''
}

/**
 * Like `shortcutFromLabel` but only for recognised section names: returns ''
 * where `shortcutFromLabel` would fall back to the label's first letter
 * ("Coda", "Post-Chorus", "Interlude"). Used by remote-control matching so a
 * named cue never lands on an unrelated section that merely shares a letter.
 */
export function knownShortcutFromLabel(label: string): string {
  const lower = (label ?? '').toLowerCase().trim()
  const verseMatch = lower.match(/verse\s*(\d+)/)
  if (verseMatch) return String(Number(verseMatch[1]))
  if (lower.startsWith('pre-chorus') || lower.startsWith('prechorus') || lower.startsWith('pre chorus')) return 'P'
  if (lower.startsWith('chorus')) return 'C'
  if (lower.startsWith('bridge')) return 'B'
  if (lower.startsWith('intro')) return 'I'
  if (lower.startsWith('outro')) return 'O'
  if (lower.startsWith('tag')) return 'T'
  return ''
}
