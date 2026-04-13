/**
 * bibleReference — parse free-form scripture references typed by an
 * operator into a structured BibleReference.
 *
 * Accepted forms:
 *   "John 3:16"          → single verse
 *   "John 3:16-18"       → verse range
 *   "John 3"             → whole chapter
 *   "1 Cor 13:4-7"       → numbered book, abbreviated, range
 *   "1cor13:4"           → tightly written, no spaces between number and book
 *   "  jn  3 : 16  "     → whitespace and case insensitive
 *
 * Output:
 *   { bookId: 'JHN', bookName: 'John', chapter, verseStart, verseEnd? }
 *
 * `bookId` is the USFM 3-letter code that helloao's API uses directly
 * in its URL, so the lookup pipeline never has to map names → ids
 * twice.
 *
 * Returns null for unparseable input. The caller (bible IPC handler /
 * scripture editor) renders a friendly error message — the parser
 * itself is allocation-free and exception-free.
 *
 * Why not a fancy grammar / parser combinator: scripture references
 * are simple enough that one regex + one lookup table covers ~100% of
 * what an operator types. The added dependency would be more code
 * than the regex.
 */

import type { BibleReference } from './types'

/**
 * Canonical book table. Each entry's `aliases` includes the canonical
 * name itself (lowercased) plus common abbreviations. The matcher
 * picks the FIRST entry whose alias is a prefix of the user input,
 * preferring longer aliases when ambiguous (so "1 john" doesn't get
 * shadowed by "john").
 *
 * Numbered books include both "1 John" / "1john" / "1jn" / "1 jn"
 * variants. Common evangelical/PH abbreviations covered.
 */
interface BookEntry {
  id: string // USFM 3-letter code
  name: string // canonical display name
  aliases: string[] // lowercase, no internal whitespace normalization
}

