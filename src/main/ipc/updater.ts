/**
 * IPC handlers for the manual auto-update surface.
 *
 * The background update flow (5s after launch) + the "Restart now?"
 * dialog are wired entirely in main/updater.ts. This module exists
 * only so Settings → About can show the current version and trigger
 * an on-demand check via a button.
 */

import { ipcMain } from 'electron'
import { CHANNELS } from '@shared/ipc-contract'
import { getCurrentVersion, manualCheckForUpdates } from '../updater'

export function registerUpdaterHandlers(): void {
  ipcMain.handle(CHANNELS.updater.getVersion, async () => getCurrentVersion())
  ipcMain.handle(CHANNELS.updater.checkNow, async () => manualCheckForUpdates())
}
