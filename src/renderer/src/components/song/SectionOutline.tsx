/**
 * SectionOutline — the song's sections down the left of the editor.
 * Click to jump to a section in the lyrics; drag to reorder (the move is
 * applied to the text, so it's undoable); "Add section" inserts a header
 * at the cursor. Lyrics before the first header can't be dragged — they
 * have no header to carry — and nothing can be dropped above them.
 */

import { useRef, useState } from 'react'
import type { LyricsLayout } from '../../lib/lyricsLayout'
import { SECTION_KINDS, type SectionKind } from '../../lib/lyricsEdit'
import { cn } from '../../lib/utils'
import { PlusIcon } from '../icons'
import { MenuButton } from './MenuButton'

export function SectionOutline({
  layout,
  currentSection,
  onJump,
  onAdd,
  onMove
}: {
  layout: LyricsLayout
  currentSection: number | null
  onJump: (section: number) => void
  onAdd: (kind: SectionKind) => void
  onMove: (from: number, to: number) => void
}): JSX.Element {
  // The dragged index lives in a ref for the handlers (dragover can fire
  // before React re-renders after dragstart) and in state for the visuals.
  const dragFrom = useRef<number | null>(null)
  const [dragging, setDragging] = useState<number | null>(null)
  const [dropAt, setDropAt] = useState<number | null>(null)
  const { sections } = layout
  const canDropAt = (i: number): boolean => sections[i]?.headerLine !== null

  return (
    <nav aria-label="Sections" className="flex min-h-0 flex-col border-r border-rule">
      <div className="flex items-baseline justify-between px-5 pb-2 pt-4 text-[12px] font-medium text-muted-foreground">
        <span>Sections</span>
        <span className="tabular-nums">{sections.length}</span>
      </div>

      <ol className="scroll-hairline min-h-0 flex-1 overflow-y-auto px-2.5">
        {sections.length === 0 && (
          <li className="px-2.5 py-1 text-[13px] leading-relaxed text-muted-foreground">
            Sections appear here as you add <span className="text-accent">[Verse]</span> and{' '}
            <span className="text-accent">[Chorus]</span> headers.
          </li>
        )}
        {sections.map((s, i) => {
          const movable = s.headerLine !== null
          const on = i === currentSection
          return (
            <li
              key={`${i}-${s.label}`}
              draggable={movable}
              onDragStart={(e) => {
                dragFrom.current = i
                setDragging(i)
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('text/plain', String(i))
              }}
              onDragOver={(e) => {
                if (dragFrom.current === null || !canDropAt(i)) return
                e.preventDefault()
                setDropAt(i)
              }}
              onDragLeave={() => setDropAt((d) => (d === i ? null : d))}
              onDrop={(e) => {
                e.preventDefault()
                const from = dragFrom.current
                if (from !== null && canDropAt(i)) onMove(from, i)
                dragFrom.current = null
                setDragging(null)
                setDropAt(null)
              }}
              onDragEnd={() => {
                dragFrom.current = null
                setDragging(null)
                setDropAt(null)
              }}
              className={cn(
                'relative rounded-lg',
                dragging === i && 'opacity-40',
                dropAt === i &&
                  dragging !== i &&
                  (dragging !== null && dragging < i
                    ? 'shadow-[inset_0_-2px_0_hsl(var(--accent))]'
                    : 'shadow-[inset_0_2px_0_hsl(var(--accent))]')
              )}
            >
              <button
                type="button"
                onClick={() => onJump(i)}
                aria-current={on ? 'true' : undefined}
                className={cn(
                  'group flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70',
                  on ? 'bg-selected' : 'hover:bg-raised',
                  movable && 'cursor-grab active:cursor-grabbing'
                )}
              >
                {on && (
                  <span className="absolute bottom-2 left-0 top-2 w-[3px] rounded-full bg-accent" />
                )}
                <span className="flex h-[18px] min-w-[24px] items-center justify-center rounded-[5px] bg-hover px-1 text-[10.5px] font-semibold text-quiet">
                  {s.chip}
                </span>
                <span
                  className={cn(
                    'min-w-0 flex-1 truncate text-[13.5px] font-medium',
                    s.label ? 'text-bone' : 'italic text-muted-foreground'
                  )}
                >
                  {s.label || 'Before first section'}
                </span>
                <span
                  className={cn(
                    'shrink-0 text-[12px] tabular-nums',
                    s.slideCount === 0 ? 'text-warn' : 'text-muted-foreground'
                  )}
                  title={
                    s.slideCount === 0
                      ? 'No lyrics yet — this section shows nothing'
                      : `${s.slideCount} slide${s.slideCount === 1 ? '' : 's'}`
                  }
                >
                  {s.slideCount}
                </span>
              </button>
            </li>
          )
        })}
      </ol>

      <div className="shrink-0 px-2.5 pb-3 pt-2">
        <MenuButton
          className="flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border text-[13px] text-soft transition-colors hover:border-border hover:bg-raised hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
          label={
            <>
              <PlusIcon size={14} />
              Add section
            </>
          }
          items={SECTION_KINDS.map((k) => ({ id: k.kind, label: k.label }))}
          onPick={(id) => onAdd(id as SectionKind)}
          placement="up"
        />
        {sections.length > 1 && (
          <p className="mt-3 px-1 text-[12px] leading-relaxed text-muted-foreground">
            Drag to reorder. Click to jump to it in the lyrics.
          </p>
        )}
      </div>
    </nav>
  )
}
