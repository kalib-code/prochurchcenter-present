/**
 * Setlist storage — one JSON file per setlist under `library/setlists/`.
 *
 * A setlist is an ordered, dated list of polymorphic items (song, scripture,
 * section-divider, image, countdown). See shared/types.ts.
 */

import { readFile, readdir, unlink } from 'fs/promises'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type { Setlist } from '@shared/types'
import type { UpdateSetlistPatch } from '@shared/ipc-contract'
import { getSetlistsDir } from './paths'
import { atomicWriteJson } from './atomic'

function setlistPath(id: string): string {
  return join(getSetlistsDir(), `${id}.json`)
}

function nowIso(): string {
  return new Date().toISOString()
}

export async function listSetlists(): Promise<Setlist[]> {
  const dir = getSetlistsDir()
  const files = await readdir(dir).catch(() => [] as string[])
  const setlists = await Promise.all(
    files
      .filter((f) => f.endsWith('.json') && !f.endsWith('.tmp.json'))
      .map(async (f) => {
        try {
          const content = await readFile(join(dir, f), 'utf8')
          return JSON.parse(content) as Setlist
        } catch (error) {
          console.error(`[setlists] Failed to read ${f}:`, error)
          return null
        }
      })
  )
  return setlists.filter((s): s is Setlist => s !== null)
}

export async function getSetlist(id: string): Promise<Setlist | null> {
  try {
    const content = await readFile(setlistPath(id), 'utf8')
    return JSON.parse(content) as Setlist
  } catch {
    return null
  }
}

export async function createSetlist(input: { name: string; date: string }): Promise<Setlist> {
  const id = randomUUID()
  const now = nowIso()
  const setlist: Setlist = {
    id,
    name: input.name,
    date: input.date,
    items: [],
    createdAt: now,
    updatedAt: now
  }
  await atomicWriteJson(setlistPath(id), setlist)
  return setlist
}

export async function updateSetlist(id: string, patch: UpdateSetlistPatch): Promise<Setlist> {
  const existing = await getSetlist(id)
  if (!existing) throw new Error(`Setlist not found: ${id}`)

  const updated: Setlist = {
    ...existing,
    ...patch,
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: nowIso()
  }
  await atomicWriteJson(setlistPath(id), updated)
  return updated
}

export async function deleteSetlist(id: string): Promise<void> {
  await unlink(setlistPath(id)).catch(() => {
    /* ignore missing */
  })
}

/**
 * Clone an existing setlist with a new name and date. Item IDs are
 * regenerated so they remain unique within the new setlist — song references
 * (`songId`) are preserved so the cloned setlist still points at the same
 * songs in the library.
 */
export async function cloneSetlist(
  sourceId: string,
  newName: string,
  newDate: string
): Promise<Setlist> {
  const source = await getSetlist(sourceId)
  if (!source) throw new Error(`Setlist not found: ${sourceId}`)

  const newId = randomUUID()
  const now = nowIso()
  const cloned: Setlist = {
    ...source,
    id: newId,
    name: newName,
    date: newDate,
    items: source.items.map((item) => ({ ...item, id: randomUUID() })),
    createdAt: now,
    updatedAt: now
  }
  await atomicWriteJson(setlistPath(newId), cloned)
  return cloned
}
