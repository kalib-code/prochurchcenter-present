import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/utils'
import { MonoLabel } from './MonoLabel'

interface PanelProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** String titles are rendered as a section label; nodes as-is. */
  title?: ReactNode
  action?: ReactNode
  /** Accent outline, for the one panel on a screen that leads. */
  emphasis?: boolean
}

/** Panel — a rounded surface one step above the page. */
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
        'overflow-hidden rounded-xl border bg-raised/60',
        emphasis ? 'border-accent/40' : 'border-border/70',
        className
      )}
      {...rest}
    >
      {(title !== undefined || action !== undefined) && (
        <div className="flex items-center justify-between gap-3 border-b border-rule px-4 py-3">
          {typeof title === 'string' ? (
            <MonoLabel className="text-[13px] font-semibold text-foreground">{title}</MonoLabel>
          ) : (
            title
          )}
          {action}
        </div>
      )}
      {children}
    </div>
  )
}
