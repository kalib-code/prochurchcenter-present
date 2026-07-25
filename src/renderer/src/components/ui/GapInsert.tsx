/**
 * GapInsert — the "+ INSERT HERE" affordance between setlist items.
 *
 * A centred mono label flanked by two hairlines. Dim until hovered or
 * active; signal when its picker is open. Design L420-424.
 */

import { cn } from '../../lib/utils'

interface GapInsertProps {
  active?: boolean
  label?: string
  onClick: () => void
}

export function GapInsert({
  active = false,
  label = '+ INSERT HERE',
  onClick
}: GapInsertProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex h-6 w-full items-center"
    >
      <span className={cn('h-px flex-1 transition-colors', active ? 'bg-signal/50' : 'bg-rule')} />
      <span
        className={cn(
          'px-2.5 font-mono text-[9px] font-semibold uppercase leading-none tracking-[0.1em] transition-colors',
          active ? 'text-signal' : 'text-border group-hover:text-signal'
        )}
      >
        {label}
      </span>
      <span className={cn('h-px flex-1 transition-colors', active ? 'bg-signal/50' : 'bg-rule')} />
    </button>
  )
}
