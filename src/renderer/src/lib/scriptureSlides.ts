/**
 * Scripture → slides packing.
 *
 * Bible lookup returns one verse per line. Songs are split by line count
 * (`maxLinesPerSlide`), but a scripture "line" is a whole verse, often
 * 120–200 characters. Splitting by line count put four full verses on a
 * slide and the renderer's auto-fit shrank them until they couldn't be
 * read from the back of the room. A whole-chapter reference (e.g.
 * "Philemon 1") made that worst.
 *
 * So scripture is packed by a CHARACTER budget derived from the same
 * max-lines setting, keeping whole verses together whenever they fit and
 * breaking an over-long verse at clause punctuation, then at words.
 */

/**
 * Rough characters that fit on one projected line at the default font
 * size. Matches what a typical song lyric line holds, so "4 lines" means
 * the same density for lyrics and scripture. Raise it to fit more text
 * per slide; lower it for larger text.
 */
export const SCRIPTURE_CHARS_PER_LINE = 45

export function scriptureCharBudget(maxLines: number): number {
  return Math.max(60, maxLines * SCRIPTURE_CHARS_PER_LINE)
}

/**
 * Pack scripture text into slides (each slide = array of display lines).
 * A blank line in the text is an operator-chosen hard break.
 */
export function packScripture(text: string, maxLines: number): string[][] {
  const budget = scriptureCharBudget(maxLines)
  const slides: string[][] = []

  for (const block of text.split(/\n\s*\n/)) {
    const verses = block
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)

    let current: string[] = []
    let size = 0
    const flush = (): void => {
      if (current.length > 0) slides.push(current)
      current = []
      size = 0
    }

    for (const v of verses) {
      for (const piece of splitToBudget(v, budget)) {
        // +1 for the space/line gap between pieces on the same slide.
        const wouldBe = size === 0 ? piece.length : size + 1 + piece.length
        if (size > 0 && (wouldBe > budget || current.length >= maxLines)) flush()
        current.push(piece)
        size = size === 0 ? piece.length : size + 1 + piece.length
      }
    }
    flush()
  }

  return slides
}

/** Split one verse into pieces of at most `budget` chars (a single over-long word excepted). */
function splitToBudget(text: string, budget: number): string[] {
  if (text.length <= budget) return [text]

  // Clauses end in . ; : , ! ? (plus any closing quote/bracket). The
  // trailing remainder without punctuation is its own clause.
  const clauses = text.match(/[^.;:,!?]+[.;:,!?]+["'”’)\]]*\s*|[^.;:,!?]+$/g) ?? [text]

  const out: string[] = []
  let cur = ''
  const push = (): void => {
    const t = cur.trim()
    if (t) out.push(t)
    cur = ''
  }

  for (const clause of clauses) {
    const parts = clause.trim().length > budget ? splitWords(clause, budget) : [clause]
    for (const part of parts) {
      if (cur.trim() && (cur + part).trim().length > budget) push()
      cur += part
    }
  }
  push()
  return out
}

/** Greedy word wrap into chunks of at most `budget` chars, preserving spacing. */
function splitWords(text: string, budget: number): string[] {
  const words = text.trim().split(/\s+/)
  const out: string[] = []
  let cur = ''
  for (const w of words) {
    if (cur && cur.length + 1 + w.length > budget) {
      out.push(cur + ' ')
      cur = w
    } else {
      cur = cur ? `${cur} ${w}` : w
    }
  }
  if (cur) out.push(cur + ' ')
  return out
}
