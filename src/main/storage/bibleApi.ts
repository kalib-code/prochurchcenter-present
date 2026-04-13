/**
 * bibleApi — fetches Bible data from bible.helloao.org.
 *
 * Endpoint patterns (all GET, no auth, no rate limits):
 *   https://bible.helloao.org/api/available_translations.json
 *   https://bible.helloao.org/api/{translation}/books.json
 *   https://bible.helloao.org/api/{translation}/{book}/{chapter}.json
 *
 * Critical gotcha: helloao serves a CloudFront distribution whose
 * error fallback is the docs SPA shell. An invalid translation/book/
 * chapter ID returns **HTTP 200 with `content-type: text/html`**, NOT
 * a 404. Every fetch in this file MUST verify the response is
 * `application/json` BEFORE parsing — a naive `response.json()` would
 * throw a confusing SyntaxError when fed HTML.
 *
 * Response shapes documented in shared/types.ts (BibleVerse,
 * BibleTranslationMeta, BibleBookMeta) and in the helloao docs at
 * https://bible.helloao.org/docs/reference/.
 */

import { net } from 'electron'
import type {
  BibleBookMeta,
  BibleTranslationMeta,
  BibleVerse
} from '@shared/types'

const API_BASE = 'https://bible.helloao.org/api'

/**
 * Wrapper around Electron's `net.fetch` that throws a friendly error
 * for offline / 5xx / HTML-fallback responses. Returns parsed JSON of
 * type `T`. Caller is responsible for shape validation.
 */
async function fetchJson<T>(url: string): Promise<T> {
  let response: Response
  try {
    response = await net.fetch(url, { method: 'GET' })
  } catch (err) {
    // net.fetch throws on offline / DNS failure / connection refused.
    throw new Error(
      'Could not reach the Bible service. Check your internet connection and try again.'
    )
  }

  if (!response.ok) {
    throw new Error(
      `Bible service returned ${response.status}. Try again in a moment.`
    )
  }

  // helloao's CloudFront fallback: HTTP 200 with text/html for invalid IDs.
  // Sniff content-type before parsing JSON to give the user a real error
  // instead of a SyntaxError.
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    throw new Error(
      'Reference not found in this translation. Check the book name and chapter.'
    )
  }

  try {
    return (await response.json()) as T
  } catch {
    throw new Error('Bible service returned an unreadable response.')
  }
}

// ─── Translation list ────────────────────────────────────────────────

interface RawAvailableTranslationsResponse {
  translations: RawTranslation[]
}

interface RawTranslation {
  id: string
  name: string
  englishName: string
  shortName: string
  language: string
  languageName?: string
  languageEnglishName?: string
  textDirection: 'ltr' | 'rtl'
  licenseUrl: string
  licenseNotes?: string | null
}

export async function fetchAvailableTranslations(): Promise<BibleTranslationMeta[]> {
  const data = await fetchJson<RawAvailableTranslationsResponse>(
    `${API_BASE}/available_translations.json`
  )
  if (!Array.isArray(data.translations)) {
    throw new Error('Bible service returned an unexpected translation list.')
  }
  return data.translations.map((t) => ({
    id: t.id,
    name: t.name,
    englishName: t.englishName,
    shortName: t.shortName,
    language: t.language,
    languageName: t.languageName,
    languageEnglishName: t.languageEnglishName,
    textDirection: t.textDirection,
    licenseUrl: t.licenseUrl,
    licenseNotes: t.licenseNotes ?? null
  }))
}

// ─── Books for a translation ─────────────────────────────────────────

interface RawBooksResponse {
  translation: RawTranslation
  books: RawBook[]
}

interface RawBook {
  id: string
  name: string
  commonName: string
  order: number
  numberOfChapters: number
  firstChapterNumber: number
  lastChapterNumber: number
}

export async function fetchBooks(
  translationId: string
): Promise<BibleBookMeta[]> {
  const data = await fetchJson<RawBooksResponse>(
    `${API_BASE}/${encodeURIComponent(translationId)}/books.json`
  )
  if (!Array.isArray(data.books)) {
    throw new Error('Bible service returned an unexpected book list.')
  }
  return data.books.map((b) => ({
    id: b.id,
    name: b.name,
    commonName: b.commonName,
    order: b.order,
    numberOfChapters: b.numberOfChapters,
    firstChapterNumber: b.firstChapterNumber,
    lastChapterNumber: b.lastChapterNumber
  }))
}

// ─── Chapter content ─────────────────────────────────────────────────

interface RawChapterResponse {
  chapter: {
    number: number
    content: RawChapterContent[]
  }
}

type RawChapterContent =
  | { type: 'heading'; content: string[] }
  | { type: 'line_break' }
  | { type: 'hebrew_subtitle'; content: unknown[] }
  | {
      type: 'verse'
      number: number
      content: RawVerseContent[]
    }

type RawVerseContent =
  | string
  | { text: string; poem?: number; wordsOfJesus?: boolean }
  | { heading: string }
  | { lineBreak: true }
  | { noteId: number }

/**
 * Walk a verse's interleaved content array and concatenate the plain
 * text fragments. Footnote refs, inline headings, and line breaks
 * are skipped — the user just wants the verse text on a slide.
 */
function extractVerseText(content: RawVerseContent[]): string {
  let out = ''
  for (const item of content) {
    if (typeof item === 'string') {
      out += item
    } else if ('text' in item && typeof item.text === 'string') {
      out += item.text
    }
    // Skip noteId / heading / lineBreak — operator wants prose, not refs.
  }
  // Collapse weird whitespace into single spaces so quoted dialogue
  // doesn't render with double-space gaps from concatenation.
  return out.replace(/\s+/g, ' ').trim()
}

export async function fetchChapter(
  translationId: string,
  bookId: string,
  chapter: number
): Promise<BibleVerse[]> {
  const url = `${API_BASE}/${encodeURIComponent(translationId)}/${encodeURIComponent(bookId)}/${chapter}.json`
  const data = await fetchJson<RawChapterResponse>(url)

  if (!data.chapter || !Array.isArray(data.chapter.content)) {
    throw new Error('Bible service returned an unexpected chapter shape.')
  }

  const verses: BibleVerse[] = []
  for (const item of data.chapter.content) {
    if (item.type === 'verse' && Array.isArray(item.content)) {
      verses.push({
        number: item.number,
        text: extractVerseText(item.content)
      })
    }
  }
  return verses
}
