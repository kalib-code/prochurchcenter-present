/**
 * Button — the one button primitive for the polished pages.
 *
 * Variants:
 *   - primary     Warm gold, used for the single most-important action
 *                 on a page ("Start Service", "+ New Setlist").
 *                 Only ONE per view. If you need two, one must be
 *                 secondary.
 *   - secondary   Neutral bordered button — still feels "button-shaped"
 *                 but quieter than primary. Use for alternate actions.
 *   - ghost       Text-only with hover surface. For low-priority
 *                 actions in dense toolbars / table headers.
 *   - destructive Red border + red text. Hover intensifies. Reserved
 *                 for deletes and irreversible actions.
 *
 * Sizes: sm | md | lg. Heights 28 / 36 / 44 px respectively.
 *
 * Supports rendering as a child element via `asChild` so React Router
 * `<Link>` can be styled as a button without extra nesting. Uses a
 * tiny manual implementation (cloneElement) instead of pulling in
 * Radix Slot — no new deps.
 */

import { cloneElement, forwardRef, type ButtonHTMLAttributes, type ReactElement } from 'react'
import { cn } from '../../lib/utils'

type Variant = 'primary' | 'secondary' | 'ghost' | 'destructive'
type Size = 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  /**
   * When true, render the component's class + handlers onto its child
   * instead of wrapping in a <button>. Useful for `<Link>` targets.
   */
  asChild?: boolean
}

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-md font-medium ' +
  'transition-all duration-150 ease-out ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background ' +
  'disabled:pointer-events-none disabled:opacity-50 ' +
  'whitespace-nowrap select-none'

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-brand text-brand-foreground shadow-glow-brand hover:bg-brand/90 active:scale-[0.98]',
  secondary:
    'border border-border/70 bg-background/40 text-foreground hover:border-border hover:bg-muted/40 active:scale-[0.98]',
  ghost:
    'text-muted-foreground hover:bg-muted/50 hover:text-foreground active:scale-[0.98]',
  destructive:
    'border border-destructive/40 text-destructive hover:bg-destructive/10 hover:border-destructive/70 active:scale-[0.98]'
}

const SIZES: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-xs',
  md: 'h-9 px-4 text-sm',
  lg: 'h-11 px-6 text-[15px]'
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { className, variant = 'secondary', size = 'md', asChild = false, children, ...rest },
    ref
  ) {
    const classes = cn(BASE, VARIANTS[variant], SIZES[size], className)

    if (asChild) {
      // asChild: project the class + handlers onto the child. The child
      // MUST be a single React element (typically a <Link>). We don't
      // try to be clever about merging refs — the caller can pass their
      // own ref via the child directly if needed.
      const child = children as ReactElement<{ className?: string }>
      return cloneElement(child, {
        className: cn(classes, child.props.className),
        ...rest
      } as Partial<typeof child.props>)
    }

    return (
      <button ref={ref} className={classes} {...rest}>
        {children}
      </button>
    )
  }
)
