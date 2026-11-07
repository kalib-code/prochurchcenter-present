import { useEffect } from 'react'
import { executeRemoteCommand } from '../lib/remoteExecutor'

/** Operator window only: run cues forwarded by main and reply with the result. */
export function useRemoteControl(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return
    return window.api.remote.onCommand((e) => {
      const result = executeRemoteCommand(e.command, e.source, e.from)
      void window.api.remote.reply(e.id, result)
    })
  }, [enabled])
}
