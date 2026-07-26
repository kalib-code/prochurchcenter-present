/**
 * Segmented — joined button group for mode switches.
 *
 * LIVE/BLACK/LOGO, GROUPED/FLAT, DETAIL/COMPACT all use this shape: a
 * shared 1px container border with hairline dividers between children,
 * the active child filled signal. Generic over the value type so
 * callers keep their union types instead of stringly-typed modes.
 */

import { cn } from '../../lib/utils'

export interface SegmentedOption<T extends string> {
  value: T
  label: string
}

interface SegmentedProps<T extends string> {
  options: SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  size?: 'sm' | 'md'
  className?: string
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  className
}: SegmentedProps<T>): JSX.Element {
  const pad = size === 'sm' ? 'px-[11px] py-1.5 text-[8.5px]' : 'px-[13px] py-2 text-[9px]'

  return (
    <span className={cn('inline-flex border border-border', className)}>
      {options.map((opt, i) => {
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            aria-pressed={active}
            className={cn(
              'font-mono font-semibold uppercase leading-none tracking-[0.1em] transition-colors',
              pad,
              i < options.length - 1 && 'border-r border-border',
              active ? 'bg-signal text-white' : 'bg-transparent text-muted-foreground hover:text-white'
            )}
          >
            {opt.label}
          </button>
        )
      })}
    </span>
  )
}
