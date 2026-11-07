/**
 * Central IPC handler registration.
 *
 * Called once from main/index.ts during app startup, after directories are
 * ensured. Each module registers its own handlers against the channel names
 * defined in shared/ipc-contract.ts.
 */

import { registerSongHandlers } from './songs'
import { registerSetlistHandlers } from './setlists'
import { registerSettingsHandlers } from './settings'
import { registerThemeHandlers } from './theme'
import { registerOutputHandlers } from './output'
import { registerDialogHandlers } from './dialog'
import { registerBibleHandlers } from './bible'
import { registerFontsHandlers } from './fonts'
import { registerBackupHandlers } from './backup'
import { registerUpdaterHandlers } from './updater'
import { registerSystemHandlers } from './system'
import { registerFilesHandlers } from './files'
import { registerCanvaHandlers } from './canva'
import { registerMcpHandlers } from './mcp'

export function registerAllIpcHandlers(): void {
  registerSongHandlers()
  registerSetlistHandlers()
  registerSettingsHandlers()
  registerThemeHandlers()
  registerOutputHandlers()
  registerDialogHandlers()
  registerBibleHandlers()
  registerFontsHandlers()
  registerBackupHandlers()
  registerUpdaterHandlers()
  registerSystemHandlers()
  registerFilesHandlers()
  registerCanvaHandlers()
  registerMcpHandlers()
}
