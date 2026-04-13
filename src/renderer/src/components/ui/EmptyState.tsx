/**
 * EmptyState — centered hint block for "no items yet" / "no results"
 * conditions. Takes an icon (emoji or inline SVG), a title, body text,
 * and an optional CTA slot.
 *
 * Unlike a normal Card, empty states use a dashed border to read as
 * "something SHOULD be here" rather than "here's an information panel".
 */

import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

interface EmptyStateProps {
  icon?: ReactNode
  title: string
  description?: string
  cta?: ReactNode
  className?: string
}

export function EmptyState({
  icon,
  title,
  description,
  cta,
  className
}: EmptyStateProps): JSX.Element {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/60 bg-card/20 px-8 py-12 text-center',
        className
      )}
    >
      {icon && (
        <div className="text-3xl opacity-60" aria-hidden="true">
          {icon}
        </div>
      )}
      <div className="text-base font-semibold text-foreground">{title}</div>
      {description && (
        <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      )}
      {cta && <div className="mt-2">{cta}</div>}
    </div>
  )
}
