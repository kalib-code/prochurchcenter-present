/**
 * DisplayModeSwitch — Service Mode's Live / Black / Logo selector.
 *
 * Same recessed-track shape as ui/Segmented, with one deliberate
 * difference: the active LIVE segment is solid red (`bg-live`), because
 * red means "the projector is showing content right now" and nothing
 * else in the app. Black and Logo use the neutral active thumb — the
 * congregation is NOT seeing the slide, so they must not read as on air.
 *
 * Presentational only: ServiceMode maps `onChange` onto the existing
 * toggleBlack / toggleLogo store actions.
 */

import type { OutputMode } from '@shared/ipc-contract'
import { cn } from '../../lib/utils'

const OPTIONS: Array<{ value: OutputMode; label: string }> = [
  { value: 'live', label: 'Live' },
  { value: 'black', label: 'Black' },
  { value: 'logo', label: 'Logo' }
]

interface DisplayModeSwitchProps {
  value: OutputMode
  onChange: (mode: OutputMode) => void
}

export function DisplayModeSwitch({ value, onChange }: DisplayModeSwitchProps): JSX.Element {
  return (
    <span
      role="group"
      aria-label="Projector output"
      className="inline-flex rounded-lg bg-app p-0.5 ring-1 ring-border/70"
    >
      {OPTIONS.map((opt) => {
        const active = opt.value === value
        const live = active && opt.value === 'live'
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            aria-pressed={active}
            className={cn(
              'inline-flex h-8 items-center gap-1.5 rounded-md px-3.5 text-[13px] font-medium leading-none transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70',
              live
                ? 'bg-live text-white shadow-sm'
                : active
                  ? 'bg-hover text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {live && (
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 animate-pulse-signal-fast rounded-full bg-white"
              />
            )}
            {opt.label}
          </button>
        )
      })}
    </span>
  )
}
