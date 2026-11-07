import { cn } from '../../lib/utils'
import { selectLastCueSummary, useRemoteStore } from '../../stores/useRemoteStore'
import { useRemoteState } from '../remote/useRemoteState'

/**
 * Service Mode header chip. Visible only while remote control is on;
 * clicking it pauses/resumes remote cues. Tooltip shows the last cue.
 */
export function RemoteChip(): JSX.Element | null {
  const [state] = useRemoteState()
  const paused = useRemoteStore((s) => s.paused)
  const setPaused = useRemoteStore((s) => s.setPaused)
  // Narrow, primitive selectors: a burst of cues must not re-render the header.
  const last = useRemoteStore(selectLastCueSummary)
  if (!state?.enabled) return null

  const action = paused ? 'Click to resume remote control.' : 'Click to pause remote control.'
  const title = `${last ? `Last cue: ${last}. ` : 'No cues yet. '}${action}`
  return (
    <button
      type="button"
      title={title}
      aria-pressed={paused}
      onClick={(e) => {
        // Drop focus so the operator's next Space goes to slides, not this button.
        e.currentTarget.blur()
        setPaused(!paused)
      }}
      className={cn(
        'inline-flex items-center rounded px-1.5 py-[3px] text-[11px] font-semibold leading-none ring-1 ring-inset transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70',
        paused ? 'bg-warn/15 text-warn ring-warn/50' : 'bg-app/85 text-foreground ring-border hover:bg-hover'
      )}
    >
      {paused ? 'Remote paused' : 'Remote'}
    </button>
  )
}
