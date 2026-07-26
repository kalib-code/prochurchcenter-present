/**
 * SaveStatePill — the bordered "SAVED" / "SAVING…" / "UNSAVED CHANGES…" /
 * "ERROR SAVING" chip shown next to a debounced autosave (Setlist Editor's
 * top bar, Song Editor's header).
 *
 * Previously each screen had its own independent implementation of this,
 * and they'd drifted: one used an `ok` (green) dot for `saved`, the other
 * `signal` (orange); one pulsed the dot on `pending` and read "UNSAVED
 * CHANGES…", the other was static and read "UNSAVED". Same status, two
 * different-looking chips.
 *
 * This is the single merged treatment:
 *   - `idle`    → renders nothing (nothing has changed yet to report on)
 *   - `pending` → signal dot, PULSING (reads better mid-typing than a
 *                 static dot), "UNSAVED CHANGES…"
 *   - `saving`  → signal dot, fast pulse, "SAVING…"
 *   - `saved`   → signal dot, no pulse, "SAVED" — deliberately NOT the
 *                 `ok` (green) tone: spec §1.1 reserves `--ok` for
 *                 pre-flight READY status only, and autosave completing
 *                 is not a readiness signal.
 *   - `error`   → signal dot, no pulse, "ERROR SAVING: <message>" so the
 *                 operator sees what actually broke, not just that it did.
 */

import { StatusDot } from './StatusDot'
import { MonoLabel } from './MonoLabel'
import type { AutosaveStatus } from '../../hooks/useAutosave'

interface SaveStatePillProps {
  status: AutosaveStatus
  /** Error message for the `error` status. Ignored otherwise. */
  error?: string | null
}

export function SaveStatePill({ status, error = null }: SaveStatePillProps): JSX.Element | null {
  if (status === 'idle') return null

  const pulse: boolean | 'fast' =
    status === 'pending' ? true : status === 'saving' ? 'fast' : false

  const label =
    status === 'pending'
      ? 'UNSAVED CHANGES…'
      : status === 'saving'
        ? 'SAVING…'
        : status === 'saved'
          ? 'SAVED'
          : `ERROR SAVING${error ? `: ${error}` : ''}`

  return (
    <span className="inline-flex items-center gap-2 border border-border px-3 py-2">
      <StatusDot tone="signal" pulse={pulse} />
      <MonoLabel size="sm" tone={status === 'error' ? 'signal' : 'muted'}>
        {label}
      </MonoLabel>
    </span>
  )
}
