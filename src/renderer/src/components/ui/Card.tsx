/**
 * Card — a rounded container with the card surface color and a subtle
 * border. Wraps its children. Used for everything from empty-state
 * boxes to hero blocks.
 *
 * Intentionally simple — no `variant` prop. Elevation comes from the
 * `shadow-glow-brand` utility when you need a brand-flavored hero,
 * applied directly by the caller.
 */

import type { HTMLAttributes } from 'react'
import { cn } from '../../lib/utils'

export function Card({
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement>): JSX.Element {
  return (
    <div
      className={cn(
        'rounded-xl border border-border/50 bg-card/60 backdrop-blur-[2px]',
        'transition-colors',
        className
      )}
      {...rest}
    />
  )
}
