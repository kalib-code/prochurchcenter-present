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
 * Save helper. Never leaves a rejected promise unhandled; errors are kept
 * per field key so each message renders under the control that failed.
 * Resolves true when the change was saved.
 */
export function useRemoteSave(setState: (s: RemoteState) => void): {
  errors: Record<string, string>
  save: (field: string, patch: Partial<Omit<RemoteConfig, 'token'>>) => Promise<boolean>
} {
  const [errors, setErrors] = useState<Record<string, string>>({})
  const save = useCallback(
    async (field: string, patch: Partial<Omit<RemoteConfig, 'token'>>): Promise<boolean> => {
      try {
        setState(await window.api.remote.update(patch))
        setErrors((e) => {
          if (!(field in e)) return e
          const { [field]: _gone, ...rest } = e
          return rest
        })
        return true
      } catch (err) {
        setErrors((e) => ({ ...e, [field]: cleanIpcError(err) }))
        return false
      }
    },
    [setState]
  )
  return { errors, save }
}

export function FieldError({ message }: { message?: string }): JSX.Element | null {
  return message ? (
    <p role="alert" className="text-[12px] text-warn">
      {message}
    </p>
  ) : null
}