const BOOKS: BookEntry[] = [
  // ── Old Testament ─────────────────────────────────────────────
  { id: 'GEN', name: 'Genesis', aliases: ['genesis', 'gen', 'ge', 'gn'] },
  { id: 'EXO', name: 'Exodus', aliases: ['exodus', 'exod', 'exo', 'ex'] },
  { id: 'LEV', name: 'Leviticus', aliases: ['leviticus', 'lev', 'lv'] },
  { id: 'NUM', name: 'Numbers', aliases: ['numbers', 'num', 'nu', 'nm'] },
  { id: 'DEU', name: 'Deuteronomy', aliases: ['deuteronomy', 'deut', 'deu', 'dt'] },
  { id: 'JOS', name: 'Joshua', aliases: ['joshua', 'josh', 'jos', 'jsh'] },
  { id: 'JDG', name: 'Judges', aliases: ['judges', 'judg', 'jdg', 'jdgs'] },
  { id: 'RUT', name: 'Ruth', aliases: ['ruth', 'rut', 'rth'] },
  { id: '1SA', name: '1 Samuel', aliases: ['1 samuel', '1samuel', '1 sam', '1sam', '1 sa', '1sa'] },
  { id: '2SA', name: '2 Samuel', aliases: ['2 samuel', '2samuel', '2 sam', '2sam', '2 sa', '2sa'] },
  { id: '1KI', name: '1 Kings', aliases: ['1 kings', '1kings', '1 kgs', '1kgs', '1 ki', '1ki'] },
  { id: '2KI', name: '2 Kings', aliases: ['2 kings', '2kings', '2 kgs', '2kgs', '2 ki', '2ki'] },
  { id: '1CH', name: '1 Chronicles', aliases: ['1 chronicles', '1chronicles', '1 chron', '1chron', '1 chr', '1chr', '1 ch', '1ch'] },
  { id: '2CH', name: '2 Chronicles', aliases: ['2 chronicles', '2chronicles', '2 chron', '2chron', '2 chr', '2chr', '2 ch', '2ch'] },
  { id: 'EZR', name: 'Ezra', aliases: ['ezra', 'ezr'] },
  { id: 'NEH', name: 'Nehemiah', aliases: ['nehemiah', 'neh', 'ne'] },
  { id: 'EST', name: 'Esther', aliases: ['esther', 'esth', 'est'] },
  { id: 'JOB', name: 'Job', aliases: ['job', 'jb'] },
  { id: 'PSA', name: 'Psalms', aliases: ['psalms', 'psalm', 'psa', 'ps', 'pss'] },
  { id: 'PRO', name: 'Proverbs', aliases: ['proverbs', 'prov', 'pro', 'pr', 'prv'] },
  { id: 'ECC', name: 'Ecclesiastes', aliases: ['ecclesiastes', 'eccles', 'eccl', 'ecc', 'ec'] },
  { id: 'SNG', name: 'Song of Solomon', aliases: ['song of solomon', 'song of songs', 'song', 'sng', 'sos', 'so'] },
  { id: 'ISA', name: 'Isaiah', aliases: ['isaiah', 'isa', 'is'] },
  { id: 'JER', name: 'Jeremiah', aliases: ['jeremiah', 'jer', 'jr'] },
  { id: 'LAM', name: 'Lamentations', aliases: ['lamentations', 'lam', 'la'] },
  { id: 'EZK', name: 'Ezekiel', aliases: ['ezekiel', 'ezek', 'ezk', 'eze', 'ez'] },
  { id: 'DAN', name: 'Daniel', aliases: ['daniel', 'dan', 'dn'] },
  { id: 'HOS', name: 'Hosea', aliases: ['hosea', 'hos', 'ho'] },
  { id: 'JOL', name: 'Joel', aliases: ['joel', 'jol', 'joe'] },
  { id: 'AMO', name: 'Amos', aliases: ['amos', 'amo', 'am'] },
  { id: 'OBA', name: 'Obadiah', aliases: ['obadiah', 'obad', 'oba', 'ob'] },
  { id: 'JON', name: 'Jonah', aliases: ['jonah', 'jon', 'jnh'] },
  { id: 'MIC', name: 'Micah', aliases: ['micah', 'mic', 'mi'] },
  { id: 'NAM', name: 'Nahum', aliases: ['nahum', 'nam', 'nah', 'na'] },
  { id: 'HAB', name: 'Habakkuk', aliases: ['habakkuk', 'hab', 'hb'] },
  { id: 'ZEP', name: 'Zephaniah', aliases: ['zephaniah', 'zeph', 'zep', 'zp'] },
  { id: 'HAG', name: 'Haggai', aliases: ['haggai', 'hag', 'hg'] },
  { id: 'ZEC', name: 'Zechariah', aliases: ['zechariah', 'zech', 'zec', 'zc'] },
  { id: 'MAL', name: 'Malachi', aliases: ['malachi', 'mal', 'ml'] },
  // ── New Testament ─────────────────────────────────────────────
  { id: 'MAT', name: 'Matthew', aliases: ['matthew', 'matt', 'mat', 'mt'] },
  { id: 'MRK', name: 'Mark', aliases: ['mark', 'mrk', 'mk', 'mr'] },
  { id: 'LUK', name: 'Luke', aliases: ['luke', 'luk', 'lk'] },
  { id: 'JHN', name: 'John', aliases: ['john', 'jhn', 'jn', 'joh'] },
  { id: 'ACT', name: 'Acts', aliases: ['acts', 'act', 'ac'] },
  { id: 'ROM', name: 'Romans', aliases: ['romans', 'rom', 'ro', 'rm'] },
  { id: '1CO', name: '1 Corinthians', aliases: ['1 corinthians', '1corinthians', '1 cor', '1cor', '1 co', '1co'] },
  { id: '2CO', name: '2 Corinthians', aliases: ['2 corinthians', '2corinthians', '2 cor', '2cor', '2 co', '2co'] },
  { id: 'GAL', name: 'Galatians', aliases: ['galatians', 'gal', 'ga'] },
  { id: 'EPH', name: 'Ephesians', aliases: ['ephesians', 'eph', 'ep'] },
  { id: 'PHP', name: 'Philippians', aliases: ['philippians', 'phil', 'php'] },
  { id: 'COL', name: 'Colossians', aliases: ['colossians', 'col'] },
  { id: '1TH', name: '1 Thessalonians', aliases: ['1 thessalonians', '1thessalonians', '1 thess', '1thess', '1 thes', '1thes', '1 th', '1th'] },
  { id: '2TH', name: '2 Thessalonians', aliases: ['2 thessalonians', '2thessalonians', '2 thess', '2thess', '2 thes', '2thes', '2 th', '2th'] },
  { id: '1TI', name: '1 Timothy', aliases: ['1 timothy', '1timothy', '1 tim', '1tim', '1 ti', '1ti'] },
  { id: '2TI', name: '2 Timothy', aliases: ['2 timothy', '2timothy', '2 tim', '2tim', '2 ti', '2ti'] },
  { id: 'TIT', name: 'Titus', aliases: ['titus', 'tit', 'ti'] },
  { id: 'PHM', name: 'Philemon', aliases: ['philemon', 'philem', 'phlm', 'phm'] },
  { id: 'HEB', name: 'Hebrews', aliases: ['hebrews', 'heb'] },
  { id: 'JAS', name: 'James', aliases: ['james', 'jas', 'jm'] },
  { id: '1PE', name: '1 Peter', aliases: ['1 peter', '1peter', '1 pet', '1pet', '1 pe', '1pe'] },
  { id: '2PE', name: '2 Peter', aliases: ['2 peter', '2peter', '2 pet', '2pet', '2 pe', '2pe'] },
  { id: '1JN', name: '1 John', aliases: ['1 john', '1john', '1 jhn', '1jhn', '1 jn', '1jn'] },
  { id: '2JN', name: '2 John', aliases: ['2 john', '2john', '2 jhn', '2jhn', '2 jn', '2jn'] },
  { id: '3JN', name: '3 John', aliases: ['3 john', '3john', '3 jhn', '3jhn', '3 jn', '3jn'] },
  { id: 'JUD', name: 'Jude', aliases: ['jude', 'jud', 'jd'] },
  { id: 'REV', name: 'Revelation', aliases: ['revelation', 'rev', 'rv', 'apoc'] }
]

