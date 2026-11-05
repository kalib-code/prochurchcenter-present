/**
 * MonoLabel — section / column / caption label.
 *
 * Despite the historical name it is no longer mono caps: the redesign
 * uses small sentence-case labels in the UI font, which read far better
 * on a dark screen than 9px tracked capitals. Write label text in
 * sentence case ("Run of show", not "RUN OF SHOW").
 *
 * Kept under the old name so ~100 call sites convert in one place.
 */

import type { HTMLAttributes } from 'react'
import { cn } from '../../lib/utils'

type Tone = 'muted' | 'signal' | 'accent' | 'dim' | 'soft' | 'warn' | 'live' | 'ok'
type Size = 'xs' | 'sm'

interface MonoLabelProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone
  size?: Size
}

const TONES: Record<Tone, string> = {
  muted: 'text-muted-foreground',
  signal: 'text-accent',
  accent: 'text-accent',
  dim: 'text-dim',
  soft: 'text-soft',
  warn: 'text-warn',
  live: 'text-live',
  ok: 'text-ok'
}

const SIZES: Record<Size, string> = {
  xs: 'text-[11px]',
  sm: 'text-[12px]'
}

export function MonoLabel({
  className,
  tone = 'muted',
  size = 'sm',
  ...rest
}: MonoLabelProps): JSX.Element {
  return (
    <span
      className={cn('font-medium leading-tight', TONES[tone], SIZES[size], className)}
      {...rest}
    />
  )
}
