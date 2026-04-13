/**
 * PageHeader — shared layout for the top of every scoped page.
 *
 * Shape:
 *   [back-link]  [title + optional eyebrow]           [actions slot]
 *                 subtitle (optional)
 *
 * Uses a thin bottom border instead of a full card — lets the page
 * content breathe into the same horizontal rhythm as the title.
 *
 * The `eyebrow` prop shows a small uppercase label above the title
 * (e.g., "Library" above "Song Library") — adds editorial hierarchy
 * without requiring an H2.
 */

import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { cn } from '../../lib/utils'

interface PageHeaderProps {
  title: string
  subtitle?: string
  eyebrow?: string
  /** Back-link target — omit to hide the back affordance. */
  backTo?: string
  /** Label for the back link. Defaults to "Home". */
  backLabel?: string
  /** Right-aligned action area (buttons, search input, etc) */
  actions?: ReactNode
  className?: string
}

export function PageHeader({
  title,
  subtitle,
  eyebrow,
  backTo,
  backLabel = 'Home',
  actions,
  className
}: PageHeaderProps): JSX.Element {
  return (
    <header
      className={cn(
        'flex items-start gap-6 border-b border-border/40 px-8 py-6',
        className
      )}
    >
      {backTo && (
        <Link
          to={backTo}
          className="mt-2 flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
        >
          <span aria-hidden="true">←</span>
          {backLabel}
        </Link>
      )}

      <div className="min-w-0 flex-1">
        {eyebrow && (
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-brand/80">
            {eyebrow}
          </div>
        )}
        <h1 className="mt-0.5 truncate text-[28px] font-semibold leading-tight tracking-tight text-foreground">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        )}
      </div>

      {actions && (
        <div className="mt-1 flex shrink-0 items-center gap-2">{actions}</div>
      )}
    </header>
  )
}
