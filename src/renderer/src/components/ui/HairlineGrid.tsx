/**
 * HairlineGrid — the design's border-seam grid.
 *
 * The design builds every card grid and table as `border-left` on the
 * container plus `border-right`/`border-bottom` on each cell (see design
 * L103, L121, L431). That produces exact 1px seams; a naive
 * `border` on every cell would double them to 2px at every interior
 * edge, and `gap` would separate the cards entirely — neither matches.
 *
 * Cells are the direct children. This component owns the seams, so
 * children must NOT set their own borders on the seam edges.
 */

import type { ReactNode } from 'react'
import { Children } from 'react'
import { cn } from '../../lib/utils'

interface HairlineGridProps {
  cols: number
  children: ReactNode
  className?: string
}

export function HairlineGrid({ cols, children, className }: HairlineGridProps): JSX.Element {
  return (
    <div
      className={cn('grid border-l border-t border-border', className)}
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
    >
      {Children.map(children, (child) => (
        <div className="min-w-0 border-b border-r border-border">{child}</div>
      ))}
    </div>
  )
}
