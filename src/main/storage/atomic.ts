/**
 * Atomic JSON writes.
 *
 * Pattern: write to a `.tmp` file in the same directory, then rename over the
 * real file. On the same filesystem (which `userData` always is), rename is
 * atomic — so a crash mid-write either leaves the old file intact or the new
 * file complete. Never half-written corruption.
 */

import { writeFile, rename, unlink } from 'fs/promises'

export async function atomicWriteJson(path: string, data: unknown): Promise<void> {
  const tmp = `${path}.tmp`
  await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
  await rename(tmp, path)
}

/**
 * Atomic binary write — same tmp-then-rename guarantee as
 * atomicWriteJson, but for buffers. `atomicWriteJson` cannot be reused
 * here: it JSON.stringifies and writes utf8, which would corrupt a PDF.
 *
 * The tmp file is created in the destination directory so the rename
 * stays on one filesystem and therefore stays atomic.
 */
export async function atomicWriteFile(path: string, data: Uint8Array): Promise<void> {
  const tmp = `${path}.tmp`
  await writeFile(tmp, data)
  try {
    await rename(tmp, path)
  } catch (err) {
    // rename() can fail after the tmp file was written successfully
    // (disk full, an AV/indexer holding a lock on Windows, a permissions
    // error, the process dying between the two calls). Without this,
    // the tmp file could be orphaned. If even the process death itself
    // strands a `.tmp` (no catch block runs at all), the startup sweep
    // in sweepOrphanPdfs() removes it — see that function's doc comment.
    // Best-effort only: if the unlink also fails there is nothing
    // further to do, and surfacing that failure instead of the original
    // error would hide the real cause.
    await unlink(tmp).catch(() => {})
    throw err
  }
}
