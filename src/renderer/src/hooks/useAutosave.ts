/**
 * useAutosave — debounced save-on-change for forms that don't have a save button.
 *
 * Contract:
 *   - Watches `value` for changes
 *   - After `delayMs` of no further changes, fires `onSave(value)` exactly once
 *   - If `value` changes again mid-debounce, the pending save is cancelled
 *     and a new one is scheduled — only the final quiet value is ever saved
 *   - A change still waiting on the debounce is flushed (saved immediately)
 *     when the component unmounts or the window unloads, and on demand via
 *     the returned `flush()` — so navigating away <500ms after an edit no
 *     longer drops it
 *   - `cancel()` drops a pending change without saving (e.g. before delete)
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

import { useCallback, useEffect, useRef, useState } from 'react'

export type AutosaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error'

export interface UseAutosaveOptions<T> {
  value: T
  onSave: (value: T) => Promise<void>
  delayMs?: number
  /** Skip the first run so a freshly-loaded value doesn't immediately autosave.
   * Independently of this, a change FROM null/undefined is never saved:
   * that's the editor seeding its draft from disk, not an edit. */
  skipFirst?: boolean
}

export interface UseAutosaveResult {
  status: AutosaveStatus
  error: string | null
  /** Save any pending (debounced) change now. Resolves once it has been
   * written, or immediately when nothing is pending. Never rejects —
   * failures land in `status`/`error` like a timer-driven save. */
  flush: () => Promise<void>
  /** Drop any pending change without saving it. */
  cancel: () => void
}

export function useAutosave<T>({
  value,
  onSave,
  delayMs = 500,
  skipFirst = true
}: UseAutosaveOptions<T>): UseAutosaveResult {
  const [status, setStatus] = useState<AutosaveStatus>('idle')
  const [error, setError] = useState<string | null>(null)

  const isFirstRun = useRef(skipFirst)
  // Previous `value`, to recognise the null → loaded seeding transition.
  const prevValueRef = useRef<T>(value)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Latest value + "has an unsaved change" flag live in refs so the
  // unmount/unload flush can save the newest value without re-subscribing,
  // and so a flush after the timer already saved is a no-op (no double save).
  const latestRef = useRef(value)
  const dirtyRef = useRef(false)
  const mountedRef = useRef(true)
  // Always read the latest onSave inside the timer callback, so that a
  // re-rendered parent passing a new closure doesn't stale-capture the
  // old save function.
  const onSaveRef = useRef(onSave)
  useEffect(() => {
    onSaveRef.current = onSave
  }, [onSave])

  const flush = useCallback(async (): Promise<void> => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (!dirtyRef.current) return
    dirtyRef.current = false
    // Status updates are skipped once unmounted — the unmount flush still
    // writes, there's just no UI left to tell.
    if (mountedRef.current) setStatus('saving')
    try {
      await onSaveRef.current(latestRef.current)
      if (mountedRef.current) {
        setStatus('saved')
        setError(null)
      }
    } catch (err) {
      if (mountedRef.current) {
        setStatus('error')
        setError(err instanceof Error ? err.message : String(err))
      }
    }
  }, [])

  const cancel = useCallback((): void => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    dirtyRef.current = false
  }, [])

  useEffect(() => {
    const prev = prevValueRef.current
    prevValueRef.current = value
    if (isFirstRun.current) {
      isFirstRun.current = false
      return
    }
    // Editors start with a null draft and fill it once the record arrives
    // from the store. That transition is a load, not an edit — saving it
    // just wrote identical data back to disk every time an editor opened.
    if (prev === null || prev === undefined) {
      latestRef.current = value
      dirtyRef.current = false
      return
    }

    latestRef.current = value
    dirtyRef.current = true
    setStatus('pending')
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => void flush(), delayMs)

    // Only clears the timer: a value change reschedules above, and the
    // unmount case is flushed by the effect below — never dropped.
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [value, delayMs, flush])

  // Flush on unmount (route change) and on window close/reload. The IPC
  // send inside onSave happens synchronously, so main still receives the
  // write even though the renderer won't be around for the reply.
  useEffect(() => {
    mountedRef.current = true
    const onUnload = (): void => void flush()
    window.addEventListener('beforeunload', onUnload)
    window.addEventListener('pagehide', onUnload)
    return () => {
      window.removeEventListener('beforeunload', onUnload)
      window.removeEventListener('pagehide', onUnload)
      mountedRef.current = false
      void flush()
    }
  }, [flush])

  return { status, error, flush, cancel }
}
