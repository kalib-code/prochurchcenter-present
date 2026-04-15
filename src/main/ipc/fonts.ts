/**
 * Fonts IPC — custom font upload, listing, and deletion.
 *
 * The renderer never touches the filesystem directly; all font ops
 * round-trip through main so that:
 *   1. We can validate the file extension at a single trust boundary
 *   2. Files are persisted under userData/fonts/ rather than left
 *      pointing at the user's Downloads folder
 *   3. The index.json that maps family names to filenames is updated
 *      atomically with the file copy
 *
 * Returned entries include `absolutePath` so the renderer can
 * construct an `@font-face src: url('present-media://local{path}')`
 * declaration without needing to know the userData layout.
 */

import { ipcMain, dialog, BrowserWindow } from 'electron'
import { CHANNELS, type CustomFontEntry } from '@shared/ipc-contract'
import {
  listCustomFonts,
  uploadCustomFont,
  deleteCustomFont,
  getCustomFontPath
} from '../storage/fonts'
import { getOperatorWindow } from '../windows'

function toEntry(font: { family: string; filename: string }): CustomFontEntry {
  return {
    family: font.family,
    filename: font.filename,
    absolutePath: getCustomFontPath(font.filename)
  }
}

export function registerFontsHandlers(): void {
  ipcMain.handle(CHANNELS.fonts.list, async (): Promise<CustomFontEntry[]> => {
    return listCustomFonts().map(toEntry)
  })

  ipcMain.handle(
    CHANNELS.fonts.upload,
    async (): Promise<CustomFontEntry | null> => {
      // Show the font picker. Anchored to operator window for native
      // sheet behavior on macOS.
      const parent = getOperatorWindow()
      const options: Electron.OpenDialogOptions = {
        title: 'Choose a font file',
        properties: ['openFile'],
        filters: [
          { name: 'Font files', extensions: ['ttf', 'otf', 'woff', 'woff2'] }
        ]
      }

      const result =
        parent && !parent.isDestroyed()
          ? await dialog.showOpenDialog(parent as BrowserWindow, options)
          : await dialog.showOpenDialog(options)

      if (result.canceled || result.filePaths.length === 0) return null

      const uploaded = uploadCustomFont(result.filePaths[0])
      return toEntry(uploaded)
    }
  )

  ipcMain.handle(CHANNELS.fonts.delete, async (_, family: string) => {
    deleteCustomFont(family)
  })
}
