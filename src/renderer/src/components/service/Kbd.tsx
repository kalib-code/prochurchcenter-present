/**
 * Kbd — a keyboard key chip for Service Mode's shortcut hints (top bar,
 * cheat sheet, video controls). Sans, not mono: mono is reserved for
 * clocks and timecodes in the redesign.
 */

import type { HTMLAttributes } from 'react'
import { cn } from '../../lib/utils'

export function Kbd({ className, ...rest }: HTMLAttributes<HTMLElement>): JSX.Element {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-[20px] items-center justify-center rounded border border-border bg-raised px-1.5',
        'font-sans text-[11px] font-medium leading-none text-quiet',
        className
      )}
      {...rest}
    />
  )
}
