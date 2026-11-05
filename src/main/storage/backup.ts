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
 *   adm-zip has been stable for ~10 years with no native deps, so it
 *   survives electron upgrades. Export builds the archive in a worker
 *   thread (backupZip.ts) — media folders are GB-scale, not MB-scale,
 *   and a sync zip on the main process froze output IPC. Restore still
 *   extracts synchronously: it's an explicit, modal operator action.
 */

import AdmZip from 'adm-zip'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'fs'
import { mkdtemp, readdir, rm } from 'fs/promises'
import { dirname, join } from 'path'
import type { Worker } from 'worker_threads'
import { app } from 'electron'
import { resolveInside } from './safePath'
import {
  ensureDirectories,
  getSongsDir,
  getSetlistsDir,
  getThemesDir,
  getFontsDir,
  getMediaDir,
  getSettingsPath
} from './paths'
import { withFileLock } from './atomic'
import { parseStoredSettings } from './settings'
import { ensureDefaultTheme } from './theme'
import { buildZip, tmpZipPathFor, TMP_ZIP_RE, type ZipPlan, type ZipPlanEntry } from './backupZip'
import createZipWorker from './backupZipWorker?nodeWorker'

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
 * Recursively list every file under `srcDir` as zip entries under the
 * given zip-internal prefix. Skips nothing — if you want to exclude a
 * subtree, don't pass it in. Only paths are collected here; the bytes
 * are read by the zip builder (off the main thread).
 */
async function collectDir(
  srcDir: string,
  zipPrefix: string,
  out: ZipPlanEntry[]
): Promise<void> {
  if (!existsSync(srcDir)) return
  const entries = await readdir(srcDir, { withFileTypes: true })
  for (const entry of entries) {
    const abs = join(srcDir, entry.name)
    const rel = `${zipPrefix}/${entry.name}`
    if (entry.isDirectory()) {
      await collectDir(abs, rel, out)
    } else if (entry.isFile()) {
      out.push({ zipPath: rel, absPath: abs })
    }
  }
}

async function countJsonFiles(dir: string): Promise<number> {
  if (!existsSync(dir)) return 0
  const entries = await readdir(dir)
  return entries.filter((f) => f.endsWith('.json')).length
}

/**
 * Build the zip in a worker thread so a multi-GB media folder can't
 * stall the main process (and with it every output-window IPC). Falls
 * back to the async in-process builder if the worker can't start —
 * e.g. a packaging problem loading the worker chunk — so a backup is
 * never skipped just because threading failed.
 */
async function writeZip(plan: ZipPlan): Promise<void> {
  let worker: Worker
  try {
    worker = createZipWorker({ workerData: plan })
  } catch (err) {
    console.warn('[backup] zip worker unavailable, building in-process:', err)
    return buildZip(plan)
  }
  const outcome = await new Promise<
    { ok: true } | { ok: false; message: string } | { crashed: unknown }
  >((resolve) => {
    worker.once('message', resolve)
    worker.once('error', (err) => resolve({ crashed: err }))
    // Only meaningful if no message arrived first (resolve is idempotent).
    worker.once('exit', (code) => resolve({ crashed: new Error(`exited with code ${code}`) }))
  })
  if ('crashed' in outcome) {
    console.warn('[backup] zip worker failed, building in-process:', outcome.crashed)
    return buildZip(plan)
  }
  if (!outcome.ok) throw new Error(outcome.message)
}

/**
 * Write a full library snapshot to `destPath`. Overwrites the file if
 * it already exists. Caller is responsible for choosing a unique path.
 *
 * The archive is written to a tmp name in the same folder and renamed
 * into place only once complete, so a crash / full disk never leaves a
 * truncated zip that the Restore list would offer as a restore point.
 */
export async function exportLibrary(destPath: string): Promise<BackupManifest> {
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
  const entries: ZipPlanEntry[] = [
    {
      zipPath: 'manifest.json',
      data: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8')
    }
  ]

  // Library: songs + setlists
  await collectDir(getSongsDir(), 'library/songs', entries)
  await collectDir(getSetlistsDir(), 'library/setlists', entries)

  // Themes
  await collectDir(getThemesDir(), 'themes', entries)

  // Settings (single file)
  const settingsPath = getSettingsPath()
  if (existsSync(settingsPath)) {
    entries.push({ zipPath: 'settings.json', absPath: settingsPath })
  }

  // Fonts (index + actual ttf/otf files)
  await collectDir(getFontsDir(), 'fonts', entries)

  // Media (user images/videos)
  await collectDir(getMediaDir(), 'media', entries)

  await writeZip({ kind: 'backup-zip', destPath, tmpPath: tmpZipPathFor(destPath), entries })
  return manifest
}

