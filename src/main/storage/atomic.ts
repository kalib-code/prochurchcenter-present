/**
 * Atomic JSON writes.
 *
 * Pattern: write to a `.tmp` file in the same directory, then rename over the
 * real file. On the same filesystem (which `userData` always is), rename is
 * atomic — so a crash mid-write either leaves the old file intact or the new
 * file complete. Never half-written corruption.
 */

import { writeFile, rename } from 'fs/promises'

export async function atomicWriteJson(path: string, data: unknown): Promise<void> {
  const tmp = `${path}.tmp`
  await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
  await rename(tmp, path)
}
