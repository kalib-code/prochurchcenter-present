/**
 * Button.
 *
 * Variants:
 *   primary    Light fill on dark. The one main action per view.
 *   secondary  Raised surface + hairline. Alternate actions.
 *   ghost      No chrome until hover. Toolbars, nav, low-emphasis actions.
 *   danger     Red text; red fill on hover. Destructive actions only.
 *   live       Solid red. Reserved for going/being ON AIR.
 *
 * `signal` and `outline` are the pre-redesign names; they map to
 * primary and secondary so older call sites keep working.
 *
 * Labels are sentence case in the UI font — not mono caps.
 */

import { cloneElement, forwardRef, type ButtonHTMLAttributes, type ReactElement } from 'react'
import { cn } from '../../lib/utils'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'live' | 'signal' | 'outline'
type Size = 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  asChild?: boolean
}

const BASE =
  'inline-flex items-center justify-center gap-2 select-none whitespace-nowrap rounded-md ' +
  'font-medium transition-colors duration-100 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-panel ' +
  'disabled:pointer-events-none disabled:opacity-40'

const PRIMARY = 'bg-foreground text-app hover:bg-white'
const SECONDARY = 'border border-border bg-raised text-foreground hover:bg-hover'

const VARIANTS: Record<Variant, string> = {
  primary: PRIMARY,
  signal: PRIMARY,
  secondary: SECONDARY,
  outline: SECONDARY,
  ghost: 'bg-transparent text-soft hover:bg-hover hover:text-foreground',
  danger: 'bg-transparent text-live hover:bg-live/15',
  live: 'bg-live text-white hover:bg-live/90'
}

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px]',
  md: 'h-9 px-3.5 text-[13.5px]',
  lg: 'h-11 px-5 text-[15px]'
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { className, variant = 'secondary', size = 'md', asChild = false, children, ...rest },
    ref
  ) {
    const classes = cn(BASE, VARIANTS[variant], SIZES[size], className)

    if (asChild) {
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
