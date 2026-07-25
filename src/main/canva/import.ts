/**
 * Canva import pipeline: export → poll → download → atomic write.
 *
 * Downloaded PDFs live in userData/media/canva/. That location is not
 * incidental — media/ is already walked recursively by backup.ts, so
 * imported decks travel with a church's backup at no extra cost.
 *
 * Filenames include a timestamp so a refresh writes to a NEW path. That
 * matters beyond tidiness: pdf.js caches documents by path, so reusing
 * one path would serve the stale render until eviction.
 */

import { readdir, rm } from 'fs/promises'
import { join, basename, resolve, sep } from 'path'
import { net } from 'electron'
import { unixSecondsToIso, type CanvaImportProgress, type CanvaImportResult } from '@shared/canva'
import { getCanvaMediaDir } from '../storage/paths'
import { atomicWriteFile } from '../storage/atomic'
import { exportDesignToPdfUrl, getDesignUpdatedAt } from './api'

/** Keep filenames filesystem-safe across Windows, macOS, and Linux. */
function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 40)
}

export async function importDesign(
  designId: string,
  title: string,
  onProgress: (p: CanvaImportProgress) => void
): Promise<CanvaImportResult> {
  onProgress({ phase: 'exporting' })
  const downloadUrl = await exportDesignToPdfUrl(designId, () =>
    onProgress({ phase: 'exporting' })
  )

  onProgress({ phase: 'downloading' })
  // Download immediately — Canva's export URLs expire after 24 hours, so
  // the URL is never persisted anywhere.
  const res = await net.fetch(downloadUrl)
  if (!res.ok) throw new Error(`Could not download the exported PDF (${res.status}).`)
  const bytes = new Uint8Array(await res.arrayBuffer())

  const filename = `${safeSegment(designId)}-${Date.now()}.pdf`
  const pdfPath = join(getCanvaMediaDir(), filename)
  await atomicWriteFile(pdfPath, bytes)

  // Read updated_at AFTER exporting: an edit made mid-export should show
  // as stale next time rather than being silently recorded as current.
  const updatedAt = await getDesignUpdatedAt(designId)

  return { pdfPath, title, designUpdatedAt: unixSecondsToIso(updatedAt) }
}

/**
 * Delete a PDF this app owns. Refuses paths outside media/canva/ so a
 * malformed item can never point deletion at the user's own files.
 *
 * Uses `path.resolve` to normalize `..` segments before the prefix
 * check — a naive `startsWith(dir)` would let `<canva-dir>-evil/x` or
 * `<canva-dir>/../evil` slip past, either because it merely shares the
 * directory's string prefix or because it walks back out via `..`
 * (mirrors the guard in `src/main/ipc/backup.ts`).
 */
export async function deleteCanvaPdf(absPath: string): Promise<void> {
  const dir = resolve(getCanvaMediaDir())
  const normalized = resolve(absPath)
  const prefix = dir.endsWith(sep) ? dir : dir + sep
  if (!normalized.startsWith(prefix)) {
    console.warn('[canva] refusing to delete outside media/canva:', absPath)
    return
  }
  await rm(normalized, { force: true })
}

/**
 * Remove PDFs no setlist references any more.
 *
 * Refresh deletes the file it supersedes, which covers the main growth
 * vector; deleting a setlist item does not, which this covers.
 *
 * Compares by basename rather than full path, but this is safe: every
 * file in media/canva/ is flat (no subdirectories) and every filename
 * this module generates is unique (design id + millisecond timestamp),
 * so a basename collision between an unrelated referenced path and a
 * genuine orphan here is not a realistic occurrence.
 */
export async function sweepOrphanPdfs(referenced: string[]): Promise<number> {
  const dir = getCanvaMediaDir()
  const keep = new Set(referenced.map((p) => basename(p)))
  let removed = 0
  try {
    for (const name of await readdir(dir)) {
      if (!name.endsWith('.pdf') || keep.has(name)) continue
      await rm(join(dir, name), { force: true })
      removed++
    }
  } catch (err) {
    // Never block startup on housekeeping.
    console.error('[canva] orphan sweep failed', err)
  }
  return removed
}
