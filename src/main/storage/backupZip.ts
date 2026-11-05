/**
 * Zip building for backups — runs inside a worker thread (see
 * backupZipWorker.ts), with an in-process fallback.
 *
 * Kept free of `electron` imports: it must load inside a plain Node
 * worker, and it is unit tested under vitest.
 *
 * Why this exists: exportLibrary used adm-zip's sync `addLocalFile` +
 * `writeZip` on the main process. With a few GB of media that froze the
 * main process for seconds — output-window IPC included, so the
 * projector stopped advancing mid-service while the 5s-after-launch
 * auto-backup ran. It also wrote straight to the final filename, so a
 * crash or full disk left a truncated `backup-*.zip` that the Restore
 * list showed as a real restore point.
 */

import AdmZip from 'adm-zip'
import { readFile, rename, rm, writeFile } from 'fs/promises'
import { randomBytes } from 'crypto'

export interface ZipPlanEntry {
  /** Path inside the zip, e.g. `library/songs/<id>.json`. */
  zipPath: string
  /** Read from disk when building… */
  absPath?: string
  /** …or use these bytes (manifest). */
  data?: Uint8Array
}

export interface ZipPlan {
  /** Marker so the worker never acts on someone else's workerData. */
  kind: 'backup-zip'
  destPath: string
  /** Same directory as destPath, so the final rename is atomic. */
  tmpPath: string
  entries: ZipPlanEntry[]
}

/**
 * `<dest>.<8 hex>.tmp`, e.g. `backup-20260415-093022.zip.1a2b3c4d.tmp`.
 * Doesn't end in `.zip`, so listBackups() and rotation never see it.
 */
export function tmpZipPathFor(destPath: string): string {
  return `${destPath}.${randomBytes(4).toString('hex')}.tmp`
}

/** Matches names produced by {@link tmpZipPathFor}. */
export const TMP_ZIP_RE = /\.zip\.[0-9a-f]{8}\.tmp$/

/**
 * Build the zip described by `plan` into `tmpPath`, then rename it to
 * `destPath`. Async throughout: file reads go through fs/promises and
 * compression through adm-zip's `toBufferPromise` (zlib's async API),
 * so even the in-process fallback yields between files instead of
 * blocking the event loop for the whole archive.
 */
export async function buildZip(plan: ZipPlan): Promise<void> {
  const zip = new AdmZip()
  for (const entry of plan.entries) {
    const data =
      entry.data !== undefined
        ? Buffer.from(entry.data)
        : await readFile(entry.absPath as string)
    zip.addFile(entry.zipPath, data)
  }
  const buf = await zip.toBufferPromise()
  try {
    await writeFile(plan.tmpPath, buf)
    await rename(plan.tmpPath, plan.destPath)
  } catch (err) {
    // Never leave a half-written archive behind; the original error is
    // the one worth surfacing.
    await rm(plan.tmpPath, { force: true }).catch(() => {})
    throw err
  }
}
