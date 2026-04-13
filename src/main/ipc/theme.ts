/**
 * Theme IPC — list/get/update + broadcast.
 *
 * Update flow: operator invokes `theme:update`, main writes to disk and
 * then broadcasts `theme:event:change` to the output window so its
 * SlideRenderer can react instantly (colors, fonts, background image).
 * This is the same pub/sub pattern used for slide broadcasts.
 */

import { ipcMain } from 'electron'
import { CHANNELS, type UpdateThemePatch } from '@shared/ipc-contract'
import { listThemes, getTheme, updateTheme } from '../storage/theme'
import { getOutputWindow } from '../windows'

export function registerThemeHandlers(): void {
  ipcMain.handle(CHANNELS.theme.list, async () => listThemes())

  ipcMain.handle(CHANNELS.theme.get, async (_, id: string) => getTheme(id))

  ipcMain.handle(
    CHANNELS.theme.update,
    async (_, id: string, patch: UpdateThemePatch) => {
      const updated = await updateTheme(id, patch)
      // Fire-and-forget broadcast; output window may not exist in some
      // test/dev scenarios, which is fine — getOutputWindow() returns null.
      const win = getOutputWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send(CHANNELS.theme.eventChange, updated)
      }
      return updated
    }
  )
}
