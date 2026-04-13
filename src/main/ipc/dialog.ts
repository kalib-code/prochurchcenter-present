/**
 * Dialog IPC — native file pickers.
 *
 * v1.0 only needs "pick a media file" so the theme editor can offer a
 * real file dialog instead of a paste-a-path text input. The `kind`
 * parameter controls the extension filter:
 *
 *   'image' — jpg/jpeg/png/webp/gif/bmp
 *   'video' — mp4/mov/webm/mkv
 *   'media' — union of both (used by a combined "pick background" button)
 *
 * Returns the absolute path of the picked file, or null if the user
 * cancelled the dialog. We deliberately never throw — cancel is a
 * normal UX path, not an error.
 */

import { ipcMain, dialog, BrowserWindow } from 'electron'
import { CHANNELS, type PickFileKind } from '@shared/ipc-contract'
import { getOperatorWindow } from '../windows'

const FILTERS: Record<PickFileKind, Electron.FileFilter[]> = {
  image: [
    { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'] }
  ],
  video: [
    { name: 'Videos', extensions: ['mp4', 'mov', 'webm', 'mkv', 'm4v'] }
  ],
  media: [
    {
      name: 'Media',
      extensions: [
        'jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp',
        'mp4', 'mov', 'webm', 'mkv', 'm4v'
      ]
    }
  ],
  pdf: [{ name: 'PDF decks', extensions: ['pdf'] }]
}

function dialogTitle(kind: PickFileKind): string {
  switch (kind) {
    case 'video':
      return 'Choose a video'
    case 'pdf':
      return 'Choose a PDF deck'
    case 'image':
      return 'Choose an image'
    case 'media':
    default:
      return 'Choose a file'
  }
}

export function registerDialogHandlers(): void {
  ipcMain.handle(
    CHANNELS.dialog.pickFile,
    async (_, kind: PickFileKind): Promise<string | null> => {
      // Anchor the dialog to the operator window so it shows modal-style
      // on macOS (sheet) and centered on Windows/Linux. Falls back to a
      // detached dialog if the operator window has been destroyed.
      const parent = getOperatorWindow()
      const options: Electron.OpenDialogOptions = {
        title: dialogTitle(kind),
        properties: ['openFile'],
        filters: FILTERS[kind] ?? FILTERS.media
      }

      const result =
        parent && !parent.isDestroyed()
          ? await dialog.showOpenDialog(parent as BrowserWindow, options)
          : await dialog.showOpenDialog(options)

      if (result.canceled || result.filePaths.length === 0) return null
      return result.filePaths[0]
    }
  )
}
