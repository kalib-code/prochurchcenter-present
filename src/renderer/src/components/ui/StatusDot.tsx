/**
 * StatusDot — 7px circle used by NEXT UP, ON SCREEN, pre-flight rows,
 * and the saved-state pills.
 *
 * This is the ONLY component in the redesign allowed to use
 * `rounded-full`. Everything else is square by design; the design file
 * uses `border-radius:50%` here specifically.
 */

import { cn } from '../../lib/utils'

type Tone = 'signal' | 'ok' | 'dim'

interface StatusDotProps {
  tone?: Tone
  /** true = 2.4s pulse (idle), 'fast' = 1.6s pulse (live output) */
  pulse?: boolean | 'fast'
  className?: string
}

const TONES: Record<Tone, string> = {
  signal: 'bg-signal',
  ok: 'bg-ok',
  dim: 'bg-dim'
}

export function StatusDot({
  tone = 'signal',
  pulse = false,
  className
}: StatusDotProps): JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-block h-[7px] w-[7px] shrink-0 rounded-full',
        TONES[tone],
        pulse === 'fast' && 'animate-pulse-signal-fast',
        pulse === true && 'animate-pulse-signal',
        className
      )}
    />
  )
}
