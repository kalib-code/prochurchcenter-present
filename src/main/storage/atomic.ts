/**
 * Atomic JSON writes.
 *
 * Pattern: write to a `.tmp` file in the same directory, then rename over the
 * real file. On the same filesystem (which `userData` always is), rename is
 * atomic — so a crash mid-write either leaves the old file intact or the new
 * file complete. Never half-written corruption.
 *
 * Concurrency: writes to the SAME path are serialized through
 * {@link withFileLock}, and every write uses its own unique tmp name.
 * Before this, every write to `foo.json` used the one shared
 * `foo.json.tmp`, so two overlapping writes (two quick autosaves, or a
 * settings toggle racing another) could interleave bytes in the shared
 * tmp file, or the second `rename()` could hit ENOENT because the first
 * had already moved the tmp away.
 */

import { writeFile, rename, unlink } from 'fs/promises'
import { AsyncLocalStorage } from 'async_hooks'
import { basename, dirname, extname, join, resolve } from 'path'

/** Tail promise of the most recent queued operation, per resolved path. */
const fileLocks = new Map<string, Promise<void>>()

/**
 * The set of paths whose lock the current async call chain already holds.
 * Makes {@link withFileLock} re-entrant: `updateSettings` holds the
 * settings lock and then calls `getSettings` → `atomicWriteJson` on the
 * same path; without this, that inner call would wait on the outer one
 * forever.
 */
const heldLocks = new AsyncLocalStorage<ReadonlySet<string>>()

/**
 * Run `fn` while holding an in-process lock on `path`. Operations on the
 * same path run one at a time, in call order; different paths never
 * block each other.
 *
 * Exported so read-modify-write updates (updateSettings, updateSong, …)
 * can hold the lock across the read AND the write — otherwise two
 * concurrent patches each read the same old file and the later write
 * silently drops the earlier patch's fields.
 */
export async function withFileLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
  const key = resolve(path)
  const held = heldLocks.getStore()
  if (held?.has(key)) return fn()

  const prev = fileLocks.get(key) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((r) => (release = r))
  const tail = prev.then(() => current)
  fileLocks.set(key, tail)
  try {
    await prev
    return await heldLocks.run(new Set([...(held ?? []), key]), fn)
  } finally {
    release()
    // Only drop the entry if nobody queued behind us — keeps the map
    // from growing by one entry per song/setlist ever written.
    if (fileLocks.get(key) === tail) fileLocks.delete(key)
  }
}

let tmpCounter = 0

/**
 * A tmp path unique to this write: `<name>.<pid>-<n><ext>.tmp`, e.g.
 * `song.123-4.json.tmp`. The unique token goes BEFORE the extension so
 * the name still ends in `<ext>.tmp` — sweepOrphanPdfs() in
 * canva/import.ts finds stranded PDF tmp files by the `.pdf.tmp` suffix,
 * and the library listings skip anything not ending in `.json`.
 */
function uniqueTmpPath(path: string): string {
  const ext = extname(path)
  const stem = basename(path, ext)
  return join(dirname(path), `${stem}.${process.pid}-${++tmpCounter}${ext}.tmp`)
}

async function writeThenRename(path: string, data: string | Uint8Array): Promise<void> {
  const tmp = uniqueTmpPath(path)
  if (typeof data === 'string') await writeFile(tmp, data, 'utf8')
  else await writeFile(tmp, data)
  try {
    await rename(tmp, path)
  } catch (err) {
    // rename() can fail after the tmp file was written successfully
    // (disk full, an AV/indexer holding a lock on Windows, a permissions
    // error, the process dying between the two calls). Without this,
    // the tmp file could be orphaned. If even the process death itself
    // strands a `.tmp` (no catch block runs at all), the startup sweep
    // in sweepOrphanPdfs() removes PDF tmp files — see that function's
    // doc comment. Best-effort only: if the unlink also fails there is
    // nothing further to do, and surfacing that failure instead of the
    // original error would hide the real cause.
    await unlink(tmp).catch(() => {})
    throw err
  }
}

/**
 * Writes that have been requested but not yet finished (including ones
 * still queued behind a file lock). Lets the quit path in main/index.ts
 * wait for them: the renderer flushes autosave on window close, and
 * without this the process could exit between the tmp write and the
 * rename, silently dropping the operator's last edit.
 */
const inFlightWrites = new Set<Promise<void>>()

function track(write: Promise<void>): Promise<void> {
  inFlightWrites.add(write)
  const done = (): void => {
    inFlightWrites.delete(write)
  }
  write.then(done, done)
  return write
}

export function pendingWriteCount(): number {
  return inFlightWrites.size
}

/**
 * Resolve once every tracked write (including ones started while
 * waiting) has settled, or after `timeoutMs`. Returns true if all writes
 * drained, false on timeout. Never rejects — a failed write has already
 * been reported to its own caller.
 */
export async function waitForPendingWrites(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (inFlightWrites.size > 0) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) return false
    let timer: ReturnType<typeof setTimeout> | undefined
    const timedOut = new Promise<'timeout'>((r) => {
      timer = setTimeout(() => r('timeout'), remaining)
    })
    const result = await Promise.race([
      Promise.allSettled([...inFlightWrites]).then(() => 'drained' as const),
      timedOut
    ])
    clearTimeout(timer)
    if (result === 'timeout') return inFlightWrites.size === 0
  }
  return true
}

export async function atomicWriteJson(path: string, data: unknown): Promise<void> {
  await track(withFileLock(path, () => writeThenRename(path, JSON.stringify(data, null, 2))))
}

/**
 * Atomic binary write — same tmp-then-rename guarantee as
 * atomicWriteJson, but for buffers. The JSON variant cannot be reused
 * here: it JSON.stringifies and writes utf8, which would corrupt a PDF.
 *
 * The tmp file is created in the destination directory so the rename
 * stays on one filesystem and therefore stays atomic.
 */
export async function atomicWriteFile(path: string, data: Uint8Array): Promise<void> {
  await track(withFileLock(path, () => writeThenRename(path, data)))
}
