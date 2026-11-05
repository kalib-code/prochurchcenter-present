/**
 * Small presentational pieces shared by the Setlist editor's run-of-show
 * rows (SetlistItemCard) and the editor page itself. Presentation only —
 * every handler is supplied by the caller.
 */

import {
  forwardRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode
} from 'react'
import { cn } from '../../lib/utils'
import { AlertIcon, GripIcon } from '../icons'

/** Square ghost button for an icon-only action. `label` becomes aria-label + tooltip. */
export function IconButton({
  label,
  tone = 'neutral',
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string
  tone?: 'neutral' | 'danger'
}): JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex h-8 w-8 flex-none items-center justify-center rounded-md text-muted-foreground transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70',
        tone === 'danger' ? 'hover:bg-live/15 hover:text-live' : 'hover:bg-hover hover:text-foreground',
        className
      )}
      {...rest}
    >
      {children}
    </button>
  )
}

/**
 * Borderless text input that reads as a title until hovered or focused.
 * Sizes to its content (`field-sizing: content`, Chromium 123+), so the
 * kind badge and meta can sit right after it on the same line.
 */
export const InlineTextInput = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(function InlineTextInput({ className, ...rest }, ref) {
  return (
    <input
      ref={ref}
      type="text"
      className={cn(
        '-mx-1.5 h-8 min-w-[4ch] max-w-full shrink rounded-md bg-transparent px-1.5',
        'text-[14px] font-medium text-foreground placeholder:font-normal placeholder:text-dim',
        'transition-colors [field-sizing:content] hover:bg-hover/70',
        'focus:bg-app focus:outline-none focus:ring-2 focus:ring-accent/40',
        className
      )}
      {...rest}
    />
  )
})

/**
 * The dnd-kit drag handle. Hidden until the row is hovered (or the handle
 * itself has keyboard focus, so ↑/↓ reordering stays reachable).
 */
export function DragHandle({
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement>): JSX.Element {
  return (
    <div
      aria-label="Drag to reorder"
      className={cn(
        'flex h-8 w-5 flex-none cursor-grab select-none items-center justify-center rounded text-muted-foreground',
        'opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground active:cursor-grabbing',
        'focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70',
        className
      )}
      {...rest}
    >
      <GripIcon size={16} />
    </div>
  )
}

/** Amber inline banner for a problem on one item (missing media, deleted song). */
export function ItemWarning({
  title,
  children,
  action
}: {
  title: string
  children: ReactNode
  action?: ReactNode
}): JSX.Element {
  return (
    <div className="mt-2 flex items-center gap-2.5 rounded-md border border-warn/25 bg-warn/10 px-3 py-2">
      <AlertIcon size={16} className="flex-none text-warn" />
      <p className="min-w-0 flex-1 text-[13px] leading-snug text-bone">
        <span className="font-medium text-warn">{title}</span>
        <span className="text-soft"> · </span>
        {children}
      </p>
      {action}
    </div>
  )
}

/** Small uppercase-free inline label used before a compact control. */
export function InlineLabel({ children }: { children: ReactNode }): JSX.Element {
  return <span className="flex-none text-[13px] text-muted-foreground">{children}</span>
}
