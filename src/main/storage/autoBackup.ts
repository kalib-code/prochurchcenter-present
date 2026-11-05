/**
 * Auto-backup scheduler — launch-triggered daily snapshot.
 *
 * Wired from main/index.ts inside `app.whenReady()`. We wait 5 seconds
 * after the operator window is ready before running so the backup
 * never blocks the window opening. That matters on Sunday morning
 * when a stressed volunteer launches the app 10 minutes before service
 * and expects the UI to appear instantly — a 1-2 second freeze while
 * we zip the library would be a terrible first impression.
 *
 * State is persisted inside the backups directory itself as
 * `auto-backup-state.json`, not inside settings.json. Two reasons:
 *   1. It's a private implementation detail — the scheduler's concern,
 *      not user-facing configuration.
 *   2. Keeps settings.json clean and diffable. Settings backups remain
 *      human-inspectable without noisy timestamps churning on every launch.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import {
  autoBackupFilename,
  ensureBackupsDir,
  exportLibrary,
  getBackupsDir,
  rotateBackups,
  sweepStaleZipTmps
} from './backup'

// ── Tunables ─────────────────────────────────────────────────────────

/** Keep the 7 most recent scheduled backups, delete older. */
export const AUTO_BACKUP_KEEP = 7

/** Minimum milliseconds between backups. 24 hours. */
export const AUTO_BACKUP_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000

/** Delay after app ready before firing the backup check. 5 seconds. */
export const AUTO_BACKUP_STARTUP_DELAY_MS = 5000

// ── Persisted state ──────────────────────────────────────────────────

interface AutoBackupState {
  /** ISO timestamp of the most recent successful auto backup, or null. */
  lastBackupAt: string | null
  /** Tally — used by the Settings status readout. */
  totalBackupsRun: number
}

function statePath(): string {
  return join(getBackupsDir(), 'auto-backup-state.json')
}

export function readAutoBackupState(): AutoBackupState {
  ensureBackupsDir()
  const path = statePath()
  if (!existsSync(path)) {
    return { lastBackupAt: null, totalBackupsRun: 0 }
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<AutoBackupState>
    return {
      lastBackupAt: parsed.lastBackupAt ?? null,
      totalBackupsRun: parsed.totalBackupsRun ?? 0
    }
  } catch {
    // Corrupt state file — fail open rather than failing the whole
    // scheduler. Worst case we do one extra backup today.
    return { lastBackupAt: null, totalBackupsRun: 0 }
  }
}

function writeAutoBackupState(state: AutoBackupState): void {
  writeFileSync(statePath(), JSON.stringify(state, null, 2), 'utf8')
}

// ── Decision (YOU WRITE THIS) ────────────────────────────────────────

/**
 * Decide whether the scheduler should fire a backup right now.
 *
 * Called on every app launch (once, ~5s after the window opens). If
 * this returns true, the scheduler runs a backup and updates state.
 * If false, the scheduler does nothing until next launch.
 *
 * This is the entire UX philosophy of auto-backup in one function.
 * Get this wrong and you either:
 *   - Back up too aggressively (every launch) → churns disk, user
 *     sees 7 backups all from today and real history is lost
 *   - Back up too conservatively (never, or only once) → user loses
 *     work between the two times they remembered to open the app
 *
 * The rules you probably want:
 *   1. If we've never backed up → back up now (first-run seed)
 *   2. If last backup was more than AUTO_BACKUP_MIN_INTERVAL_MS ago
 *      → back up now
 *   3. If last backup was recent (< AUTO_BACKUP_MIN_INTERVAL_MS)
 *      → skip
 *   4. If `lastBackupAt` is an invalid date (corrupt state) → back up
 *      now (fail open — safer to over-backup than to miss one)
 *
 * @param state    The currently-persisted auto-backup state
 * @param now      Current timestamp (passed in so tests can mock it)
 * @returns true if we should fire a backup, false to skip this launch
 */
export function shouldBackupNow(
  state: AutoBackupState,
  now: Date = new Date()
): boolean {
  // Rule 1: first run, no history → seed the backup chain
  if (state.lastBackupAt === null) return true

  // Rule 2: corrupt state → fail open (safer to over-backup)
  const last = new Date(state.lastBackupAt)
  if (Number.isNaN(last.getTime())) return true

  // Rule 3: enough time has passed → back up
  const elapsed = now.getTime() - last.getTime()
  if (elapsed >= AUTO_BACKUP_MIN_INTERVAL_MS) return true

  // Rule 4: recent backup exists → skip this launch
  return false
}

// ── Scheduler entry point ────────────────────────────────────────────

/**
 * Called once from main/index.ts after `app.whenReady`. Runs the
 * `shouldBackupNow` check, and if it passes, writes a backup and
 * rotates the oldest out. Never throws — a backup failure must not
 * crash the operator window. Errors are logged and swallowed.
 */
export async function runAutoBackupOnLaunch(): Promise<void> {
  // Small startup delay so we don't fight the window-opening frame.
  await new Promise<void>((r) => setTimeout(r, AUTO_BACKUP_STARTUP_DELAY_MS))

  // Clear zips a crashed export left half-written (they're tmp-named,
  // so they never showed in Restore, but they do take disk space).
  await sweepStaleZipTmps().catch((err) => console.warn('[autoBackup] tmp sweep failed:', err))

  const state = readAutoBackupState()
  if (!shouldBackupNow(state)) return

  try {
    ensureBackupsDir()
    // `auto-` prefix so rotateBackups() deletes only scheduler-written
    // zips, never a manual "Back up now" one (see AUTO_BACKUP_PREFIX).
    // exportLibrary builds the zip in a worker thread and renames it
    // into place only when complete, so this no longer freezes the
    // operator/output windows or leaves a truncated zip on a crash.
    const path = join(getBackupsDir(), autoBackupFilename())
    await exportLibrary(path)
    rotateBackups(AUTO_BACKUP_KEEP)
    writeAutoBackupState({
      lastBackupAt: new Date().toISOString(),
      totalBackupsRun: state.totalBackupsRun + 1
    })
    console.log('[autoBackup] wrote', path)
  } catch (err) {
    console.error('[autoBackup] failed:', err)
  }
}