/**
 * Delete `*.zip.<hex>.tmp` files a crashed export left in the backups
 * folder. Only ones older than an hour, so an export that is running
 * right now (e.g. a manual "Back up now") is never pulled out from
 * under its own rename.
 */
export async function sweepStaleZipTmps(maxAgeMs = 60 * 60 * 1000): Promise<void> {
  ensureBackupsDir()
  const dir = getBackupsDir()
  for (const name of readdirSync(dir)) {
    if (!TMP_ZIP_RE.test(name)) continue
    const abs = join(dir, name)
    try {
      if (Date.now() - statSync(abs).mtimeMs > maxAgeMs) await rm(abs, { force: true })
    } catch (err) {
      console.warn('[backup] could not remove stale tmp zip', abs, err)
    }
  }
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
    // Strip the prefix and keep the rest of the entry path so nested
    // dirs (e.g., `media/backgrounds/x.jpg`) land correctly.
    //
    // Zip-slip guard: the zip comes from the user's disk and an entry
    // name is an arbitrary string, so `library/songs/../../../x` must
    // not be allowed to write outside destDir. Skip (rather than abort)
    // so one hostile/corrupt entry doesn't fail an otherwise good
    // restore.
    const target = resolveInside(destDir, rel)
    if (!target) {
      console.warn('[backup] skipping zip entry outside its folder:', entry.entryName)
      continue
    }
    const targetDir = dirname(target)
    if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true })
    writeFileSync(target, entry.getData())
    count++
  }
  return count
}

export interface PathSwap {
  /** Fully prepared replacement (file or directory). */
  staged: string
  /** Where it goes. May not exist yet. */
  live: string
  /** Where the current `live` is parked until the swap commits. */
  parked: string
}

/**
 * Install every `staged` path at its `live` location, all-or-nothing:
 * current live paths are renamed aside to `parked` first (renaming a
 * directory over an existing one fails on Windows), then each staged
 * path is renamed in. If any step fails, every completed step is undone
 * in reverse order and the original error is rethrown, so the library
 * is left exactly as it was. Renames stay on one filesystem (staging
 * lives inside userData), so each one is atomic and copies nothing.
 *
 * The caller deletes the parked paths after a successful swap.
 */
export function swapInPaths(swaps: PathSwap[]): void {
  const done: Array<{ swap: PathSwap; parked: boolean; installed: boolean }> = []
  try {
    for (const swap of swaps) {
      const step = { swap, parked: false, installed: false }
      done.push(step)
      if (existsSync(swap.live)) {
        renameSync(swap.live, swap.parked)
        step.parked = true
      }
      renameSync(swap.staged, swap.live)
      step.installed = true
    }
  } catch (err) {
    for (const { swap, parked, installed } of done.reverse()) {
      try {
        if (installed) renameSync(swap.live, swap.staged)
        if (parked) renameSync(swap.parked, swap.live)
      } catch (rollbackErr) {
        console.error('[backup] rollback failed for', swap.live, rollbackErr)
      }
    }
    throw err
  }
}

/**
 * Merge-mode apply: move every file under `stagedDir` to the same
 * relative path under `liveDir`, overwriting same-named files. Each
 * move is a rename, so every file ends up either fully old or fully
 * new — never half-written — and nothing local is ever deleted.
 */
