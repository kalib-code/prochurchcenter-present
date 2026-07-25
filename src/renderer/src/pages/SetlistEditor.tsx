/**
 * SetlistEditor — plan a service.
 *
 * Layout: top bar, a meta strip (name/date/service-start + the running
 * total), then a scrolling run-of-show list. Each item is a draggable
 * card; items reorder via @dnd-kit/sortable for mouse OR via ↑/↓ keys
 * when the list container is focused.
 *
 * Autosave: whenever the draft changes, debounced 500ms, patch goes
 * to main. Same pattern as SongEditor.
 *
 * Timing: `computeSchedule` (Task 14) turns the ordered items + each
 * item's `durationMinutes` + the setlist's `startTime` into a per-item
 * clock column, a running total, and a projected end time. Section
 * dividers never consume service time — enforced inside
 * computeSchedule, not here.
 *
 * Media-missing: `useMediaCheck` flags items whose backing file no
 * longer exists on disk (moved/renamed since it was added). The count
 * surfaces in the meta strip; the per-item banner + RELINK live in
 * SetlistItemCard.
 *
 * Item creation — the gap-insert model:
 *   A `GapInsert` ("+ INSERT HERE") renders above every item and once
 *   more after the last, so there is always an explicit slot for every
 *   possible insertion point (including the very top and the very
 *   bottom). Clicking one opens an inline kind-picker panel AT that
 *   position; picking a kind inserts there and closes the panel. This
 *   replaces the old "top Add button + hover inserters" pair with a
 *   single, uniform mechanism that covers exactly the same positions.
 *
 * The AddItemPicker component owns the grid + song-sublist body; this
 * file wires it into the different insertion points and supplies the
 * position-specific header ("INSERT AT POSITION N" / "ADD TO THE END").
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react'
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
import type { AutosaveStatus } from '../hooks/useAutosave'
import { useSetlistStore } from '../stores/useSetlistStore'
import { useLibraryStore } from '../stores/useLibraryStore'
import { useAutosave } from '../hooks/useAutosave'
import { useMediaCheck } from '../hooks/useMediaCheck'
import { computeSchedule } from '../lib/serviceClock'
import { SetlistItemCard } from '../components/SetlistItemCard'
import { AddItemPicker } from '../components/AddItemPicker'
import { Button } from '../components/ui/Button'
import { Panel } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { MonoLabel } from '../components/ui/MonoLabel'
import { StatusDot } from '../components/ui/StatusDot'
import { Segmented } from '../components/ui/Segmented'
import { GapInsert } from '../components/ui/GapInsert'
import { formatServiceDate } from '../lib/setlist-helpers'
import { probePdfPageCount } from '../lib/pdfLoader'

interface Draft {
  name: string
  date: string
  items: SetlistItem[]
  startTime?: string
}

const EMPTY_ITEMS: SetlistItem[] = []

function setlistToDraft(s: Setlist): Draft {
  return { name: s.name, date: s.date, items: s.items, startTime: s.startTime }
}

function draftToPatch(d: Draft): UpdateSetlistPatch {
  return {
    name: d.name.trim() || 'Untitled Setlist',
    date: d.date,
    items: d.items,
    startTime: d.startTime
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

const STATUS_LABEL: Record<AutosaveStatus, string> = {
  idle: '',
  pending: 'UNSAVED CHANGES…',
  saving: 'SAVING…',
  saved: 'SAVED',
  error: 'ERROR SAVING'
}

function statusDotTone(status: AutosaveStatus): 'signal' | 'ok' | 'dim' {
  if (status === 'saved') return 'ok'
  if (status === 'idle') return 'dim'
  return 'signal'
}

function statusDotPulse(status: AutosaveStatus): boolean | 'fast' {
  if (status === 'saving') return 'fast'
  if (status === 'pending') return true
  return false
}

export function SetlistEditor(): JSX.Element {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { setlists, load: loadSetlists, update, remove, getById } = useSetlistStore()
  const { songs, load: loadLibrary } = useLibraryStore()

  const [draft, setDraft] = useState<Draft | null>(null)
  const [insertAt, setInsertAt] = useState<InsertAt>(null)
  const [pickerView, setPickerView] = useState<'grid' | 'song'>('grid')
  const [density, setDensity] = useState<'detail' | 'compact'>('detail')

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

  // Hooks below must run unconditionally — `draft` may still be null
  // while the setlist loads, so every read of it falls back safely.
  const items = draft?.items ?? EMPTY_ITEMS
  const { missing } = useMediaCheck(items)
  const schedule = useMemo(
    () => computeSchedule(items, draft?.startTime),
    [items, draft?.startTime]
  )

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

  const openPickerAt = (pos: number): void => {
    if (insertAt === pos) {
      closePicker()
      return
    }
    setInsertAt(pos)
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

  const duplicateItem = (itemId: string): void => {
    const idx = draft.items.findIndex((i) => i.id === itemId)
    if (idx < 0) return
    const copy: SetlistItem = { ...draft.items[idx], id: genItemId() }
    const next = [...draft.items]
    next.splice(idx + 1, 0, copy)
    patch({ items: next })
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

  const pickerHandlers = {
    onPickSong: addSong,
    onAddScripture: addScripture,
    onAddImage: () => void addImage(),
    onAddVideo: () => void addVideo(),
    onAddDeck: () => void addDeck(),
    onAddCountdown: addCountdown,
    onAddDivider: addDivider
  }

  /** The signal-bordered "INSERT AT POSITION n" / "ADD TO THE END" panel. */
  const renderInsertPanel = (position: number): ReactNode => {
    const label =
      position >= draft.items.length ? 'ADD TO THE END' : `INSERT AT POSITION ${position + 1}`
    return (
      <Panel
        emphasis
        className="mb-2"
        title={<MonoLabel tone="signal">{label}</MonoLabel>}
        action={
          <button
            type="button"
            onClick={closePicker}
            aria-label="Close"
            className="font-mono text-[13px] text-muted-foreground hover:text-white"
          >
            ✕
          </button>
        }
      >
        <AddItemPicker
          {...pickerHandlers}
          songs={songs}
          view={pickerView}
          setView={setPickerView}
          onClose={closePicker}
        />
      </Panel>
    )
  }

  const itemsLabel = `${draft.items.length} ITEMS`
  const endOpen = insertAt === draft.items.length

  return (
    <div className="flex h-screen w-screen flex-col bg-background text-foreground">
      {/* ── Top bar ──────────────────────────────────────────────── */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card px-6">
        <div className="flex items-center gap-4">
          <Link
            to="/"
            className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground hover:text-signal"
          >
            ← HOME
          </Link>
          <span className="flex items-center gap-2">
            <StatusDot tone={statusDotTone(status)} pulse={statusDotPulse(status)} />
            <MonoLabel size="xs" tone="dim">
              {status === 'error' ? `${STATUS_LABEL.error}: ${error ?? 'unknown'}` : STATUS_LABEL[status]}
            </MonoLabel>
          </span>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="signal" size="md" asChild>
            <Link to={`/service/${id}`}>START SERVICE →</Link>
          </Button>
          <Button variant="danger" size="md" onClick={() => void handleDelete()}>
            DELETE
          </Button>
        </div>
      </header>

      {/* ── Meta strip ───────────────────────────────────────────── */}
      <section className="grid shrink-0 grid-cols-[1fr_240px] border-b border-border bg-card">
        <div className="border-r border-border px-6 py-5">
          <MonoLabel size="xs" className="mb-2 block">
            NAME
          </MonoLabel>
          <input
            type="text"
            value={draft.name}
            onChange={(e) => patch({ name: e.target.value })}
            className="w-full border border-border bg-background px-[13px] py-[11px] text-[15px] font-semibold tracking-[-0.01em] text-foreground outline-none focus:border-signal/50"
          />
          <div className="mt-2.5 flex flex-wrap items-center gap-3.5">
            <span className="font-mono text-[10px] font-medium tracking-[0.08em] text-muted-foreground">
              {formatServiceDate(draft.date).toUpperCase()} · {itemsLabel}
            </span>
            <span className="font-mono text-[10px] font-semibold tracking-[0.08em] text-signal">
              ≈ {schedule.totalMinutes} MIN · ENDS {schedule.endsAt}
            </span>
            {missing.size > 0 && (
              <Badge tone="signal">{missing.size} MEDIA MISSING</Badge>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-3.5 px-6 py-5">
          <label>
            <MonoLabel size="xs" className="mb-2 block">
              DATE
            </MonoLabel>
            <input
              type="date"
              value={draft.date}
              onChange={(e) => patch({ date: e.target.value })}
              className="w-full border border-border bg-background px-[13px] py-[11px] font-mono text-[13px] text-foreground outline-none focus:border-signal/50 [color-scheme:dark]"
            />
          </label>
          <label>
            <MonoLabel size="xs" className="mb-2 block">
              SERVICE STARTS
            </MonoLabel>
            <input
              type="time"
              value={draft.startTime ?? '10:00'}
              onChange={(e) => patch({ startTime: e.target.value })}
              className="w-full border border-border bg-background px-[13px] py-[11px] font-mono text-[13px] text-foreground outline-none focus:border-signal/50 [color-scheme:dark]"
            />
          </label>
        </div>
      </section>

      {/* ── Run of show ──────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto px-6 pb-10">
        {draft.items.length === 0 ? (
          <div className="py-6">
            <div className="mb-5 text-center">
              <h2 className="text-[22px] font-extrabold tracking-[-0.02em] text-foreground">
                Start your setlist
              </h2>
              <p className="mt-1 text-[13px] text-muted-foreground">
                Pick a kind of item to add. You can reorder later.
              </p>
            </div>
            <Panel emphasis title={<MonoLabel tone="signal">ADD YOUR FIRST ITEM</MonoLabel>}>
              <AddItemPicker
                {...pickerHandlers}
                songs={songs}
                view={pickerView}
                setView={setPickerView}
                onClose={() => setPickerView('grid')}
              />
            </Panel>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between py-4">
              <div className="flex items-baseline gap-3.5">
                <MonoLabel tone="dim">RUN OF SHOW · {itemsLabel}</MonoLabel>
                <span className="text-[11.5px] text-dim">
                  Drag to reorder · click any gap to insert
                </span>
              </div>
              <div className="flex items-center gap-3">
                <Segmented
                  size="sm"
                  value={density}
                  onChange={setDensity}
                  options={[
                    { value: 'detail', label: 'DETAIL' },
                    { value: 'compact', label: 'COMPACT' }
                  ]}
                />
                <Button
                  variant="outline"
                  size="md"
                  onClick={() => (endOpen ? closePicker() : openPickerAt(draft.items.length))}
                >
                  + ADD ITEM
                </Button>
              </div>
            </div>

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
                      <GapInsert active={insertAt === idx} onClick={() => openPickerAt(idx)} />
                      {insertAt === idx && renderInsertPanel(idx)}
                      <SetlistItemCard
                        item={item}
                        songsById={songsById}
                        at={schedule.at[idx] ?? ''}
                        missing={missing.has(item.id)}
                        density={density}
                        onChange={(next) => updateItem(item.id, next)}
                        onDelete={() => deleteItem(item.id)}
                        onDuplicate={() => duplicateItem(item.id)}
                      />
                    </li>
                  ))}
                </ul>
              </SortableContext>
            </DndContext>

            <GapInsert active={endOpen} onClick={() => openPickerAt(draft.items.length)} />
            {endOpen && renderInsertPanel(draft.items.length)}

            <div className="mt-3.5 flex items-center justify-between border-t border-border pt-3">
              <MonoLabel tone="dim">
                {itemsLabel} · {schedule.totalMinutes} MIN · ENDS {schedule.endsAt}
              </MonoLabel>
              <span className="text-[11.5px] text-muted-foreground">
                Section dividers are grouping only — they never reach the projector.
              </span>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
