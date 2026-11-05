/**
 * tidyLyrics — turns lyrics copied from a website or chord sheet into
 * Present's format (`[Section]` headers, blank line = new slide).
 *
 * Pure: text in, text plus a summary out. The editor applies the result
 * through the textarea so ⌘Z restores the original paste.
 *
 * Every rule is a small function below so each can be tested — and
 * tuned to the sites your team copies from — on its own.
 */

export interface TidyResult {
  text: string
  /** CCLI song number found in the paste, e.g. "7051511". */
  ccli: string | null
  /** Copyright line found in the paste, without the leading "©". */
  copyright: string | null
  /** Human summary of what changed, e.g. ["Removed 6 chord lines"]. */
  changes: string[]
}

// ── Chords ──────────────────────────────────────────────────────────────

const CHORD =
  /^\(?[A-G](?:#|b)?(?:maj|min|m|dim|aug|sus)?\d{0,2}(?:sus\d?|add\d{1,2}|maj\d{1,2})?(?:\/[A-G](?:#|b)?)?\)?$/
const CHORD_FILLER = /^(?:\||-|\/|%|x\d|\d+x|n\.?c\.?)$/i

/** A line made only of chord symbols (and bar lines), e.g. "G  D/F#  Em  C". */
export function isChordLine(line: string): boolean {
  const tokens = line.trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return false
  let chords = 0
  for (const t of tokens) {
    if (CHORD.test(t)) chords++
    else if (!CHORD_FILLER.test(t)) return false
  }
  return chords > 0
}

/** ChordPro-style inline chords: "[G]Amazing [D/F#]grace" → "Amazing grace". */
export function stripInlineChords(line: string): string {
  return line.replace(/\[([^\]]+)\]/g, (whole, inner: string) => (CHORD.test(inner) ? '' : whole))
}

// ── Section labels ──────────────────────────────────────────────────────

const LABEL_WORDS: Array<[RegExp, string]> = [
  [/^pre[\s-]?chorus$/i, 'Pre-Chorus'],
  [/^(?:chorus|refrain|koro)$/i, 'Chorus'],
  [/^verse$/i, 'Verse'],
  [/^bridge$/i, 'Bridge'],
  [/^intro$/i, 'Intro'],
  [/^outro$/i, 'Outro'],
  [/^(?:tag|coda)$/i, 'Tag'],
  [/^ending$/i, 'Ending'],
  [/^interlude$/i, 'Interlude']
]
const REPEAT_MARK = /\s*[([]?\s*(?:x\s?\d+|\d+\s?x)\s*[)\]]?\s*$/i
const LABEL_LINE =
  /^(repeat\s+)?[[(]?\s*(pre[\s-]?chorus|chorus|refrain|koro|verse|bridge|intro|outro|tag|coda|ending|interlude)\s*(\d+)?\s*[\])]?\s*(:)?\s*(.*)$/i

export interface LabelMatch {
  label: string
  /** Lyrics written on the same line after "Chorus:", if any. */
  rest: string
  /** "Repeat Chorus" — a reference back to an earlier section. */
  repeat: boolean
}

/**
 * Recognise a section label line: "Chorus", "CHORUS:", "(Chorus)",
 * "[Verse 2]", "Verse 2:", "Koro", "Repeat Chorus", "Chorus x2", or
 * "Chorus: My chains are gone" (label plus lyrics). "Chorus of angels"
 * is NOT a label — without a colon, the label must be the whole line.
 */
export function matchLabel(line: string): LabelMatch | null {
  const m = line.trim().replace(REPEAT_MARK, '').match(LABEL_LINE)
  if (!m) return null
  const [, repeat, word, num, colon, rest] = m
  if (rest && !colon) return null
  const name = LABEL_WORDS.find(([re]) => re.test(word.replace(/\s+/g, ' ')))?.[1] ?? word
  return { label: num ? `${name} ${num}` : name, rest: rest.trim(), repeat: Boolean(repeat) }
}

// ── Metadata ────────────────────────────────────────────────────────────

const CCLI_SONG = /^ccli\s*(?:song)?\s*(?:#|no\.?|number)?\s*:?\s*(\d{4,})\s*$/i
const COPYRIGHT = /^(?:©|\(c\)|copyright\b)\s*(.*)$/i
const DROP_LINE =
  /^(?:ccli\s+licen[cs]e|words\s+and\s+music\s+by|written\s+by|lyrics\s+by|songwriters?\b|for\s+use\s+solely|terms\s+of\s+use|all\s+rights\s+reserved)/i

// ── Repeats ─────────────────────────────────────────────────────────────

interface Block {
  label: string | null
  lines: string[]
  repeat: boolean
}

/**
 * Policy for a section that has a header but no lyrics of its own —
 * "(Chorus)" or "Repeat Chorus" on a lyrics site. Present has no
 * arrangements yet, so a repeat must be written out to appear on screen:
 * this copies the lyrics of the most recent earlier section with the
 * same label. Change this if your team prefers repeats left as a bare
 * header (to be filled in by hand).
 */
export function expandRepeats(blocks: Block[]): { blocks: Block[]; expanded: number } {
  let expanded = 0
  const out = blocks.map((b, i) => {
    if (b.label === null || b.lines.length > 0) return b
    for (let j = i - 1; j >= 0; j--) {
      if (blocks[j].label === b.label && blocks[j].lines.length > 0) {
        expanded++
        return { ...b, lines: [...blocks[j].lines] }
      }
    }
    return b
  })
  return { blocks: out, expanded }
}

// ── Main ────────────────────────────────────────────────────────────────

export function tidyLyrics(input: string): TidyResult {
  let ccli: string | null = null
  let copyright: string | null = null
  let chordLines = 0
  let labels = 0
  let numbered = 0

  const rows = input
    .replace(/\r\n?/g, '\n')
    .replace(/ /g, ' ')
    .replace(/\t/g, ' ')
    .split('\n')

  // Lines (as written), blank lines kept as '' so paragraphs survive.
  const blocks: Block[] = [{ label: null, lines: [], repeat: false }]
  const current = (): Block => blocks[blocks.length - 1]
  let atParagraphStart = true

  for (const row of rows) {
    let line = row.trim()
    if (line === '') {
      if (current().lines.length > 0 && current().lines[current().lines.length - 1] !== '') {
        current().lines.push('')
      }
      atParagraphStart = true
      continue
    }
    const ccliMatch = line.match(CCLI_SONG)
    if (ccliMatch) {
      ccli ??= ccliMatch[1]
      continue
    }
    const copyrightMatch = line.match(COPYRIGHT)
    if (copyrightMatch) {
      copyright ??= copyrightMatch[1].trim() || null
      continue
    }
    if (DROP_LINE.test(line)) continue
    if (isChordLine(line)) {
      chordLines++
      continue
    }
    line = stripInlineChords(line).replace(/\s{2,}/g, ' ').trim()
    if (!line) continue

    const label = matchLabel(line)
    if (label) {
      // Only count labels we rewrote, not headers already in [Label] form.
      if (line !== `[${label.label}]`) labels++
      blocks.push({ label: label.label, lines: [], repeat: label.repeat })
      if (label.rest) current().lines.push(label.rest)
      atParagraphStart = !label.rest
      continue
    }

    // Hymn numbering: "1. Amazing grace…" at the start of a paragraph.
    const verseNum = atParagraphStart ? line.match(/^(\d{1,2})[.)]\s+(.+)$/) : null
    if (verseNum) {
      numbered++
      blocks.push({ label: `Verse ${verseNum[1]}`, lines: [verseNum[2]], repeat: false })
      atParagraphStart = false
      continue
    }

    current().lines.push(line.replace(REPEAT_MARK, ''))
    atParagraphStart = false
  }

  // Trim blank edges of every block before deciding what's "empty".
  for (const b of blocks) {
    while (b.lines[0] === '') b.lines.shift()
    while (b.lines[b.lines.length - 1] === '') b.lines.pop()
  }
  const { blocks: filled, expanded } = expandRepeats(blocks)

  const text = filled
    .filter((b) => b.label !== null || b.lines.length > 0)
    .map((b) => [...(b.label ? [`[${b.label}]`] : []), ...b.lines].join('\n'))
    .join('\n\n')

  const changes: string[] = []
  if (chordLines) changes.push(`Removed ${chordLines} chord line${chordLines === 1 ? '' : 's'}`)
  if (labels + numbered) {
    const n = labels + numbered
    changes.push(`Marked ${n} section${n === 1 ? '' : 's'}`)
  }
  if (expanded) changes.push(`Filled in ${expanded} repeat${expanded === 1 ? '' : 's'}`)
  if (ccli) changes.push(`Found CCLI ${ccli}`)

  return { text: text ? text + '\n' : '', ccli, copyright, changes }
}

/** True when a paste is worth tidying (anything tidyLyrics would change). */
export function looksUntidy(input: string): boolean {
  const r = tidyLyrics(input)
  return r.changes.length > 0 || r.copyright !== null
}
