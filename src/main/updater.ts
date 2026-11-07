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
 * macOS without a Developer ID signature (until Phase 10b):
 *   Squirrel.Mac only installs updates for Developer ID-signed apps, so
 *   on an unsigned build the steps above can't work. At startup we ask
 *   `codesign` (see macSignature.ts). If we can't self-update, we turn
 *   off auto-download (no point fetching 140 MB that can't install) and
 *   on `update-available` show a "Download" dialog that opens the
 *   GitHub release page instead. Once the build is signed, the check
 *   passes and the normal flow above takes over with no code change.
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

import { app, dialog, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import { getOperatorWindow } from './windows'
import { isNewerVersion } from './versionCompare'
import { canSelfUpdateOnMac } from './macSignature'

const FIRST_CHECK_DELAY_MS = 5_000

const RELEASES_URL = 'https://github.com/kalib-code/prochurchcenter-present/releases'

let initialized = false

/**
 * True when this is a macOS build that can't install its own updates
 * (no Developer ID signature). Decided once by `updateModeReady`, which
 * every check awaits so a manual "Check for updates" click can't race
 * the codesign probe and start a download that would fail.
 */
let manualMacUpdates = false
let updateModeReady: Promise<void> = Promise.resolve()

/** Same re-stacking guard as restartDialogOpen, for the download dialog. */
let downloadDialogOpen = false

async function showDownloadDialog(version: string): Promise<void> {
  if (downloadDialogOpen) return
  downloadDialogOpen = true

  const parent = getOperatorWindow() ?? undefined

  try {
    const result = await dialog.showMessageBox(parent!, {
      type: 'info',
      buttons: ['Download', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'Update available',
      message: `ProChurchCenter Present v${version} is available.`,
      detail:
        'Click Download to open the download page in your browser. Install the new version the same way you installed this one. Your songs, setlists, and settings will be kept.\n\nIn the middle of a service? Click Later. We\'ll remind you the next time you open the app.'
    })

    if (result.response === 0) {
      void shell.openExternal(`${RELEASES_URL}/tag/v${version}`)
    }
  } finally {
    downloadDialogOpen = false
  }
}

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
    if (manualMacUpdates) void showDownloadDialog(info.version)
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
    void showRestartDialog(info.version)
  })
  autoUpdater.on('error', (err) => {
    // Non-fatal — keep the app running on the current version.
    console.error('[updater] update check failed:', err.message ?? err)
  })

  if (process.platform === 'darwin') {
    updateModeReady = canSelfUpdateOnMac(app.getPath('exe')).then((canSelfUpdate) => {
      manualMacUpdates = !canSelfUpdate
      if (manualMacUpdates) {
        autoUpdater.autoDownload = false
        console.log('[updater] unsigned macOS build: updates will link to the download page')
      }
    })
  }

  // Defer the first check so the windows are visible before any
  // network activity competes with the first paint.
  setTimeout(() => {
    updateModeReady
      .then(() => autoUpdater.checkForUpdates())
      .catch((err) => {
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
    await updateModeReady
    const result = await autoUpdater.checkForUpdates()
    if (!result) {
      return { status: 'up-to-date', currentVersion }
    }
    const newVersion = result.updateInfo.version
    // electron-updater returns a non-null result even when you're on
    // the latest — the result carries `updateInfo` for the release
    // it checked against. Order the versions properly: a plain `!==`
    // reported an OLDER feed version (a pulled release, a prerelease
    // build running locally) as "update available". Also honour the
    // updater's own verdict (staged rollout, min OS version), since it
    // won't download anything it considers unavailable.
    if (result.isUpdateAvailable === false || !isNewerVersion(newVersion, currentVersion)) {
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
