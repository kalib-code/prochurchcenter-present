/**
 * SetlistEditor — plan a service.
 *
 * Layout: top bar with name + date, then a scrolling list of items.
 * Each item is a draggable card; items reorder via @dnd-kit/sortable
 * for mouse OR via ↑/↓ keys when the list container is focused.
 *
 * Autosave: whenever the draft changes, debounced 500ms, patch goes
 * to main. Same pattern as SongEditor.
 *
 * Item creation:
 *   - The primary "+ Add item" button sits at the TOP of the list, not
 *     the bottom. Rose and the volunteer operators kept scrolling to
 *     the bottom to add, which was extra work — the top button is in
 *     their line-of-sight as soon as the editor opens.
 *   - Between each existing item there is a quiet hover-reveal "+
 *     insert here" drop-zone. This lets the operator add mid-list
 *     without reordering after the fact — the old flow required
 *     adding to the bottom then dragging into position.
 *   - When the list is empty, the inline picker takes over the main
 *     area as a large kind-chooser grid so there is literally nothing
 *     else to click.
 *
 * The AddItemPicker component owns the grid + song-sublist UI; this
 * file just wires it into the different insertion points.
 */

import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import type { Setlist, SetlistItem } from '@shared/types'
import type { UpdateSetlistPatch } from '@shared/ipc-contract'
import { useSetlistStore } from '../stores/useSetlistStore'
import { useLibraryStore } from '../stores/useLibraryStore'
import { useAutosave } from '../hooks/useAutosave'
import { SetlistItemCard } from '../components/SetlistItemCard'
import { AddItemPicker } from '../components/AddItemPicker'
import { Button } from '../components/ui/Button'
import { formatServiceDate } from '../lib/setlist-helpers'
import { probePdfPageCount } from '../lib/pdfLoader'

interface Draft {
  name: string
  date: string
  items: SetlistItem[]
}

function setlistToDraft(s: Setlist): Draft {
  return { name: s.name, date: s.date, items: s.items }
}

function draftToPatch(d: Draft): UpdateSetlistPatch {
  return {
    name: d.name.trim() || 'Untitled Setlist',
    date: d.date,
    items: d.items
  }
}

