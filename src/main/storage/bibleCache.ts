/**
 * bibleCache — persistent on-disk cache for helloao API responses.
 *
 * Layout under `userData/bible-cache/`:
 *
 *   bible-cache/
 *   ├── translations.json                  — global available_translations cache
 *   ├── ENGWEBP/
 *   │   ├── books.json                     — per-translation book list cache
 *   │   ├── JHN-3.json                     — per-chapter cache
 *   │   ├── ROM-12.json
 *   │   └── ...
 *   ├── tgl_ulb/
 *   │   └── ...
 *
 * Caching strategy:
 *   - Translation list is cached once and reused indefinitely. helloao
 *     adds new translations occasionally but for a v1 product an
 *     operator rarely cares — they pick once and use forever.
 *   - Book list per translation: same deal. Cache once, reuse.
 *   - Per-chapter cache: written on first successful fetch, read on
 *     every subsequent lookup. Bible content doesn't change, so there
 *     is no expiration policy.
 *
 * Functions return the cached value if present, OR call the provided
 * fetcher and persist its result. The fetcher is passed as a callback
 * so this module stays free of network code (clean separation: cache
 * here, fetch in bibleApi.ts).
 *
 * Errors from the fetcher propagate up unchanged — the IPC layer
 * surfaces them to the renderer as friendly messages.
 */

import { readFile, mkdir } from 'fs/promises'
import { join } from 'path'
import type {
  BibleBookMeta,
  BibleTranslationMeta,
  BibleVerse
} from '@shared/types'
import { getBibleCacheDir } from './paths'
import { atomicWriteJson } from './atomic'

// ─── Helpers ──────────────────────────────────────────────────────────

async function readJsonOrNull<T>(path: string): Promise<T | null> {
  try {
    const content = await readFile(path, 'utf8')
    return JSON.parse(content) as T
  } catch {
    return null
  }
}

async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true }).catch(() => {
    /* ignore EEXIST */
  })
}

function translationsCachePath(): string {
  return join(getBibleCacheDir(), 'translations.json')
}

function booksCachePath(translationId: string): string {
  return join(getBibleCacheDir(), translationId, 'books.json')
}

function chapterCachePath(
  translationId: string,
  bookId: string,
  chapter: number
): string {
  return join(getBibleCacheDir(), translationId, `${bookId}-${chapter}.json`)
}

// ─── Translation list ────────────────────────────────────────────────

export async function getTranslations(
  fetcher: () => Promise<BibleTranslationMeta[]>
): Promise<BibleTranslationMeta[]> {
  const cached = await readJsonOrNull<BibleTranslationMeta[]>(translationsCachePath())
  if (cached) return cached

  const fresh = await fetcher()
  await ensureDir(getBibleCacheDir())
  await atomicWriteJson(translationsCachePath(), fresh)
  return fresh
}

// ─── Books for a translation ─────────────────────────────────────────

export async function getBooks(
  translationId: string,
  fetcher: () => Promise<BibleBookMeta[]>
): Promise<BibleBookMeta[]> {
  const cached = await readJsonOrNull<BibleBookMeta[]>(booksCachePath(translationId))
  if (cached) return cached

  const fresh = await fetcher()
  await ensureDir(join(getBibleCacheDir(), translationId))
  await atomicWriteJson(booksCachePath(translationId), fresh)
  return fresh
}

// ─── Chapter content ─────────────────────────────────────────────────

export async function getChapter(
  translationId: string,
  bookId: string,
  chapter: number,
  fetcher: () => Promise<BibleVerse[]>
): Promise<BibleVerse[]> {
  const cached = await readJsonOrNull<BibleVerse[]>(
    chapterCachePath(translationId, bookId, chapter)
  )
  if (cached) return cached

  const fresh = await fetcher()
  await ensureDir(join(getBibleCacheDir(), translationId))
  await atomicWriteJson(
    chapterCachePath(translationId, bookId, chapter),
    fresh
  )
  return fresh
}
