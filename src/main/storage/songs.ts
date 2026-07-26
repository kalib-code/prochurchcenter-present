/**
 * Song storage — one JSON file per song under `library/songs/`.
 *
 * File name = song `id` (uuid). Never title-derived, so renaming a song
 * doesn't rename the file. This avoids the entire "file rename on edit"
 * class of bugs and collision handling.
 */

import { readFile, readdir, unlink } from 'fs/promises'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type { Song } from '@shared/types'
import type { CreateSongInput, UpdateSongPatch } from '@shared/ipc-contract'
import { parseSongText } from '@shared/parser'
import { getSongsDir } from './paths'
import { atomicWriteJson } from './atomic'

function songPath(id: string): string {
  return join(getSongsDir(), `${id}.json`)
}

function nowIso(): string {
  return new Date().toISOString()
}

/**
 * Fill in defaults for newly-added fields (e.g. `themeOverride` added
 * in Phase 5.5) so that songs written with an earlier schema still
 * typecheck and render. Mirrors the `withDefaults` pattern in
 * storage/settings.ts and storage/theme.ts — same problem, same fix.
 */
function withSongDefaults(stored: Partial<Song> & { id: string }): Song {
  return {
    title: stored.title ?? 'Untitled Song',
    author: stored.author ?? null,
    ccli: stored.ccli ?? null,
    copyright: stored.copyright ?? null,
    year: stored.year ?? null,
    language: stored.language ?? 'en',
    categories: stored.categories ?? [],
    rawText: stored.rawText ?? '',
    sections: stored.sections ?? [],
    notes: stored.notes ?? '',
    themeOverride: stored.themeOverride ?? null,
    createdAt: stored.createdAt ?? new Date().toISOString(),
    updatedAt: stored.updatedAt ?? new Date().toISOString(),
    id: stored.id
  }
}

export async function listSongs(): Promise<Song[]> {
  const dir = getSongsDir()
  const files = await readdir(dir).catch(() => [] as string[])
  const songs = await Promise.all(
    files
      .filter((f) => f.endsWith('.json') && !f.endsWith('.tmp.json'))
      .map(async (f) => {
        try {
          const content = await readFile(join(dir, f), 'utf8')
          const parsed = JSON.parse(content) as Partial<Song> & { id: string }
          return withSongDefaults(parsed)
        } catch (error) {
          console.error(`[songs] Failed to read ${f}:`, error)
          return null
        }
      })
  )
  return songs.filter((s): s is Song => s !== null)
}

export async function getSong(id: string): Promise<Song | null> {
  try {
    const content = await readFile(songPath(id), 'utf8')
    const parsed = JSON.parse(content) as Partial<Song> & { id: string }
    return withSongDefaults(parsed)
  } catch {
    return null
  }
}

export async function createSong(input: CreateSongInput): Promise<Song> {
  const id = randomUUID()
  const now = nowIso()
  const song: Song = {
    id,
    title: input.title,
    author: input.author ?? null,
    ccli: input.ccli ?? null,
    copyright: input.copyright ?? null,
    year: input.year ?? null,
    language: input.language ?? 'en',
    categories: input.categories ?? [],
    rawText: input.rawText,
    sections: parseSongText(input.rawText),
    notes: input.notes ?? '',
    themeOverride: null,
    createdAt: now,
    updatedAt: now
  }
  await atomicWriteJson(songPath(id), song)
  return song
}

export async function updateSong(id: string, patch: UpdateSongPatch): Promise<Song> {
  const existing = await getSong(id)
  if (!existing) throw new Error(`Song not found: ${id}`)

  // Re-parse sections only if rawText actually changed — otherwise we keep
  // the cached sections as-is. rawText is the source of truth.
  const newRawText = patch.rawText !== undefined ? patch.rawText : existing.rawText
  const sections =
    patch.rawText !== undefined ? parseSongText(patch.rawText) : existing.sections

  const updated: Song = {
    ...existing,
    ...patch,
    rawText: newRawText,
    sections,
    id: existing.id, // never overwrite
    createdAt: existing.createdAt,
    updatedAt: nowIso()
  }
  await atomicWriteJson(songPath(id), updated)
  return updated
}

export async function deleteSong(id: string): Promise<void> {
  await unlink(songPath(id)).catch(() => {
    /* ignore missing */
  })
}
