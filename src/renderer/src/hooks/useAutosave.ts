/**
 * useAutosave — debounced save-on-change for forms that don't have a save button.
 *
 * Contract:
 *   - Watches `value` for changes
 *   - After `delayMs` of no further changes, fires `onSave(value)` exactly once
 *   - If `value` changes again mid-debounce, the pending save is cancelled
 *     and a new one is scheduled — only the final quiet value is ever saved
 *   - `status` lets the UI show "Saving…" / "Saved" / "Error" indicators
 *
 * Why 500ms: long enough that a burst of keystrokes collapses into one
 * IPC write, short enough that the user sees "Saved" feedback before they
 * mentally commit the change. Ate Rose typing one section header should
 * not trigger 30 IPC round-trips.
 *
 * Deliberately NOT here:
 *   - No save-on-blur (Phase 2 keeps it simple; timer only)
 *   - No "dirty" flag exposed — if you need it, derive `status !== 'saved'`
 */

import { useEffect, useRef, useState } from 'react'

export type AutosaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error'

export interface UseAutosaveOptions<T> {
  value: T
  onSave: (value: T) => Promise<void>
  delayMs?: number
  /** Skip the first run so a freshly-loaded value doesn't immediately autosave */
  skipFirst?: boolean
}

export function useAutosave<T>({
  value,
  onSave,
  delayMs = 500,
  skipFirst = true
}: UseAutosaveOptions<T>): { status: AutosaveStatus; error: string | null } {
  const [status, setStatus] = useState<AutosaveStatus>('idle')
  const [error, setError] = useState<string | null>(null)

  const isFirstRun = useRef(skipFirst)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Always read the latest onSave inside the timer callback, so that a
  // re-rendered parent passing a new closure doesn't stale-capture the
  // old save function.
  const onSaveRef = useRef(onSave)
  useEffect(() => {
    onSaveRef.current = onSave
  }, [onSave])

  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false
      return
    }

    setStatus('pending')
    if (timerRef.current) clearTimeout(timerRef.current)

    timerRef.current = setTimeout(async () => {
      setStatus('saving')
      try {
        await onSaveRef.current(value)
        setStatus('saved')
        setError(null)
      } catch (err) {
        setStatus('error')
        setError(err instanceof Error ? err.message : String(err))
      }
    }, delayMs)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [value, delayMs])

  return { status, error }
}
