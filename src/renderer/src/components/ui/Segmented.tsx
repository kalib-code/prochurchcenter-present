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

/** Segmented control: a recessed track with a raised "thumb" on the active option. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  className
}: SegmentedProps<T>): JSX.Element {
  const pad = size === 'sm' ? 'h-7 px-2.5 text-[12px]' : 'h-8 px-3 text-[13px]'

  return (
    <span className={cn('inline-flex rounded-lg bg-app p-0.5 ring-1 ring-border/70', className)}>
      {options.map((opt) => {
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            aria-pressed={active}
            className={cn(
              'rounded-md font-medium leading-none transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70',
              pad,
              active
                ? 'bg-hover text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {opt.label}
          </button>
        )
      })}
    </span>
  )
}
