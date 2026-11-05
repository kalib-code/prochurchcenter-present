/**
 * Solid status chips for Service Mode, readable on top of slide
 * thumbnails and the program preview (the tinted ui/Badge tones are too
 * faint over a bright slide).
 *
 *   OnAirBadge   red, pulsing dot — the projector is showing this now.
 *                Red is reserved for this one meaning.
 *   NextBadge    accent outline — what Space will put on screen.
 *   QuietBadge   neutral — Black / Logo / Current, i.e. not on air.
 */

import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

const CHIP =
  'inline-flex items-center gap-1.5 rounded px-1.5 py-[3px] text-[11px] font-semibold leading-none'

export function OnAirBadge({
  children = 'Live',
  className
}: {
  children?: ReactNode
  className?: string
}): JSX.Element {
  return (
    <span className={cn(CHIP, 'bg-live text-white shadow-sm', className)}>
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 animate-pulse-signal-fast rounded-full bg-white"
      />
      {children}
    </span>
  )
}

export function NextBadge({ className }: { className?: string }): JSX.Element {
  return (
    <span className={cn(CHIP, 'bg-app/85 text-accent ring-1 ring-inset ring-accent/50', className)}>
      Next
    </span>
  )
}

export function QuietBadge({
  children,
  className
}: {
  children: ReactNode
  className?: string
}): JSX.Element {
  return (
    <span className={cn(CHIP, 'bg-app/85 text-foreground ring-1 ring-inset ring-border', className)}>
      {children}
    </span>
  )
}
