/**
 * Backup engine — zip/unzip the user library.
 *
 * Zip layout mirrors <userData> 1:1 so the archive is trivially
 * human-inspectable:
 *
 *   manifest.json              { version, createdAt, appVersion, counts }
 *   library/songs/*.json
 *   library/setlists/*.json
 *   themes/*.json
 *   settings.json
 *   fonts/index.json + *.ttf   (when present)
 *   media/*                    (when present)
 *
 * Excluded (intentional):
 *   - bible-cache/              re-downloadable, would bloat every zip
 *   - license.json              machine-bound; must not cross machines
 *   - device.json               machine-bound
 *
 * Why adm-zip and not archiver/yauzl:
 *   Sync API is fine here — libraries are MB-scale, we run on the main
 *   process, and synchronous code is easier to reason about for
 *   rotation + import-then-restore flows. adm-zip has been stable for
 *   ~10 years with no native deps, so it survives electron upgrades.
 */

import AdmZip from 'adm-zip'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'fs'
import { readdir, readFile } from 'fs/promises'
import { join } from 'path'
import { app } from 'electron'
import {
  getSongsDir,
  getSetlistsDir,
  getThemesDir,
  getFontsDir,
  getMediaDir,
  getSettingsPath
} from './paths'

// ── Types ────────────────────────────────────────────────────────────

export interface BackupManifest {
  /** Manifest schema version. Bump when the zip layout changes. */
  version: 1
  /** ISO timestamp of when the zip was created. */
  createdAt: string
  /** App version at creation time — for forward-migration decisions. */
  appVersion: string
  counts: {
    songs: number
    setlists: number
    themes: number
  }
}

export type ImportMode = 'merge' | 'replace'

export interface ImportResult {
  imported: {
    songs: number
    setlists: number
    themes: number
  }
  manifest: BackupManifest
  /** Path to the safety backup written before import was applied. */
  safetyBackupPath: string
}

// ── Backup directory (hidden; inside userData) ──────────────────────

/**
 * Backups live under `<userData>/backups/` — hidden from casual file
 * browsing. Users interact with backups exclusively through the in-app
 * Restore UI. Power users who need the raw zip (e.g., to copy to a
 * USB drive) use the "Open backup folder" button which shells out to
 * Finder/Explorer at this path.
 */
export function getBackupsDir(): string {
  return join(app.getPath('userData'), 'backups')
}

export function ensureBackupsDir(): void {
  const dir = getBackupsDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

/**
 * Deterministic filename for a backup zip based on a Date. Sortable
 * lexicographically, so `readdir` + sort is equivalent to sort-by-time.
 * Example: `backup-20260415-093022.zip`
 */
export function backupFilename(date: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  const y = date.getFullYear()
  const m = pad(date.getMonth() + 1)
  const d = pad(date.getDate())
  const hh = pad(date.getHours())
  const mm = pad(date.getMinutes())
  const ss = pad(date.getSeconds())
  return `backup-${y}${m}${d}-${hh}${mm}${ss}.zip`
}

// ── Export ───────────────────────────────────────────────────────────

/**
 * Recursively add every file under `srcDir` to `zip` at the given
 * zip-internal prefix. Skips nothing — if you want to exclude a
 * subtree, don't pass it in.
 */
async function addDirToZip(
  zip: AdmZip,
  srcDir: string,
  zipPrefix: string
): Promise<void> {
  if (!existsSync(srcDir)) return
  const entries = await readdir(srcDir, { withFileTypes: true })
  for (const entry of entries) {
    const abs = join(srcDir, entry.name)
    const rel = `${zipPrefix}/${entry.name}`
    if (entry.isDirectory()) {
      await addDirToZip(zip, abs, rel)
    } else if (entry.isFile()) {
      zip.addLocalFile(abs, zipPrefix)
    }
  }
}

async function countJsonFiles(dir: string): Promise<number> {
  if (!existsSync(dir)) return 0
  const entries = await readdir(dir)
  return entries.filter((f) => f.endsWith('.json')).length
}

/**
 * Write a full library snapshot to `destPath`. Overwrites the file if
 * it already exists. Caller is responsible for choosing a unique path.
 */
export async function exportLibrary(destPath: string): Promise<BackupManifest> {
  const zip = new AdmZip()

  const manifest: BackupManifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    appVersion: app.getVersion(),
    counts: {
      songs: await countJsonFiles(getSongsDir()),
      setlists: await countJsonFiles(getSetlistsDir()),
      themes: await countJsonFiles(getThemesDir())
    }
  }
  zip.addFile(
    'manifest.json',
    Buffer.from(JSON.stringify(manifest, null, 2), 'utf8')
  )

  // Library: songs + setlists
  await addDirToZip(zip, getSongsDir(), 'library/songs')
  await addDirToZip(zip, getSetlistsDir(), 'library/setlists')

  // Themes
  await addDirToZip(zip, getThemesDir(), 'themes')

  // Settings (single file)
  const settingsPath = getSettingsPath()
  if (existsSync(settingsPath)) {
    const buf = await readFile(settingsPath)
    zip.addFile('settings.json', buf)
  }

  // Fonts (index + actual ttf/otf files)
  await addDirToZip(zip, getFontsDir(), 'fonts')

  // Media (user images/videos)
  await addDirToZip(zip, getMediaDir(), 'media')

  zip.writeZip(destPath)
  return manifest
}

// ── Import ───────────────────────────────────────────────────────────

/**
 * Read and validate the manifest from a backup zip. Throws on missing
 * or malformed manifest — callers should try/catch to show a friendly
 * "not a valid backup" message.
 */