function moveTreeInto(stagedDir: string, liveDir: string): void {
  for (const entry of readdirSync(stagedDir, { withFileTypes: true })) {
    const from = join(stagedDir, entry.name)
    const to = join(liveDir, entry.name)
    if (entry.isDirectory()) {
      moveTreeInto(from, to)
    } else {
      mkdirSync(liveDir, { recursive: true })
      renameSync(from, to)
    }
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
 * Every entry is first extracted into a staging folder inside userData;
 * live data is only touched once the whole zip has been read
 * successfully. A corrupt or truncated zip therefore fails before
 * anything changes.
 *
 * `merge` mode: files in the zip are written over any same-named file
 * locally. Local files not in the zip are kept untouched. This is the
 * default and safest mode for "I want my songs on a different
 * machine."
 *
 * `replace` mode: library/, themes/, fonts/, media/ are swapped for the
 * zip's contents as a unit (see {@link swapInPaths}) — previously each
 * folder was emptied first and then extracted into, so any failure
 * part-way left the library wiped. Use when the user wants the local
 * library to EXACTLY match the zip (e.g., syncing from a master laptop).
 *
 * Both modes: settings.json from the zip is installed only if it parses
 * as a settings object; otherwise the current settings are kept. The
 * default theme is re-seeded afterwards, since a zip without themes/
 * would otherwise leave the app with no 'default' theme until restart.
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
  const targets = [
    { prefix: 'library/songs', live: getSongsDir() },
    { prefix: 'library/setlists', live: getSetlistsDir() },
    { prefix: 'themes', live: getThemesDir() },
    { prefix: 'fonts', live: getFontsDir() },
    { prefix: 'media', live: getMediaDir() }
  ]

  // Inside userData so every rename below stays on one filesystem.
  const staging = await mkdtemp(join(app.getPath('userData'), '.restore-staging-'))
  let counts: number[]
  try {
    // 1. Stage. Any unreadable entry throws here, with live data untouched.
    counts = targets.map((t, i) => extractPrefix(zip, t.prefix, join(staging, `new-${i}`)))

    let stagedSettings: string | null = null
    const settingsEntry = zip.getEntry('settings.json')
    if (settingsEntry) {
      const text = settingsEntry.getData().toString('utf8')
      if (parseStoredSettings(text)) {
        stagedSettings = join(staging, 'settings.json')
        writeFileSync(stagedSettings, text, 'utf8')
      } else {
        // Raw bytes used to be written straight over settings.json; a
        // damaged entry would then reset every setting on next launch.
        console.warn('[backup] settings.json in backup is not valid; keeping current settings')
      }
    }

    // 2. Apply.
    if (mode === 'replace') {
      const swaps: PathSwap[] = targets.map((t, i) => ({
        staged: join(staging, `new-${i}`),
        live: t.live,
        parked: join(staging, `old-${i}`)
      }))
      // Settings joins the same all-or-nothing swap. Held under the
      // settings lock so a concurrent getSettings can't observe the
      // moment between park and install and seed defaults there.
      await withFileLock(getSettingsPath(), async () => {
        swapInPaths(
          stagedSettings
            ? [
                ...swaps,
                { staged: stagedSettings, live: getSettingsPath(), parked: join(staging, 'old-settings.json') }
              ]
            : swaps
        )
      })
    } else {
      targets.forEach((t, i) => moveTreeInto(join(staging, `new-${i}`), t.live))
      if (stagedSettings) {
        const staged = stagedSettings
        await withFileLock(getSettingsPath(), async () => renameSync(staged, getSettingsPath()))
      }
    }
  } finally {
    // Also removes the parked old library after a successful replace.
    await rm(staging, { recursive: true, force: true }).catch((err) => {
      console.warn('[backup] could not remove restore staging folder', staging, err)
    })
  }

  // A replace swaps out media/ wholesale, so media/canva etc. may be gone.
  ensureDirectories()
  await ensureDefaultTheme()

  const imported = { songs: counts[0], setlists: counts[1], themes: counts[2] }
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
 * Filename prefix that marks a zip as written by the auto-backup
 * scheduler, e.g. `auto-backup-20260415-093022.zip`. Rotation only ever
 * deletes files carrying this prefix.
 *
 * Why a separate prefix: "Back up now" (ipc/backup.ts exportNow) and the
 * scheduler both used plain `backup-<timestamp>.zip`, so rotation could
 * not tell them apart and would delete a backup the operator deliberately
 * made. Files written before this prefix existed are all plain
 * `backup-*.zip` and are indistinguishable from manual ones, so they are
 * NEVER rotated — leaking a few old zips is recoverable, deleting a
 * deliberate manual backup is not.
 */
export const AUTO_BACKUP_PREFIX = 'auto-'

/** Filename for a scheduler-written backup. See {@link AUTO_BACKUP_PREFIX}. */
export function autoBackupFilename(date: Date = new Date()): string {
  return `${AUTO_BACKUP_PREFIX}${backupFilename(date)}`
}

/**
 * Pure selection step of {@link rotateBackups}: given the backups-dir
 * listing, the auto-backup filenames to delete so only the newest `keep`
 * remain. Manual, legacy and pre-import safety zips are never selected.
 */
export function selectAutoBackupsToRotate(names: string[], keep: number): string[] {
  const auto = names
    .filter((f) => f.startsWith(AUTO_BACKUP_PREFIX) && f.endsWith('.zip'))
    .sort() // lex sort = chronological, since our filenames are timestamped
  const excess = auto.length - Math.max(0, keep)
  return excess > 0 ? auto.slice(0, excess) : []
}

/**
 * Keep the most recent `keep` auto backups, delete the rest. Manual
 * ("Back up now") and pre-import safety backups are PRESERVED — see
 * {@link AUTO_BACKUP_PREFIX} — so rotation never deletes a rollback
 * point the user might still need.
 */
export function rotateBackups(keep: number): void {
  ensureBackupsDir()
  const dir = getBackupsDir()
  for (const name of selectAutoBackupsToRotate(readdirSync(dir), keep)) {
    rmSync(join(dir, name))
  }
}
