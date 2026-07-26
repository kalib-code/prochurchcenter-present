/**
 * Read-only file existence probe.
 *
 * Used by pre-flight ("11 of 12 media files found") and by the setlist
 * editor's MEDIA MISSING banner. Deliberately minimal: it answers
 * "is this path readable" and nothing else. No traversal, no stat
 * details, no writes.
 */

import { ipcMain } from 'electron'
import { access } from 'fs/promises'
import { CHANNELS } from '@shared/ipc-contract'

export function registerFilesHandlers(): void {
  ipcMain.handle(
    CHANNELS.files.checkExists,
    async (_, paths: string[]): Promise<Record<string, boolean>> => {
      if (!Array.isArray(paths)) return {}

      // Settled, not all-or-nothing: one unreadable path must not fail the
      // batch, or a single moved video would blank the whole report.
      const results = await Promise.all(
        paths.map(async (p) => {
          if (typeof p !== 'string' || p.length === 0) return [p, false] as const
          try {
            await access(p)
            return [p, true] as const
          } catch {
            return [p, false] as const
          }
        })
      )

      return Object.fromEntries(results)
    }
  )
}
