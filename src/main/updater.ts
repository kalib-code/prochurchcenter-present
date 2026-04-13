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
 *   4. When the download finishes, the user sees a native dialog:
 *      "An update has been downloaded. Restart now to install?"
 *   5. They click yes → app quits, installs, relaunches
 *
 * Why a delay before the first check:
 *   Service starts on Sunday morning are time-sensitive. Spawning a
 *   network request DURING the first paint can stutter the UI on slow
 *   connections. A 5s delay puts the check after the windows are
 *   visible and interactive.
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

import { app } from 'electron'
import { autoUpdater } from 'electron-updater'

const FIRST_CHECK_DELAY_MS = 5_000

let initialized = false

export function initAutoUpdater(): void {
  if (initialized) return
  initialized = true

  // Skip entirely in development — the version is 0.0.0 and the
  // app-update.yml manifest doesn't exist outside the packaged build.
  if (!app.isPackaged) {
    console.log('[updater] dev mode — skipping auto-update setup')
    return
  }

  // Quiet logging — log to the main console only, no popups.
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

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
      `[updater] update downloaded: v${info.version} — will install on quit`
    )
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
