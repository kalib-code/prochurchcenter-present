import { StatusDot } from './StatusDot'
import type { AutosaveStatus } from '../../hooks/useAutosave'

interface SaveStatePillProps {
  status: AutosaveStatus
  /** Error message for the `error` status. Ignored otherwise. */
  error?: string | null
}

export function SaveStatePill({ status, error = null }: SaveStatePillProps): JSX.Element | null {
  if (status === 'idle') return null

  const tone = status === 'error' ? 'live' : status === 'saved' ? 'ok' : 'dim'
  const pulse: boolean | 'fast' = status === 'pending' ? true : status === 'saving' ? 'fast' : false
  const label =
    status === 'pending'
      ? 'Unsaved changes'
      : status === 'saving'
        ? 'Saving…'
        : status === 'saved'
          ? 'Saved'
          : `Couldn't save${error ? `: ${error}` : ''}`

  return (
    <span
      className="inline-flex items-center gap-2 rounded-full bg-raised px-2.5 py-1 text-[12px] text-soft"
      role="status"
    >
      <StatusDot tone={tone} pulse={pulse} />
      <span className={status === 'error' ? 'text-live' : undefined}>{label}</span>
    </span>
  )
}
