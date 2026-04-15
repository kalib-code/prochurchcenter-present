/**
 * updater — auto-update integration via electron-updater.
 *
 * Wires Present to GitHub Releases as the update source. Configuration
 * (provider, owner, repo) lives in electron-builder.yml's `publish`
 * block — electron-updater reads it from the bundled app-update.yml
 * that electron-builder generates at build time.
 *
 * Update flow:
 *   1. App boots, windows are created
 *   2. After a 5s delay (so it doesn't block startup or fight the
 *      first paint), we call autoUpdater.checkForUpdates()
 *   3. If a newer version exists on GitHub Releases, electron-updater
 *      downloads it silently in the background
 *   4. When the download finishes, `update-downloaded` fires and we
 *      show a modal dialog on the operator window:
 *        "Update v0.1.2 downloaded — restart now to install?"
 *      with buttons [ Restart now ] [ Later ]
 *   5. "Restart now" → `autoUpdater.quitAndInstall()` (app closes,
 *      installer runs, app relaunches on the new version)
 *   6. "Later" → dialog dismisses; the update sits cached and the
 *      dialog re-appears on the next launch's check
 *
 * Why a delay before the first check:
 *   Service starts on Sunday morning are time-sensitive. Spawning a
 *   network request DURING the first paint can stutter the UI on slow
 *   connections. A 5s delay puts the check after the windows are
 *   visible and interactive.
 *
 * Why autoInstallOnAppQuit is FALSE:
 *   The default (silent install on quit) is dangerous for a live-
 *   service app. Imagine Ate Rose quits the app mid-service to
 *   restart her laptop after a projector glitch, only to find the
 *   installer running on next launch and adding 30s to startup.
 *   We want updates to happen ONLY when the user explicitly opts in
 *   via the "Restart now" dialog — never as a side-effect of a
 *   panicked mid-service quit.
 *
 * macOS caveat (Phase 10b):
 *   Squirrel.Mac requires a valid Developer ID signature to apply
 *   updates. Until we're notarized, the download will succeed but
 *   installation will silently fail. We log a warning on update-
 *   downloaded when running unsigned on Darwin so the console at
 *   least shows what's happening.
 *
 * Dev mode behavior:
 *   electron-updater's checkForUpdates() is a no-op in development
 *   (it requires a packaged app to know the current version). We
 *   defensively skip the call entirely when `app.isPackaged === false`
 *   so we don't see "skip checkForUpdates because application is not
 *   packed and dev update config is not forced" warnings on every
 *   `pnpm dev` startup.
 *
 * Error handling:
 *   Network failures, missing release manifest, permission errors —
 *   all handled by autoUpdater's internal logging. We attach a single
 *   `error` listener that writes to the main-process console instead
 *   of crashing. Updates failing silently is the right behavior for a
 *   live-service app: we'd rather leave Ate Rose on the working old
 *   version than interrupt her with a popup mid-service.
 */

import { app, dialog } from 'electron'
import { autoUpdater } from 'electron-updater'
import { getOperatorWindow } from './windows'

const FIRST_CHECK_DELAY_MS = 5_000

let initialized = false

/**
 * Prevents the "Restart now?" dialog from re-stacking if multiple
 * update-downloaded events fire in quick succession (e.g., user
 * manually clicks "Check for updates" while an update is already
 * downloaded). Reset by `showRestartDialog` on dismiss.
 */
let restartDialogOpen = false

async function showRestartDialog(version: string): Promise<void> {
  if (restartDialogOpen) return
  restartDialogOpen = true

  const parent = getOperatorWindow() ?? undefined

  try {
    const result = await dialog.showMessageBox(parent!, {
      type: 'info',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'Update ready to install',
      message: `ProChurchCenter Present v${version} is ready to install.`,
      detail:
        'The app will close, install the update, and relaunch on the new version. Your songs, setlists, and settings will be preserved.\n\nIf you\'re in the middle of a service, click Later — the update will stay ready and this message will appear again next time you launch the app.'
    })

    if (result.response === 0) {
      // Restart now — electron-updater will close the app, run the
      // installer, and relaunch. This call never returns on success.
      autoUpdater.quitAndInstall()
    }
  } finally {
    restartDialogOpen = false
  }
}

export function initAutoUpdater(): void {
  if (initialized) return
  initialized = true

  // Skip entirely in development — the version is 0.0.0 and the
  // app-update.yml manifest doesn't exist outside the packaged build.
  if (!app.isPackaged) {
    console.log('[updater] dev mode — skipping auto-update setup')
    return
  }

  autoUpdater.autoDownload = true
  // Explicitly disabled — see the header doc comment. We want the
  // user to opt in via the dialog, not have updates ambush them on
  // the next quit.
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.on('checking-for-update', () => {
    console.log('[updater] checking for update…')
  })
  autoUpdater.on('update-available', (info) => {
    console.log(`[updater] update available: v${info.version}`)
  })
  autoUpdater.on('update-not-available', () => {
    console.log('[updater] up to date')
  })
  autoUpdater.on('download-progress', (progress) => {
    console.log(
      `[updater] downloading: ${Math.round(progress.percent)}% ` +
        `(${Math.round(progress.bytesPerSecond / 1024)} kB/s)`
    )
  })
  autoUpdater.on('update-downloaded', (info) => {
    console.log(
      `[updater] update downloaded: v${info.version} — prompting user to restart`
    )
    if (process.platform === 'darwin' && !app.isPackaged) {
      // Unreachable here (we early-return in dev), but documents the
      // real concern: unsigned macOS builds will silently fail to
      // install. Phase 10b (notarization) fixes this.
      console.warn(
        '[updater] macOS auto-install requires a valid Developer ID signature'
      )
    }
    void showRestartDialog(info.version)
  })
  autoUpdater.on('error', (err) => {
    // Non-fatal — keep the app running on the current version.
    console.error('[updater] update check failed:', err.message ?? err)
  })

  // Defer the first check so the windows are visible before any
  // network activity competes with the first paint.
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.error('[updater] checkForUpdates threw:', err)
    })
  }, FIRST_CHECK_DELAY_MS)
}

// ── Manual check (called by the Settings "Check for updates" button) ─

/**
 * Discriminated result for the renderer's manual "Check for updates"
 * action. The `dev` branch exists so the Settings UI can surface a
 * friendly "Auto-update is disabled in development" message instead
 * of silently doing nothing during `pnpm dev`.
 */
export type ManualCheckResult =
  | { status: 'up-to-date'; currentVersion: string }
  | { status: 'update-available'; currentVersion: string; newVersion: string }
  | { status: 'error'; message: string }
  | { status: 'dev'; currentVersion: string }

export async function manualCheckForUpdates(): Promise<ManualCheckResult> {
  const currentVersion = app.getVersion()

  if (!app.isPackaged) {
    return { status: 'dev', currentVersion }
  }

  try {
    const result = await autoUpdater.checkForUpdates()
    if (!result) {
      return { status: 'up-to-date', currentVersion }
    }
    const newVersion = result.updateInfo.version
    // electron-updater returns a non-null result even when you're on
    // the latest — the result carries `updateInfo` for the release
    // it checked against. Compare versions to decide the status.
    if (newVersion === currentVersion) {
      return { status: 'up-to-date', currentVersion }
    }
    return { status: 'update-available', currentVersion, newVersion }
  } catch (err) {
    return {
      status: 'error',
      message: err instanceof Error ? err.message : String(err)
    }
  }
}

export function getCurrentVersion(): string {
  return app.getVersion()
}
