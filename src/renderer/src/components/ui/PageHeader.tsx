/**
 * PageHeader — the KLB screen header.
 *
 * Optional back link, mono eyebrow, Inter-800 title terminated by a
 * signal period, optional description, optional right-aligned action
 * cluster. Used by Library, Song Editor, and Settings.
 */

import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { MonoLabel } from './MonoLabel'
import { TitleDot } from './TitleDot'

interface PageHeaderProps {
  eyebrow: string
  title: string
  description?: string
  /** Renders a "← LABEL" link above the eyebrow. */
  back?: { to: string; label: string }
  action?: ReactNode
  /** Extra content below the description, e.g. a tab row. */
  children?: ReactNode
}

export function PageHeader({
  eyebrow,
  title,
  description,
  back,
  action,
  children
}: PageHeaderProps): JSX.Element {
  return (
    <header className="shrink-0 border-b border-border bg-card px-6 pt-6">
      <div className="flex items-end justify-between gap-6 pb-5">
        <div className="min-w-0">
          {back && (
            <Link
              to={back.to}
              className="mb-3 block font-mono text-[9.5px] font-semibold uppercase leading-none tracking-[0.12em] text-muted-foreground transition-colors hover:text-signal"
            >
              ← {back.label}
            </Link>
          )}
          <MonoLabel tone="signal" className="mb-2 block">
            {eyebrow}
          </MonoLabel>
          <h1 className="text-[36px] font-extrabold leading-none tracking-[-0.03em] text-foreground">
            {title}
            <TitleDot />
          </h1>
          {description && (
            <p className="mt-2 text-[13px] text-soft">{description}</p>
          )}
        </div>
        {action && <div className="flex shrink-0 items-center gap-2.5">{action}</div>}
      </div>
      {children}
    </header>
  )
}
