/**
 * Button — KLB square button.
 *
 * Variants:
 *   signal   Filled #E23C0F. The single most important action per view.
 *   outline  1px edge border, transparent fill. Alternate actions.
 *   ghost    No border, no fill. Dense toolbars and nav.
 *   danger   Deep-red text and border. Deletes only.
 *
 * Labels are mono uppercase with .1em tracking, matching every button
 * in the design file. Heights are 30/38/46 for sm/md/lg.
 */

import { cloneElement, forwardRef, type ButtonHTMLAttributes, type ReactElement } from 'react'
import { cn } from '../../lib/utils'

type Variant = 'signal' | 'outline' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  asChild?: boolean
}

const BASE =
  'inline-flex items-center justify-center gap-2 select-none whitespace-nowrap ' +
  'font-mono font-semibold uppercase tracking-[0.1em] ' +
  'transition-colors duration-100 ' +
  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-signal ' +
  'disabled:pointer-events-none disabled:opacity-40'

const VARIANTS: Record<Variant, string> = {
  signal: 'border-0 bg-signal text-white hover:bg-signal-deep',
  outline:
    'border border-dim bg-transparent text-bone hover:border-white hover:text-white',
  ghost: 'border-0 bg-transparent text-soft hover:text-white',
  danger:
    'border border-dim bg-transparent text-signal-deep hover:border-signal-deep'
}

const SIZES: Record<Size, string> = {
  sm: 'h-[30px] px-3 text-[9px]',
  md: 'h-[38px] px-4 text-[10px]',
  lg: 'h-[46px] px-6 text-[10.5px]'
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { className, variant = 'outline', size = 'md', asChild = false, children, ...rest },
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
