/**
 * Badge — KLB square chip.
 *
 * Used for item-kind codes (SNG / VID / PDF), language tags, and status
 * counts. Square, 1px border, mono uppercase. The old rounded-full pill
 * is gone: it was the one radius `--radius: 0` could not reach, since
 * Tailwind hardcodes rounded-full to 9999px.
 */

import type { HTMLAttributes } from 'react'
import { cn } from '../../lib/utils'

type Tone = 'signal' | 'neutral' | 'ok'

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone
}

const TONES: Record<Tone, string> = {
  signal: 'border-signal/45 text-signal',
  neutral: 'border-border text-soft',
  ok: 'border-ok/45 text-ok'
}

export function Badge({
  className,
  tone = 'neutral',
  ...rest
}: BadgeProps): JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 border px-1.5 py-[3px]',
        'font-mono text-[8.5px] font-semibold uppercase leading-none tracking-[0.08em]',
        TONES[tone],
        className
      )}
      {...rest}
    />
  )
}
