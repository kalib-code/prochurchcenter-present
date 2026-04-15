/**
 * IPC handlers for the backup / import / restore surface.
 *
 * Every call delegates to `storage/backup.ts` — this module is just
 * the thin main-process facade that bridges IPC calls to engine
 * functions, picks file paths, and surfaces native dialogs.
 */

import { ipcMain, dialog, shell, BrowserWindow } from 'electron'
import { existsSync, rmSync, statSync } from 'fs'
import { basename, join, resolve, sep } from 'path'
import {
  CHANNELS,
  type BackupListEntry,
  type BackupImportResult,
  type BackupImportMode
} from '@shared/ipc-contract'
import {
  backupFilename,
  ensureBackupsDir,
  exportLibrary,
  getBackupsDir,
  importLibrary,
  listBackups,
  readBackupManifest
} from '../storage/backup'

function toListEntry(absolutePath: string): BackupListEntry {
  const st = statSync(absolutePath)
  const filename = basename(absolutePath)
  let manifest: BackupListEntry['manifest'] = null
  try {
    manifest = readBackupManifest(absolutePath)
  } catch {
    manifest = null
  }
  return {
    filename,
    absolutePath,
    sizeBytes: st.size,
    createdAt: manifest?.createdAt ?? st.mtime.toISOString(),
    manifest
  }
}

/**
 * Guard against absolute-path smuggling from the renderer. Every
 * restore/delete target MUST live inside the known backups directory.
 * Uses `path.resolve` to normalize `..` segments before the prefix
 * check — otherwise `<backups>/../other.zip` would slip past a naive
 * `startsWith` test.
 */
function assertInsideBackupsDir(absolutePath: string): void {
  const dir = resolve(getBackupsDir())
  const normalized = resolve(absolutePath)
  const prefix = dir.endsWith(sep) ? dir : dir + sep
  if (!normalized.startsWith(prefix)) {
    throw new Error('Refusing to operate on a path outside the backups folder.')
  }
  if (!existsSync(normalized)) {
    throw new Error('Backup file no longer exists.')
  }
}

export function registerBackupHandlers(): void {
  ipcMain.handle(CHANNELS.backup.exportNow, async (): Promise<BackupListEntry> => {
    ensureBackupsDir()
    const filename = backupFilename()
    const absolutePath = join(getBackupsDir(), filename)
    await exportLibrary(absolutePath)
    return toListEntry(absolutePath)
  })

  ipcMain.handle(CHANNELS.backup.list, async (): Promise<BackupListEntry[]> => {
    return listBackups()
  })

  ipcMain.handle(
    CHANNELS.backup.restore,
    async (
      _evt,
      absolutePath: string,
      mode: BackupImportMode
    ): Promise<BackupImportResult> => {
      assertInsideBackupsDir(absolutePath)
      const result = await importLibrary(absolutePath, mode)
      return {
        imported: result.imported,
        safetyBackupPath: result.safetyBackupPath
      }
    }
  )

  ipcMain.handle(
    CHANNELS.backup.delete,
    async (_evt, absolutePath: string): Promise<void> => {
      assertInsideBackupsDir(absolutePath)
      rmSync(absolutePath)
    }
  )

  ipcMain.handle(CHANNELS.backup.openFolder, async (): Promise<void> => {
    ensureBackupsDir()
    await shell.openPath(getBackupsDir())
  })

  ipcMain.handle(
    CHANNELS.backup.importFromFile,
    async (
      evt,
      mode: BackupImportMode
    ): Promise<BackupImportResult | null> => {
      const parent = BrowserWindow.fromWebContents(evt.sender) ?? undefined
      const result = await dialog.showOpenDialog(parent!, {
        title: 'Restore from backup file',
        buttonLabel: 'Restore',
        filters: [{ name: 'ProChurchCenter Backup', extensions: ['zip'] }],
        properties: ['openFile']
      })
      if (result.canceled || result.filePaths.length === 0) return null
      const imported = await importLibrary(result.filePaths[0], mode)
      return {
        imported: imported.imported,
        safetyBackupPath: imported.safetyBackupPath
      }
    }
  )
}
