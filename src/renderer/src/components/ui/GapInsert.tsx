import { cn } from '../../lib/utils'

interface GapInsertProps {
  active?: boolean
  label?: string
  onClick: () => void
}

/**
 * Insert-between-rows affordance. Invisible until the pointer (or focus)
 * reaches the gap, so a long run of show isn't striped with
 * "insert here" lines.
 */
export function GapInsert({ active = false, label = 'Insert here', onClick }: GapInsertProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        'group flex h-5 w-full items-center transition-opacity focus-visible:outline-none',
        active ? 'opacity-100' : 'opacity-0 hover:opacity-100 focus-visible:opacity-100'
      )}
    >
      <span className="h-px flex-1 bg-accent/40" />
      <span className="mx-2 rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-medium leading-none text-accent">
        + {label}
      </span>
      <span className="h-px flex-1 bg-accent/40" />
    </button>
  )
}
