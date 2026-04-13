/**
 * Bible IPC handlers — surface helloao-backed Bible lookups to the renderer.
 *
 * The handlers here are thin glue between the cache and the API client.
 * Caching strategy:
 *   - Translation list: cached forever once fetched
 *   - Book list per translation: cached forever once fetched
 *   - Per-chapter content: cached forever once fetched
 *
 * Every method follows the same pattern: try cache, fall back to fetch,
 * persist the fetch result. Errors from the fetcher (offline, 5xx,
 * invalid IDs) propagate up as friendly Error.message strings — the
 * renderer's preload layer surfaces them via the standard ipcRenderer
 * .invoke rejection path.
 *
 * The `lookup` handler is the exception: it returns a discriminated
 * union BibleLookupResult instead of throwing. That's because the
 * scripture editor wants to render a parse error inline next to the
 * input field rather than show a global error toast — having an `ok`
 * field makes that branching explicit at the type level.
 */

import { ipcMain } from 'electron'
import { CHANNELS } from '@shared/ipc-contract'
import type {
  BibleBookMeta,
  BibleLookupResult,
  BibleTranslationMeta,
  BibleVerse
} from '@shared/types'
import { parseReference } from '@shared/bibleReference'
import {
  fetchAvailableTranslations,
  fetchBooks,
  fetchChapter
} from '../storage/bibleApi'
import {
  getTranslations,
  getBooks,
  getChapter
} from '../storage/bibleCache'

export function registerBibleHandlers(): void {
  ipcMain.handle(
    CHANNELS.bible.listTranslations,
    async (): Promise<BibleTranslationMeta[]> => {
      return getTranslations(fetchAvailableTranslations)
    }
  )

  ipcMain.handle(
    CHANNELS.bible.listBooks,
    async (_, translationId: string): Promise<BibleBookMeta[]> => {
      return getBooks(translationId, () => fetchBooks(translationId))
    }
  )

  ipcMain.handle(
    CHANNELS.bible.getChapter,
    async (
      _,
      translationId: string,
      bookId: string,
      chapter: number
    ): Promise<BibleVerse[]> => {
      return getChapter(translationId, bookId, chapter, () =>
        fetchChapter(translationId, bookId, chapter)
      )
    }
  )

  ipcMain.handle(
    CHANNELS.bible.lookup,
    async (
      _,
      translationId: string,
      reference: string
    ): Promise<BibleLookupResult> => {
      const parsed = parseReference(reference)
      if (!parsed) {
        return {
          ok: false,
          error:
            'Could not understand that reference. Try something like "John 3:16" or "Romans 12:1-3".'
        }
      }

      try {
        const verses = await getChapter(
          translationId,
          parsed.bookId,
          parsed.chapter,
          () => fetchChapter(translationId, parsed.bookId, parsed.chapter)
        )

        // Filter to the requested verse range. Whole-chapter requests
        // (verseStart undefined) return all verses unchanged.
        let filtered: BibleVerse[] = verses
        if (parsed.verseStart !== undefined) {
          const end = parsed.verseEnd ?? parsed.verseStart
          filtered = verses.filter(
            (v) => v.number >= parsed.verseStart! && v.number <= end
          )
          if (filtered.length === 0) {
            return {
              ok: false,
              error: `No verses found in ${parsed.bookName} ${parsed.chapter}:${parsed.verseStart}${parsed.verseEnd ? '-' + parsed.verseEnd : ''}.`
            }
          }
        }

        // Display text: each verse on its own line, no verse numbers
        // by default (the operator can edit after). Verse numbers tend
        // to clutter projector slides — most churches read them aloud
        // separately or include them in the reference label instead.
        const text = filtered.map((v) => v.text).join('\n')

        return {
          ok: true,
          reference: parsed,
          verses: filtered,
          text
        }
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : 'Bible lookup failed.'
        }
      }
    }
  )
}
