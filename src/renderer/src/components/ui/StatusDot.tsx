import { cn } from '../../lib/utils'

type Tone = 'signal' | 'accent' | 'ok' | 'warn' | 'live' | 'dim'

interface StatusDotProps {
  tone?: Tone
  /** true = 2.4s pulse (idle), 'fast' = 1.6s pulse (live output) */
  pulse?: boolean | 'fast'
  className?: string
}

const TONES: Record<Tone, string> = {
  signal: 'bg-accent',
  accent: 'bg-accent',
  ok: 'bg-ok',
  warn: 'bg-warn',
  live: 'bg-live',
  dim: 'bg-dim'
}

export function StatusDot({ tone = 'accent', pulse = false, className }: StatusDotProps): JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-block h-2 w-2 shrink-0 rounded-full',
        TONES[tone],
        pulse === 'fast' && 'animate-pulse-signal-fast',
        pulse === true && 'animate-pulse-signal',
        className
      )}
    />
  )
}
