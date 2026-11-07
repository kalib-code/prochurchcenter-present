import { useEffect } from 'react'
import { handleRemoteEvent } from '../lib/remoteEvent'

/** Operator window only: run cues forwarded by main and reply with the result. */
export function useRemoteControl(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return
    return window.api.remote.onCommand((e) => {
      void window.api.remote.reply(e.id, handleRemoteEvent(e))
    })
  }, [enabled])
}
