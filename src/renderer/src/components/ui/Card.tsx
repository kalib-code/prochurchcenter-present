/**
 * Panel — the KLB container: square, #111111, 1px #2A2A28 border.
 *
 * Optional `title` renders the design's header bar — a mono eyebrow on
 * a hairline-separated strip, with an optional right-aligned `action`.
 * That header/body split appears on nearly every panel in the design,
 * so it lives here rather than being rebuilt per screen.
 *
 * `Card` is exported as a deprecated alias so screens that have not yet
 * been converted keep compiling. It is removed in the Settings phase.
 */

import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/utils'
import { MonoLabel } from './MonoLabel'

interface PanelProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** String titles are wrapped in a MonoLabel; nodes are rendered as-is. */
  title?: ReactNode
  action?: ReactNode
  /** Signal-coloured border, for panels that need to demand attention. */
  emphasis?: boolean
}

export function Panel({
  className,
  title,
  action,
  emphasis = false,
  children,
  ...rest
}: PanelProps): JSX.Element {
  return (
    <div
      className={cn(
        'border bg-card',
        emphasis ? 'border-signal' : 'border-border',
        className
      )}
      {...rest}
    >
      {(title !== undefined || action !== undefined) && (
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          {typeof title === 'string' ? <MonoLabel>{title}</MonoLabel> : title}
          {action}
        </div>
      )}
      {children}
    </div>
  )
}

/** @deprecated Use `Panel`. Removed once every screen is converted. */
export const Card = Panel
