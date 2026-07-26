/**
 * MonoLabel — the KLB eyebrow.
 *
 * The design uses `600 9.5px 'JetBrains Mono', letter-spacing .14em,
 * uppercase` for roughly eighty section headers, column headers, and
 * status captions. Centralising it here is what keeps the tracking
 * identical everywhere; hand-written `tracking-[0.14em]` drifts.
 */

import type { HTMLAttributes } from 'react'
import { cn } from '../../lib/utils'

type Tone = 'muted' | 'signal' | 'dim' | 'soft'
type Size = 'xs' | 'sm'

interface MonoLabelProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone
  size?: Size
}

const TONES: Record<Tone, string> = {
  muted: 'text-muted-foreground',
  signal: 'text-signal',
  dim: 'text-dim',
  soft: 'text-soft'
}

// xs is the chip//column-header size; sm is the section-header size.
const SIZES: Record<Size, string> = {
  xs: 'text-[9px] tracking-[0.12em]',
  sm: 'text-[9.5px] tracking-[0.14em]'
}

export function MonoLabel({
  className,
  tone = 'muted',
  size = 'sm',
  ...rest
}: MonoLabelProps): JSX.Element {
  return (
    <span
      className={cn(
        'font-mono font-semibold uppercase leading-none',
        TONES[tone],
        SIZES[size],
        className
      )}
      {...rest}
    />
  )
}
