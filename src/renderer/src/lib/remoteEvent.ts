import type { RemoteCommandEvent, RemoteResult } from '@shared/remote'
import { executeRemoteCommand } from './remoteExecutor'

/**
 * Run one cue forwarded by main and return the reply. A cue past its
 * `expiresAt` has already been answered `timeout` by main (the renderer was
 * blocked, e.g. by a confirm dialog), so it is discarded, never run late.
 */
export function handleRemoteEvent(e: RemoteCommandEvent, now: number = Date.now()): RemoteResult {
  if (now > e.expiresAt) return { ok: false, reason: 'timeout' }
  try {
    return executeRemoteCommand(e.command, e.source, e.from)
  } catch (err) {
    console.error('[remote] cue failed', err)
    return { ok: false, reason: 'invalid' }
  }
}
