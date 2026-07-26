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
import { connect, disconnect, isBackendConfigured } from '../canva/auth'
import { listDesigns, getDesignUpdatedAt } from '../canva/api'
import { importDesign, deleteCanvaPdf } from '../canva/import'
import { loadTokens, isTokenStorageAvailable } from '../storage/canvaTokens'
import { getOperatorWindow } from '../windows'

async function currentState(): Promise<CanvaConnectionState> {
  // TEMPORARY GATE — see isBackendConfigured's doc comment in
  // canva/auth.ts for why this exists and exactly what to delete once the
  // production backend is deployed. Checked first: a build with no
  // working backend has nothing else worth reporting on this path.
  if (!isBackendConfigured()) {
    return {
      status: 'unavailable',
      reason: "Canva import isn't available in this build yet."
    }
  }
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
    // NOTE: importDesign() now treats its one post-write step (reading
    // updated_at for the staleness comparison) as best-effort, so a
    // rejection here should mean the PDF was never written — but that is
    // not this layer's problem to guarantee. sweepOrphanPdfs (Task 13)
    // cleans up anything an aborted or future-changed import path leaves
    // behind (a crash mid-write, for instance), so no special-casing
    // belongs here regardless of which step actually failed.
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
   *
   * With no token at all, every item would otherwise throw locally on
   * the same tick yet still pay the 250ms inter-item delay — a pass that
   * can never succeed stalling the setlist-open path for nothing. Bail
   * up front instead.
   */
  ipcMain.handle(
    CHANNELS.canva.checkStale,
    async (_, items: { designId: string; designUpdatedAt: string }[]): Promise<string[]> => {
      if (!(await loadTokens())) return []

      const stale: string[] = []
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
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
        // No need to rate-limit after the last item — nothing follows it.
        if (i < items.length - 1) {
          await new Promise((r) => setTimeout(r, 250))
        }
      }
      return stale
    }
  )

  ipcMain.handle(CHANNELS.canva.deletePdf, (_, absPath: string) => deleteCanvaPdf(absPath))
}
