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
import type { CanvaImportResult } from '@shared/canva'
import { FEATURES } from '@shared/features'
import { useSetlistStore } from '../stores/useSetlistStore'
import { useLibraryStore } from '../stores/useLibraryStore'
import { useCanvaStore } from '../stores/useCanvaStore'
import { useAutosave } from '../hooks/useAutosave'
import { useMediaCheck } from '../hooks/useMediaCheck'
import { computeSchedule } from '../lib/serviceClock'
import { SetlistItemCard } from '../components/SetlistItemCard'
import { AddItemPicker } from '../components/AddItemPicker'
import { Button } from '../components/ui/Button'
import { Panel } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { MonoLabel } from '../components/ui/MonoLabel'
import { SaveStatePill } from '../components/ui/SaveStatePill'
import { Segmented } from '../components/ui/Segmented'
import { GapInsert } from '../components/ui/GapInsert'
import { formatServiceDate } from '../lib/setlist-helpers'
import { probePdfPageCount } from '../lib/pdfLoader'
import { evictPptxDeck, probeVisibleSlideCount } from '../lib/pptxLoader'

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

export function SetlistEditor(): JSX.Element {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { setlists, load: loadSetlists, update, remove, getById } = useSetlistStore()
  const { songs, load: loadLibrary } = useLibraryStore()
  const checkStale = useCanvaStore((s) => s.checkStale)

  const [draft, setDraft] = useState<Draft | null>(null)
  const [insertAt, setInsertAt] = useState<InsertAt>(null)
  const [pickerView, setPickerView] = useState<'grid' | 'song' | 'canva'>('grid')
  const [density, setDensity] = useState<'detail' | 'compact'>('detail')
  const [staleDesignIds, setStaleDesignIds] = useState<string[]>([])

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

  // Background staleness check: which Canva-sourced decks in this setlist
  // have changed in Canva since import. Deliberately fire-and-forget and
  // silent on failure — this app is offline-first, so an unreachable
  // Canva is a normal condition, not an error to surface. See
  // useCanvaStore's `checkStale` for how it avoids painting the shared
  // error banner.
  //
  // `canvaCheckKey` is a primitive summary (design id + updated-at pairs)
  // of the setlist's Canva decks, not the `draft` object itself. `draft`
  // is a fresh object on every keystroke (autosave patches it constantly
  // while the operator edits), so depending on it directly would refire
  // this check on every edit. The key only changes when a Canva deck is
  // added/removed/refreshed, which is what should actually trigger a
  // recheck — plus `id`, so switching setlists (if this component were
  // ever reused across ids) always keys the check to the right one.
  //
  // Skipped entirely while Canva is feature-flagged off: imported decks
  // still present as plain PDFs, but nothing should call out to Canva.
  const canvaCheckItems = FEATURES.canva && draft
    ? draft.items.flatMap((item) =>
        item.kind === 'deck' && item.canva
          ? [{ designId: item.canva.designId, designUpdatedAt: item.canva.designUpdatedAt }]
          : []
      )
    : []
  const canvaCheckKey = canvaCheckItems.length > 0 ? JSON.stringify(canvaCheckItems) : ''

  useEffect(() => {
    if (!canvaCheckKey) return
    const items = JSON.parse(canvaCheckKey) as { designId: string; designUpdatedAt: string }[]

    let cancelled = false
    void checkStale(items).then((ids) => {
      // Guards against a late response applying to a setlist the
      // operator has since navigated away from, or to items that have
      // since changed (e.g. the deck was refreshed while the check was
      // in flight).
      if (!cancelled) setStaleDesignIds(ids)
    })
    return () => {
      cancelled = true
    }
  }, [id, canvaCheckKey, checkStale])

  const { status, error, flush, cancel } = useAutosave<Draft | null>({
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

  // Item mutators below all derive the new list from `prev` (functional
  // setState) rather than this render's `draft.items`: several callers
  // run after an `await` (file pickers, PDF probes, Canva refresh, Bible
  // lookup), and building from the stale closure would silently revert
  // any edit the operator made while that await was in flight.
  const updateItems = (fn: (items: SetlistItem[]) => SetlistItem[]): void => {
    setDraft((prev) => (prev ? { ...prev, items: fn(prev.items) } : prev))
  }

  /** Insert a new item at the pending `insertAt` index. Defaults to append. */
  const insertItem = (newItem: SetlistItem): void => {
    updateItems((items) => {
      const next = [...items]
      next.splice(insertAt ?? items.length, 0, newItem)
      return next
    })
    closePicker()
  }

  const updateItem = (itemId: string, next: SetlistItem): void => {
    updateItems((items) => items.map((i) => (i.id === itemId ? next : i)))
  }

  const deleteItem = (itemId: string): void => {
    updateItems((items) => items.filter((i) => i.id !== itemId))
  }

  const duplicateItem = (itemId: string): void => {
    updateItems((items) => {
      const idx = items.findIndex((i) => i.id === itemId)
      if (idx < 0) return items
      const next = [...items]
      next.splice(idx + 1, 0, { ...items[idx], id: genItemId() })
      return next
    })
  }

  const handleDragEnd = (e: DragEndEvent): void => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    updateItems((items) => {
      const oldIndex = items.findIndex((i) => i.id === active.id)
      const newIndex = items.findIndex((i) => i.id === over.id)
      if (oldIndex < 0 || newIndex < 0) return items
      return arrayMove(items, oldIndex, newIndex)
    })
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
      // Empty so ScriptureEditor's default-translation effect picks a real
      // catalog id (ENGWEBP); 'NIV' isn't in the helloao catalog, so the
      // <select> showed another option while Lookup sent 'NIV' and failed.
      translation: ''
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

  const addPptx = async (): Promise<void> => {
    const picked = await window.api.dialog.pickFile('pptx')
    if (!picked) {
      closePicker()
      return
    }
    try {
      // Evict any stale cached parse for this exact path BEFORE probing.
      // Without this, re-picking the same file (the operator's expected
      // "fix a typo, re-import" workflow — this feature has no export
      // step) would silently serve the pre-edit parse forever: loadPptxDeck
      // caches by absolute path, so an edited file at the same path would
      // return the OLD slide count/content with no way to force a refresh
      // short of quitting the app. See pptxLoader.ts for why eviction only
      // clears this (operator) window's cache, not the projector's.
      evictPptxDeck(picked)
      const slideCount = await probeVisibleSlideCount(picked)
      if (slideCount === 0) {
        // Never create an item that cannot render (see spec). A deck
        // whose every slide is hidden would insert successfully here but
        // then vanish from the running order when slideify drops it —
        // silently, with no error, discovered only on Sunday.
        window.alert(
          'Every slide in that PowerPoint file is marked hidden, so there is nothing to project. Unhide at least one slide in PowerPoint and try again.'
        )
        closePicker()
        return
      }
      const title =
        picked.split(/[/\\]/).pop()?.replace(/\.pptx$/i, '') ?? 'PowerPoint'
      insertItem({
        kind: 'pptx',
        id: genItemId(),
        pptxPath: picked,
        slideCount,
        title
      })
    } catch (err) {
      console.error('[SetlistEditor] failed to open pptx', picked, err)
      window.alert(
        'Could not open that PowerPoint file. Make sure it is a .pptx (not an older .ppt), or export it to PDF from PowerPoint (File → Export → Create PDF/XPS) and add it as a PDF deck instead.'
      )
      closePicker()
    }
  }

  const addCanvaDeck = async (result: CanvaImportResult, designId: string): Promise<void> => {
    try {
      // Derive pageCount from the file itself, exactly as the manual deck
      // flow does. Canva's page_count is ignored — it is optional for some
      // design types, and this path is always correct.
      const pageCount = await probePdfPageCount(result.pdfPath)
      insertItem({
        kind: 'deck',
        id: genItemId(),
        pdfPath: result.pdfPath,
        pageCount,
        title: result.title,
        canva: {
          designId,
          designUpdatedAt: result.designUpdatedAt,
          importedAt: new Date().toISOString()
        }
      })
    } catch (err) {
      console.error('[SetlistEditor] failed to open Canva PDF', result.pdfPath, err)
      window.alert('Present could not open the PDF Canva produced. Please try importing again.')
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
    // Drop any pending autosave so it can't race the delete (or fire on
    // unmount) and write the setlist back to disk.
    cancel()
    await remove(id)
    navigate('/')
  }

  const pickerHandlers = {
    onPickSong: addSong,
    onAddScripture: addScripture,
    onAddImage: () => void addImage(),
    onAddVideo: () => void addVideo(),
    onAddDeck: () => void addDeck(),
    onAddPptx: () => void addPptx(),
    onAddCountdown: addCountdown,
    onAddDivider: addDivider,
    onOpenCanva: () => setPickerView('canva'),
    onImportCanva: (result: CanvaImportResult, designId: string) => void addCanvaDeck(result, designId)
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
          <SaveStatePill status={status} error={error} />
        </div>
        <div className="flex items-center gap-3">
          {/* Await the pending autosave before entering service mode, so an
              edit made in the last 500ms is on disk before the service loads
              the setlist — otherwise it would run the stale version. */}
          <Button
            variant="signal"
            size="md"
            onClick={() => void flush().then(() => navigate(`/service/${id}`))}
          >
            START SERVICE →
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
              // Clearing the native date field yields '' — ignore it and keep
              // the last valid date, or autosave writes '' and the header
              // renders "Invalid Date".
              onChange={(e) => {
                if (e.target.value) patch({ date: e.target.value })
              }}
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
                        staleDesignIds={staleDesignIds}
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
