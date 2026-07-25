/**
 * Canva IPC handlers.
 *
 * Handlers convert thrown errors into rejected invokes, which the
 * renderer surfaces as operator-facing copy. Nothing here logs tokens.
 *
 * Error identity (reconnect vs. transient): a rejected `ipcMain.handle`
 * reaches the renderer as a plain `Error` — Electron does not preserve
 * the thrown class, so `err instanceof CanvaReauthRequiredError` would
 * always be false there even though main threw exactly that. Rather than
 * encode the distinction into error text, `auth.ts`'s `requireReauth()`
 * (used by both auth.ts and api.ts whenever Canva genuinely rejects the
 * connection) clears the stored tokens before throwing, so `getState()`
 * truthfully reports `disconnected` afterward. The renderer's contract
 * (documented on PresentApi.canva in shared/ipc-contract.ts) is: on any
 * failed canva.* call, re-check `getState()` to decide whether to prompt
 * reconnect or just offer retry.
 */

import { ipcMain } from 'electron'
import { CHANNELS } from '@shared/ipc-contract'
import type {
  CanvaConnectionState,
  CanvaDesignPage,
  CanvaImportResult
} from '@shared/canva'
import { isDesignStale } from '@shared/canva'
import { connect, disconnect } from '../canva/auth'
import { listDesigns, getDesignUpdatedAt } from '../canva/api'
import { importDesign, deleteCanvaPdf, sweepOrphanPdfs } from '../canva/import'
import { loadTokens, isTokenStorageAvailable } from '../storage/canvaTokens'
import { getOperatorWindow } from '../windows'

async function currentState(): Promise<CanvaConnectionState> {
  if (!isTokenStorageAvailable()) {
    return {
      status: 'unavailable',
      reason:
        'Present cannot securely store a Canva connection on this system. Canva import is unavailable.'
    }
  }
  const tokens = await loadTokens()
  if (!tokens) return { status: 'disconnected' }
  return {
    status: 'connected',
    accountName: tokens.accountName,
    connectedAt: tokens.connectedAt
  }
}

export function registerCanvaHandlers(): void {
  ipcMain.handle(CHANNELS.canva.getState, currentState)

  ipcMain.handle(CHANNELS.canva.connect, async (): Promise<CanvaConnectionState> => {
    await connect()
    return currentState()
  })

  ipcMain.handle(CHANNELS.canva.disconnect, async (): Promise<CanvaConnectionState> => {
    await disconnect()
    return currentState()
  })

  ipcMain.handle(
    CHANNELS.canva.listDesigns,
    (_, query: string | null, continuation: string | null): Promise<CanvaDesignPage> =>
      listDesigns(query, continuation)
  )

  ipcMain.handle(
    CHANNELS.canva.importDesign,
    // NOTE: a rejected importDesign() can still have written a PDF to
    // disk (the post-write unixSecondsToIso call can throw on a
    // malformed updated_at). That is not this layer's problem to solve
    // — sweepOrphanPdfs (Task 13) cleans up anything an aborted import
    // left behind, so no special-casing belongs here.
    (_, designId: string, title: string): Promise<CanvaImportResult> =>
      importDesign(designId, title, (progress) => {
        const win = getOperatorWindow()
        if (win && !win.isDestroyed()) {
          win.webContents.send(CHANNELS.canva.eventImportProgress, progress)
        }
      })
  )

  /**
   * Sequential by design. The 20/min ceiling we have documented is the
   * export limit; the metadata endpoint's is unconfirmed, and a typical
   * setlist holds a handful of decks, so serial costs nothing worth
   * optimizing against an unknown budget.
   *
   * Individual failures are swallowed: a design deleted in Canva, a
   * dropped connection, or a reauth-required condition mid-pass must not
   * fail the whole pass or block the setlist from opening. Once
   * getDesignUpdatedAt clears the stored connection (via requireReauth),
   * remaining items fail fast on the local "not connected" check rather
   * than retrying the network, so this doesn't hammer Canva after the
   * first rejection.
   */
  ipcMain.handle(
    CHANNELS.canva.checkStale,
    async (_, items: { designId: string; designUpdatedAt: string }[]): Promise<string[]> => {
      const stale: string[] = []
      for (const item of items) {
        try {
          const updatedAt = await getDesignUpdatedAt(item.designId)
          const origin = {
            designId: item.designId,
            designUpdatedAt: item.designUpdatedAt,
            importedAt: ''
          }
          if (isDesignStale(origin, updatedAt)) stale.push(item.designId)
        } catch {
          // Offline is a normal condition for this app, not an error.
        }
        await new Promise((r) => setTimeout(r, 250))
      }
      return stale
    }
  )

  ipcMain.handle(CHANNELS.canva.deletePdf, (_, absPath: string) => deleteCanvaPdf(absPath))

  ipcMain.handle(CHANNELS.canva.sweepOrphans, (_, referenced: string[]) =>
    sweepOrphanPdfs(referenced)
  )
}
