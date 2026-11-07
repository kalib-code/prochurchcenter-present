import { useCallback, useEffect, useState } from 'react'
import type { RemoteConfig, RemoteState } from '@shared/remote'
import { cleanIpcError } from '../../lib/remoteDisplay'

export function useRemoteState(): [RemoteState | null, (s: RemoteState) => void] {
  const [state, setState] = useState<RemoteState | null>(null)
  useEffect(() => {
    let alive = true
    void window.api.remote.getState().then((s) => alive && setState(s))
    const off = window.api.remote.onStateChange(setState)
    return () => {
      alive = false
      off()
    }
  }, [])
  return [state, setState]
}

/**
 * Save helper for one control (or group). Never leaves a rejected promise
 * unhandled; the message to show next to the control lives in `error`.
 * Resolves true when the change was saved.
 */
export function useRemoteSave(
  setState: (s: RemoteState) => void
): { error: string | null; clearError: () => void; save: (patch: Partial<Omit<RemoteConfig, 'token'>>) => Promise<boolean> } {
  const [error, setError] = useState<string | null>(null)
  const save = useCallback(
    async (patch: Partial<Omit<RemoteConfig, 'token'>>): Promise<boolean> => {
      try {
        setState(await window.api.remote.update(patch))
        setError(null)
        return true
      } catch (err) {
        setError(cleanIpcError(err))
        return false
      }
    },
    [setState]
  )
  return { error, clearError: () => setError(null), save }
}
