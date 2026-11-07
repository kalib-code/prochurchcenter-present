import { ipcMain } from 'electron'
import { CHANNELS } from '@shared/ipc-contract'
import type { RemoteResult } from '@shared/remote'
import { getRemoteState, regenerateRemoteToken, replyToCommand, updateRemote } from '../remote'

const REASONS = ['no-service', 'paused', 'not-found', 'not-a-song', 'timeout', 'invalid']

function isRemoteResult(r: unknown): r is RemoteResult {
  if (!r || typeof r !== 'object') return false
  const o = r as Record<string, unknown>
  if (o.ok === true) return o.position === null || (typeof o.position === 'object' && o.position !== null)
  return o.ok === false && typeof o.reason === 'string' && REASONS.includes(o.reason)
}

export function registerRemoteHandlers(): void {
  ipcMain.handle(CHANNELS.remote.getState, () => getRemoteState())
  ipcMain.handle(CHANNELS.remote.update, (_, patch: unknown) => updateRemote(patch))
  ipcMain.handle(CHANNELS.remote.regenerateToken, () => regenerateRemoteToken())
  ipcMain.handle(CHANNELS.remote.reply, (_, id: unknown, result: unknown) => {
    if (typeof id !== 'string' || !isRemoteResult(result)) return
    replyToCommand(id, result)
  })
}