export function readBackupManifest(zipPath: string): BackupManifest {
  const zip = new AdmZip(zipPath)
  const entry = zip.getEntry('manifest.json')
  if (!entry) {
    throw new Error('Not a valid ProChurchCenter Present backup (no manifest).')
  }
  const parsed = JSON.parse(entry.getData().toString('utf8')) as BackupManifest
  if (parsed.version !== 1) {
    throw new Error(
      `Backup was created by a newer version (schema v${parsed.version}). Update the app to restore it.`
    )
  }
  return parsed
}

/**
 * Extract the zip entries matching `zipPrefix` into `destDir`. Files
 * are written with their basename; subdirectories are preserved.
 * Returns the count of files extracted.
 */
function extractPrefix(
  zip: AdmZip,
  zipPrefix: string,
  destDir: string
): number {
  if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true })
  let count = 0
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue
    if (!entry.entryName.startsWith(`${zipPrefix}/`)) continue
    const rel = entry.entryName.slice(zipPrefix.length + 1)
    // `extractEntryTo(entry, targetPath, maintainEntryPath, overwrite)`
    // We pass the computed target directory and strip the prefix so
    // nested dirs (e.g., `media/backgrounds/x.jpg`) land correctly.
    const targetDir = join(destDir, rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '')
    if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true })
    const basename = rel.includes('/') ? rel.slice(rel.lastIndexOf('/') + 1) : rel
    writeFileSync(join(targetDir, basename), entry.getData())
    count++
  }
  return count
}

/**
 * Delete every file directly under `dir` (shallow — does NOT recurse
 * into subdirs, since none of our storage dirs are nested). Used by
 * `replace` mode to clear the target before extraction.
 */
function clearDir(dir: string): void {
  if (!existsSync(dir)) return
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isFile()) rmSync(p)
    else if (st.isDirectory()) rmSync(p, { recursive: true, force: true })
  }
}

/**
 * Restore a library from a backup zip.
 *
 * Safety contract: ALWAYS writes a pre-import safety backup first, so
 * if anything goes wrong the user can roll back by restoring the
 * safety backup. The path is returned in the result for the UI to
 * surface.
 *
 * `merge` mode: files in the zip are written over any same-named file
 * locally. Local files not in the zip are kept untouched. This is the
 * default and safest mode for "I want my songs on a different
 * machine."
 *
 * `replace` mode: every file under library/, themes/, fonts/, media/
 * is deleted first, then the zip contents are extracted. Settings is
 * overwritten. Use when the user wants the local library to EXACTLY
 * match the zip (e.g., syncing from a master laptop).
 */
export async function importLibrary(
  zipPath: string,
  mode: ImportMode
): Promise<ImportResult> {
  const manifest = readBackupManifest(zipPath)

  // Safety backup FIRST, before we touch anything on disk.
  ensureBackupsDir()
  const safetyBackupPath = join(
    getBackupsDir(),
    `pre-import-${backupFilename()}`
  )
  await exportLibrary(safetyBackupPath)

  const zip = new AdmZip(zipPath)

  if (mode === 'replace') {
    clearDir(getSongsDir())
    clearDir(getSetlistsDir())
    clearDir(getThemesDir())
    clearDir(getFontsDir())
    clearDir(getMediaDir())
  }

  const imported = {
    songs: extractPrefix(zip, 'library/songs', getSongsDir()),
    setlists: extractPrefix(zip, 'library/setlists', getSetlistsDir()),
    themes: extractPrefix(zip, 'themes', getThemesDir())
  }

  // Fonts + media — count isn't surfaced in ImportResult, but still restore.
  extractPrefix(zip, 'fonts', getFontsDir())
  extractPrefix(zip, 'media', getMediaDir())

  // Settings — single file, always overwrite if present in the zip.
  const settingsEntry = zip.getEntry('settings.json')
  if (settingsEntry) {
    writeFileSync(getSettingsPath(), settingsEntry.getData())
  }

  return { imported, manifest, safetyBackupPath }
}

// ── Listing (for the Restore UI) ─────────────────────────────────────

export interface BackupListEntry {
  filename: string
  absolutePath: string
  sizeBytes: number
  createdAt: string
  manifest: BackupManifest | null
}

/**
 * List every backup zip in the backups directory, newest first.
 * Safety backups (prefixed `pre-import-`) are included — they're real
 * restore points. Manifest may be null if a zip is somehow corrupt;
 * the UI should grey those out rather than crash.
 */
export async function listBackups(): Promise<BackupListEntry[]> {
  ensureBackupsDir()
  const dir = getBackupsDir()
  const names = readdirSync(dir).filter((f) => f.endsWith('.zip'))
  const entries: BackupListEntry[] = []
  for (const name of names) {
    const abs = join(dir, name)
    const st = statSync(abs)
    let manifest: BackupManifest | null = null
    try {
      manifest = readBackupManifest(abs)
    } catch {
      manifest = null
    }
    entries.push({
      filename: name,
      absolutePath: abs,
      sizeBytes: st.size,
      createdAt: manifest?.createdAt ?? st.mtime.toISOString(),
      manifest
    })
  }
  entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return entries
}

/**
 * Keep the most recent `keep` auto backups, delete the rest. Pre-import
 * safety backups are PRESERVED separately (different prefix) so rotation
 * never deletes a rollback point the user might still need.
 */
export function rotateBackups(keep: number): void {
  ensureBackupsDir()
  const dir = getBackupsDir()
  const names = readdirSync(dir)
    .filter((f) => f.startsWith('backup-') && f.endsWith('.zip'))
    .sort() // lex sort = chronological, since our filenames are timestamped
  const excess = names.length - keep
  if (excess <= 0) return
  for (let i = 0; i < excess; i++) {
    rmSync(join(dir, names[i]))
  }
}