function genItemId(): string {
  return `item-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Insertion position for a new item.
 *   - number N means "insert at index N" (0 = prepend, items.length = append)
 *   - null means the picker is closed
 */
type InsertAt = number | null

export function SetlistEditor(): JSX.Element {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { setlists, load: loadSetlists, update, remove, getById } = useSetlistStore()
  const { songs, load: loadLibrary } = useLibraryStore()

  const [draft, setDraft] = useState<Draft | null>(null)
  const [insertAt, setInsertAt] = useState<InsertAt>(null)
  const [pickerView, setPickerView] = useState<'grid' | 'song'>('grid')

  useEffect(() => {
    if (setlists.length === 0) loadSetlists()
    if (songs.length === 0) loadLibrary()
  }, [setlists.length, songs.length, loadSetlists, loadLibrary])

  useEffect(() => {
    if (draft) return
    if (!id) return
    const s = getById(id)
    if (s) setDraft(setlistToDraft(s))
  }, [id, draft, setlists, getById])

  const { status, error } = useAutosave<Draft | null>({
    value: draft,
    onSave: async (value) => {
      if (!value || !id) return
      await update(id, draftToPatch(value))
    }
  })

  const songsById = useMemo(() => {
    const m = new Map<string, (typeof songs)[number]>()
    for (const s of songs) m.set(s.id, s)
    return m
  }, [songs])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  if (!id) return <div className="p-6 text-sm">No setlist id in URL.</div>

  if (!draft) {
    return <div className="p-6 text-sm text-muted-foreground">Loading setlist…</div>
  }

  const patch = (changes: Partial<Draft>): void => {
    setDraft((prev) => (prev ? { ...prev, ...changes } : prev))
  }

  const closePicker = (): void => {
    setInsertAt(null)
    setPickerView('grid')
  }

  /** Insert a new item at the pending `insertAt` index. Defaults to append. */
  const insertItem = (newItem: SetlistItem): void => {
    const at = insertAt ?? draft.items.length
    const next = [...draft.items]
    next.splice(at, 0, newItem)
    patch({ items: next })
    closePicker()
  }

  const updateItem = (itemId: string, next: SetlistItem): void => {
    patch({
      items: draft.items.map((i) => (i.id === itemId ? next : i))
    })
  }

  const deleteItem = (itemId: string): void => {
    patch({ items: draft.items.filter((i) => i.id !== itemId) })
  }

  const handleDragEnd = (e: DragEndEvent): void => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const oldIndex = draft.items.findIndex((i) => i.id === active.id)
    const newIndex = draft.items.findIndex((i) => i.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    patch({ items: arrayMove(draft.items, oldIndex, newIndex) })
  }

  const addSong = (songId: string): void => {
    insertItem({ kind: 'song', id: genItemId(), songId })
  }

  const addScripture = (): void => {
    insertItem({
      kind: 'scripture',
      id: genItemId(),
      reference: '',
      text: '',
      translation: 'NIV'
    })
  }

  const addDivider = (): void => {
    insertItem({ kind: 'section-divider', id: genItemId(), label: '' })
  }

  const addImage = async (): Promise<void> => {
    const picked = await window.api.dialog.pickFile('image')
    if (!picked) {
      closePicker()
      return
    }
    insertItem({ kind: 'image', id: genItemId(), imagePath: picked })
  }

  const addVideo = async (): Promise<void> => {
    const picked = await window.api.dialog.pickFile('video')
    if (!picked) {
      closePicker()
      return
    }
    const title = picked.split(/[/\\]/).pop()?.replace(/\.[^.]+$/, '') ?? 'Video'
    insertItem({ kind: 'video', id: genItemId(), videoPath: picked, title })
  }

  const addDeck = async (): Promise<void> => {
    const picked = await window.api.dialog.pickFile('pdf')
    if (!picked) {
      closePicker()
      return
    }
    try {
      const pageCount = await probePdfPageCount(picked)
      const title = picked.split(/[/\\]/).pop()?.replace(/\.pdf$/i, '') ?? 'PDF deck'
      insertItem({
        kind: 'deck',
        id: genItemId(),
        pdfPath: picked,
        pageCount,
        title
      })
    } catch (err) {
      console.error('[SetlistEditor] failed to open PDF', picked, err)
      window.alert(
        'Could not open that PDF. Try re-exporting it from PowerPoint (File → Export → Create PDF/XPS) or Keynote (File → Export To → PDF).'
      )
      closePicker()
    }
  }

  const addCountdown = (): void => {
    insertItem({
      kind: 'countdown',
      id: genItemId(),
      label: 'Service starts in',
      targetTime: new Date(Date.now() + 15 * 60_000).toISOString()
    })
  }

  const handleDelete = async (): Promise<void> => {
    const ok = window.confirm(`Delete "${draft.name}"?`)
    if (!ok) return
    await remove(id)
    navigate('/')
  }

  const statusLabel: Record<typeof status, string> = {
    idle: '',
    pending: 'Unsaved changes…',
    saving: 'Saving…',
    saved: 'Saved',
    error: `Error: ${error ?? 'unknown'}`
  }

  const pickerHandlers = {
    onPickSong: addSong,
    onAddScripture: addScripture,
    onAddImage: () => void addImage(),
    onAddVideo: () => void addVideo(),
    onAddDeck: () => void addDeck(),
    onAddCountdown: addCountdown,
    onAddDivider: addDivider
  }

  const topAddOpen = insertAt === 0
  const itemCountLabel = `${draft.items.length} item${draft.items.length === 1 ? '' : 's'}`

  return (
    <div className="flex h-screen w-screen flex-col bg-background text-foreground">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <header className="flex items-center gap-4 border-b border-border/40 px-6 py-3">
        <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
          ← Home
        </Link>
        <span className="text-xs text-muted-foreground">{statusLabel[status]}</span>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="primary" size="md" asChild>
            <Link to={`/service/${id}`}>Start Service →</Link>
          </Button>
          <Button variant="ghost" size="sm" onClick={handleDelete}>
            Delete
          </Button>
        </div>
      </header>

      {/* ── Metadata ─────────────────────────────────────────────── */}
      <section className="border-b border-border/40 px-6 py-4">
        <div className="mx-auto flex max-w-4xl gap-3">
          <label className="flex-1">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
              Name
            </span>
            <input
              type="text"
              value={draft.name}
              onChange={(e) => patch({ name: e.target.value })}
              className="w-full rounded-md border border-border/60 bg-background px-3 py-1.5 text-sm outline-none focus:border-brand/50"
            />
          </label>
          <label className="w-56">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
              Date
            </span>
            <input
              type="date"
              value={draft.date}
              onChange={(e) => patch({ date: e.target.value })}
              className="w-full rounded-md border border-border/60 bg-background px-3 py-1.5 text-sm outline-none focus:border-brand/50"
            />
          </label>
        </div>
        <div className="mx-auto mt-2 max-w-4xl text-xs text-muted-foreground">
          {formatServiceDate(draft.date)} · {itemCountLabel}
        </div>
      </section>

      {/* ── Items list ─────────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-4xl">
          {/* Empty state: inline picker takes over the whole canvas. */}
          {draft.items.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/60 bg-card/20 p-8">
              <div className="mb-5 text-center">
                <h2 className="font-editorial text-xl font-semibold text-foreground">
                  Start your setlist
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Pick a kind of item to add. You can reorder later.
                </p>
              </div>
              <AddItemPicker
                {...pickerHandlers}
                songs={songs}
                mode="inline"
                view={pickerView}
                setView={setPickerView}
                onClose={closePicker}
              />
            </div>
          ) : (
            <>
              {/* Sticky top-of-list Add button + popover */}
              <div className="relative mb-3 flex justify-center">
                <Button
                  variant={topAddOpen ? 'primary' : 'secondary'}
                  size="md"
                  onClick={() => {
                    setInsertAt(topAddOpen ? null : 0)
                    setPickerView('grid')
                  }}
                >
                  + Add item
                </Button>
                {topAddOpen && (
                  <div className="absolute left-1/2 top-full z-20 mt-2 -translate-x-1/2">
                    <AddItemPicker
                      {...pickerHandlers}
                      songs={songs}
                      mode="popover"
                      view={pickerView}
                      setView={setPickerView}
                      onClose={closePicker}
                    />
                  </div>
                )}
              </div>

              {/* The list itself. Each item is followed by a hover-
                  reveal inline inserter so the operator can add BETWEEN
                  items without going back to the top button. */}
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={draft.items.map((i) => i.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <ul className="flex flex-col">
                    {draft.items.map((item, idx) => (
                      <li key={item.id}>
                        <SetlistItemCard
                          item={item}
                          songsById={songsById}
                          onChange={(next) => updateItem(item.id, next)}
                          onDelete={() => deleteItem(item.id)}
                        />
                        <InlineInserter
                          open={insertAt === idx + 1}
                          onOpen={() => {
                            setInsertAt(idx + 1)
                            setPickerView('grid')
                          }}
                          picker={
                            <AddItemPicker
                              {...pickerHandlers}
                              songs={songs}
                              mode="popover"
                              view={pickerView}
                              setView={setPickerView}
                              onClose={closePicker}
                            />
                          }
                          /* The final inserter doubles as the
                             bottom-of-list "append" affordance — keep
                             it visible even without hover. */
                          isLast={idx === draft.items.length - 1}
                        />
                      </li>
                    ))}
                  </ul>
                </SortableContext>
              </DndContext>
            </>
          )}
        </div>
      </main>
    </div>
  )
}

/**
 * Inline inserter — a thin horizontal zone between two list items that
 * reveals a "+ add here" pill on hover. Clicking it opens the picker
 * anchored to this slot, so the next kind chosen gets inserted at this
 * exact index rather than appended to the end.
 *
 * The last-in-list one stays subtly visible even when not hovered so
 * users always have a visible "append" target.
 */
function InlineInserter({
  open,
  onOpen,
  picker,
  isLast
}: {
  open: boolean
  onOpen: () => void
  picker: JSX.Element
  isLast: boolean
}): JSX.Element {
  return (
    <div className="relative">
      <div
        className={
          'group flex h-6 items-center justify-center ' +
          (isLast ? 'pt-1' : '')
        }
      >
        <button
          onClick={onOpen}
          className={
            'flex items-center gap-1.5 rounded-full border border-dashed px-3 py-0.5 text-[11px] font-medium transition-all ' +
            (isLast
              ? 'border-border/50 text-muted-foreground opacity-80 hover:border-brand/60 hover:text-brand hover:opacity-100'
              : 'border-transparent text-muted-foreground opacity-0 hover:border-brand/60 hover:text-brand group-hover:opacity-100')
          }
          aria-label="Insert item here"
        >
          <span className="text-sm leading-none">+</span>
          <span>Add item</span>
        </button>
      </div>
      {open && (
        <div className="absolute left-1/2 top-full z-20 mt-1 -translate-x-1/2">
          {picker}
        </div>
      )}
    </div>
  )
}
