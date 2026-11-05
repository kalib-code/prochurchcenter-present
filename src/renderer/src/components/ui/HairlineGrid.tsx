import type { ReactNode } from 'react'
import { Children } from 'react'
import { cn } from '../../lib/utils'

interface HairlineGridProps {
  cols: number
  children: ReactNode
  className?: string
}

/**
 * Grid of cells separated by 1px hairlines, inside one rounded frame.
 * The hairlines are the frame's background showing through a 1px gap,
 * so cells never double up borders.
 */
export function HairlineGrid({ cols, children, className }: HairlineGridProps): JSX.Element {
  return (
    <div
      className={cn('grid gap-px overflow-hidden rounded-xl border border-border/70 bg-rule', className)}
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
    >
      {Children.map(children, (child) => (
        <div className="min-w-0 bg-panel">{child}</div>
      ))}
    </div>
  )
}
