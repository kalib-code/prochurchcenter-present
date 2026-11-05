/**
 * MenuButton — a button that opens a small list of choices below it.
 * Closes on choice, outside click, or Escape. Keyboard: ↑/↓ and Enter.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '../../lib/utils'

export interface MenuItem {
  id: string
  label: string
}

export function MenuButton({
  label,
  items,
  onPick,
  className,
  align = 'left',
  placement = 'down'
}: {
  label: ReactNode
  items: MenuItem[]
  onPick: (id: string) => void
  className?: string
  align?: 'left' | 'right'
  /** 'up' for buttons near the bottom of the window. */
  placement?: 'down' | 'up'
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    setActive(0)
    list.current?.focus()
    const onDown = (e: MouseEvent): void => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  const pick = (id: string): void => {
    setOpen(false)
    onPick(id)
  }

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        // Keep the lyrics textarea's cursor where it is.
        onMouseDown={(e) => e.preventDefault()}
        className={className}
      >
        {label}
      </button>
      {open && (
        <div
          ref={list}
          role="menu"
          tabIndex={-1}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false)
            else if (e.key === 'ArrowDown') setActive((i) => (i + 1) % items.length)
            else if (e.key === 'ArrowUp') setActive((i) => (i - 1 + items.length) % items.length)
            else if (e.key === 'Enter') pick(items[active].id)
            else return
            e.preventDefault()
          }}
          className={cn(
            'absolute z-30 min-w-[160px] rounded-lg border border-border bg-raised p-1 shadow-xl shadow-black/40 focus:outline-none',
            align === 'right' ? 'right-0' : 'left-0',
            placement === 'up' ? 'bottom-full mb-1' : 'top-full mt-1'
          )}
        >
          {items.map((item, i) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              onMouseDown={(e) => e.preventDefault()}
              onMouseMove={() => setActive(i)}
              onClick={() => pick(item.id)}
              className={cn(
                'flex h-8 w-full items-center rounded-md px-2.5 text-left text-[13px]',
                i === active ? 'bg-hover text-foreground' : 'text-bone'
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