/**
 * Build a sorted alias index: longest aliases first, so a prefix
 * match like "1 john" is tried before "john". Without this ordering,
 * "1 John 3:16" would match the alias "john" against the substring
 * "John" and pick the wrong book.
 */
interface AliasEntry {
  alias: string
  entry: BookEntry
}
const ALIAS_INDEX: AliasEntry[] = (() => {
  const out: AliasEntry[] = []
  for (const entry of BOOKS) {
    for (const alias of entry.aliases) {
      out.push({ alias, entry })
    }
  }
  // Longest first
  out.sort((a, b) => b.alias.length - a.alias.length)
  return out
})()

/**
 * Normalize input for matching: lowercase, collapse internal
 * whitespace, trim. Preserves digits and word boundaries so the
 * trailing chapter:verse split below stays unambiguous.
 */
function normalize(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Parse a free-form scripture reference. Returns null if the input
 * cannot be matched to any known book or has a malformed
 * chapter/verse suffix.
 */
export function parseReference(input: string): BibleReference | null {
  if (!input) return null
  const norm = normalize(input)

  // Find the longest book alias that appears at the start of the
  // input. We also accept aliases without the trailing space — e.g.
  // "1cor13:4" — by checking that the next character is a digit.
  let matched: BookEntry | null = null
  let matchEnd = 0

  for (const { alias, entry } of ALIAS_INDEX) {
    if (norm.startsWith(alias)) {
      // Ensure the boundary is sensible: the alias must be followed
      // by a space, a digit, or the end of input. Otherwise "ge" would
      // match "genesis" (longer alias would have won, but defensive).
      const next = norm[alias.length]
      if (next === undefined || next === ' ' || /\d/.test(next)) {
        matched = entry
        matchEnd = alias.length
        break
      }
    }
  }

  if (!matched) return null

  // The remainder is the chapter and optional verse range. Allow
  // arbitrary whitespace and an optional colon between chapter and
  // verse. Examples we want to accept:
  //   " 3:16"
  //   " 3:16-18"
  //   " 3"
  //   "3:16"
  const remainder = norm.slice(matchEnd).trim()
  if (!remainder) return null

  const m = remainder.match(/^(\d+)\s*(?::\s*(\d+)\s*(?:-\s*(\d+))?)?$/)
  if (!m) return null

  const chapter = parseInt(m[1], 10)
  const verseStart = m[2] ? parseInt(m[2], 10) : undefined
  const verseEnd = m[3] ? parseInt(m[3], 10) : undefined

  if (!Number.isFinite(chapter) || chapter < 1) return null
  if (verseStart !== undefined && (!Number.isFinite(verseStart) || verseStart < 1)) return null
  if (verseEnd !== undefined && (!Number.isFinite(verseEnd) || verseEnd < 1)) return null
  if (verseStart !== undefined && verseEnd !== undefined && verseEnd < verseStart) {
    return null
  }

  return {
    bookId: matched.id,
    bookName: matched.name,
    chapter,
    verseStart,
    verseEnd
  }
}

/**
 * Format a parsed reference back into a canonical display string.
 * Used by the scripture editor to show the parsed-and-validated
 * reference next to the input field.
 */
export function formatReference(ref: BibleReference): string {
  const { bookName, chapter, verseStart, verseEnd } = ref
  if (verseStart === undefined) return `${bookName} ${chapter}`
  if (verseEnd === undefined || verseEnd === verseStart) {
    return `${bookName} ${chapter}:${verseStart}`
  }
  return `${bookName} ${chapter}:${verseStart}-${verseEnd}`
}
