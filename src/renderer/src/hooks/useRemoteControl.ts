import { useEffect } from 'react'
import type { RemoteResult } from '@shared/remote'
import { executeRemoteCommand } from '../lib/remoteExecutor'

/** Operator window only: run cues forwarded by main and reply with the result. */
export function useRemoteControl(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return
    return window.api.remote.onCommand((e) => {
      let result: RemoteResult
      try {
        result = executeRemoteCommand(e.command, e.source, e.from)
      } catch (err) {
        console.error('[remote] cue failed', err)
        result = { ok: false, reason: 'invalid' }
      }
      void window.api.remote.reply(e.id, result)
    })
  }, [enabled])
}
