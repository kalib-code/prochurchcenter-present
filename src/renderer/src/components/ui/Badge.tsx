/**
 * Badge — small tinted chip for kinds, tags and statuses.
 *
 * Tones follow the colour-means-something rule: `neutral` for plain
 * labels (item kinds, languages), `accent` for the current selection,
 * `ok`/`warn`/`live` for state. `signal` is the legacy alias of accent.
 */

import type { HTMLAttributes } from 'react'
import { cn } from '../../lib/utils'

type Tone = 'neutral' | 'accent' | 'signal' | 'ok' | 'warn' | 'live'

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone
}

const TONES: Record<Tone, string> = {
  neutral: 'bg-hover text-soft',
  accent: 'bg-accent/15 text-accent',
  signal: 'bg-accent/15 text-accent',
  ok: 'bg-ok/15 text-ok',
  warn: 'bg-warn/15 text-warn',
  live: 'bg-live/15 text-live'
}

export function Badge({ className, tone = 'neutral', ...rest }: BadgeProps): JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5',
        'text-[11px] font-medium leading-none',
        TONES[tone],
        className
      )}
      {...rest}
    />
  )
}
