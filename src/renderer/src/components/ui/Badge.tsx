/**
 * Badge — small pill for metadata chips (language, CCLI #, section
 * count, "Today" markers). Three tones:
 *
 *   - neutral: muted bg, fg text — default for boring facts
 *   - brand:   warm-gold bg with brand-foreground — for "Today" / active
 *   - outline: transparent bg + subtle border — for optional metadata
 *              that shouldn't compete with primary info
 */

import type { HTMLAttributes } from 'react'
import { cn } from '../../lib/utils'

type Tone = 'neutral' | 'brand' | 'outline'

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone
}

const TONES: Record<Tone, string> = {
  neutral: 'bg-muted/60 text-muted-foreground',
  brand: 'bg-brand/15 text-brand border border-brand/30',
  outline: 'border border-border/60 text-muted-foreground'
}

export function Badge({
  className,
  tone = 'neutral',
  ...rest
}: BadgeProps): JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider',
        TONES[tone],
        className
      )}
      {...rest}
    />
  )
}
