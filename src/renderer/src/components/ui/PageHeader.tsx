import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

interface PageHeaderProps {
  /** Optional small context line above the title (sentence case). */
  eyebrow?: string
  title: string
  description?: string
  /** Breadcrumb-style link above the title, e.g. back to Songs. */
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
    <header className="shrink-0 px-8 pt-7">
      <div className="flex items-end justify-between gap-6 pb-5">
        <div className="min-w-0">
          {back && (
            <Link
              to={back.to}
              className="mb-2 inline-flex items-center gap-1 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
            >
              <span aria-hidden="true">←</span> {back.label}
            </Link>
          )}
          {eyebrow && !back && (
            <div className="mb-1 text-[13px] text-muted-foreground">{eyebrow}</div>
          )}
          <h1 className="truncate text-[26px] font-semibold leading-tight tracking-[-0.02em] text-foreground">
            {title}
          </h1>
          {description && <p className="mt-1.5 text-[14px] text-soft">{description}</p>}
        </div>
        {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
      </div>
      {children}
    </header>
  )
}
