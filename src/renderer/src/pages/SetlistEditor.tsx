/**
 * SetlistEditor — plan a service.
 *
 * Layout (2026-11 redesign): a page header (inline-editable name, compact
 * date + start-time inputs, the running total, a missing-media badge,
 * Start service / Delete), then a scrolling run-of-show list of rounded
 * rows. Items reorder via @dnd-kit/sortable for mouse OR via the
 * keyboard sensor when a row's drag handle is focused.
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
 * surfaces as a warn badge in the header; the per-item banner + Relink
 * live in SetlistItemCard.
 *
 * Item creation — the gap-insert model:
 *   A `GapInsert` (hover-only "+ Insert here") renders above every item
 *   and once more after the last, so there is always an explicit slot
 *   for every possible insertion point (including the very top and the
 *   very bottom). Clicking one opens an inline kind-picker panel AT that
 *   position; picking a kind inserts there and closes the panel. This
 *   replaces the old "top Add button + hover inserters" pair with a
 *   single, uniform mechanism that covers exactly the same positions.
 *
 * The AddItemPicker component owns the grid + song-sublist body; this
 * file wires it into the different insertion points and supplies the
 * position-specific header ("Insert at position N" / "Add to the end").
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
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
import { Input } from '../components/ui/Input'
import { IconButton } from '../components/setlist/parts'
import { AlertIcon, CloseIcon, PlayIcon, PlusIcon, TrashIcon } from '../components/icons'
import { SaveStatePill } from '../components/ui/SaveStatePill'
import { Segmented } from '../components/ui/Segmented'
import { GapInsert } from '../components/ui/GapInsert'
import { formatServiceDate } from '../lib/setlist-helpers'
import { probePdfPageCount } from '../lib/pdfLoader'
import { evictPptxDeck, probeVisibleSlideCount } from '../lib/pptxLoader'
import { mergeExternalSetlist, sameSetlistFields } from '../lib/mergeExternalSetlist'

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

/**
 * Keyed by the route id so moving straight from one setlist to another
 * (the sidebar's Upcoming list makes that one click) mounts a fresh
 * editor. Without the key the previous setlist's draft survived the
 * route change and autosave wrote it under the NEW id; with it, the old
 * instance unmounts and flushes any pending edit to its own id.
 */
export function SetlistEditor(): JSX.Element {
  const { id } = useParams<{ id: string }>()
  return <SetlistEditorForId key={id ?? ''} />
}

function SetlistEditorForId(): JSX.Element {
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

  // What this editor last knew was on disk — the "base" of the three-way
  // merge when an AI tool saves this setlist while it is open.
  const baseRef = useRef<Draft | null>(null)

  useEffect(() => {
    if (draft) return
    if (!id) return
    const s = getById(id)
    if (s) {
      baseRef.current = setlistToDraft(s)
      setDraft(setlistToDraft(s))
    }
  }, [id, draft, setlists, getById])

  // An AI tool (MCP) saved this setlist: fold its change into the draft
  // instead of letting the next autosave write over it. Pending local
  // edits survive; see mergeExternalSetlist for the rules.
  useEffect(() => {
    if (!id) return
    return window.api.library.onExternalChange((change) => {
      if (change.kind !== 'setlist' || change.setlist.id !== id) return
      const remote = setlistToDraft(change.setlist)
      const base = baseRef.current ?? remote
      baseRef.current = remote
      setDraft((prev) => (prev ? mergeExternalSetlist(base, prev, remote) : remote))
    })
  }, [id])

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
      const patch = draftToPatch(value)
      const asDraft: Draft = {
        name: patch.name ?? value.name,
        date: patch.date ?? value.date,
        items: patch.items ?? value.items,
        startTime: patch.startTime
      }
      // A merged-in AI change with no local edits is already on disk.
      if (sameSetlistFields(asDraft, baseRef.current)) return
      const saved = await update(id, patch)
      baseRef.current = setlistToDraft(saved)
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

  /** The "Insert at position n" / "Add to the end" panel. */
  const renderInsertPanel = (position: number): ReactNode => {
    const label =
      position >= draft.items.length ? 'Add to the end' : `Insert at position ${position + 1}`
    return (
      <Panel
        emphasis
        className="my-1"
        title={label}
        action={
          <IconButton label="Close" onClick={closePicker} className="-my-1 -mr-1.5 h-7 w-7">
            <CloseIcon size={16} />
          </IconButton>
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

  const itemCount = draft.items.length
  const itemsLabel = `${itemCount} item${itemCount === 1 ? '' : 's'}`
  const totalsLabel = `${itemsLabel} · ~${schedule.totalMinutes} min · ends ${schedule.endsAt}`
  const endOpen = insertAt === draft.items.length

  return (
    <div className="flex h-full w-full min-h-0 flex-col text-foreground">
      {/* ── Header ───────────────────────────────────────────────── */}
      <header className="shrink-0 px-8 pb-5 pt-7">
        <div className="flex items-center justify-between gap-6">
          <h1 className="min-w-0 flex-1">
            <input
              type="text"
              value={draft.name}
              onChange={(e) => patch({ name: e.target.value })}
              placeholder="Untitled setlist"
              aria-label="Setlist name"
              className="-ml-2 w-full truncate rounded-md bg-transparent px-2 py-0.5 text-[26px] font-semibold leading-tight tracking-[-0.02em] text-foreground transition-colors placeholder:text-dim hover:bg-raised/70 focus:bg-raised focus:outline-none focus:ring-2 focus:ring-accent/40"
            />
          </h1>
          <div className="flex shrink-0 items-center gap-2">
            <SaveStatePill status={status} error={error} />
            <Button variant="danger" size="md" onClick={() => void handleDelete()}>
              <TrashIcon size={15} />
              Delete
            </Button>
            {/* Await the pending autosave before entering service mode, so an
                edit made in the last 500ms is on disk before the service loads
                the setlist — otherwise it would run the stale version. */}
            <Button
              variant="primary"
              size="md"
              onClick={() => void flush().then(() => navigate(`/service/${id}`))}
            >
              <PlayIcon size={14} />
              Start service
            </Button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px] text-soft">
          <Input
            type="date"
            value={draft.date}
            aria-label="Service date"
            title={formatServiceDate(draft.date)}
            // Clearing the native date field yields '' — ignore it and keep
            // the last valid date, or autosave writes '' and the header
            // renders "Invalid Date".
            onChange={(e) => {
              if (e.target.value) patch({ date: e.target.value })
            }}
            className="h-8 w-auto px-2.5 text-[13px] tabular-nums"
          />
          <span className="text-muted-foreground">starts</span>
          <Input
            type="time"
            value={draft.startTime ?? '10:00'}
            aria-label="Service start time"
            onChange={(e) => patch({ startTime: e.target.value })}
            className="h-8 w-auto px-2.5 text-[13px] tabular-nums"
          />
          <span className="ml-2 tabular-nums">{totalsLabel}</span>
          {missing.size > 0 && (
            <Badge tone="warn" className="ml-2 py-1">
              <AlertIcon size={12} />
              {missing.size} missing media
            </Badge>
          )}
        </div>
      </header>

      {/* ── Run of show ──────────────────────────────────────────── */}
      <section
        aria-label="Run of show"
        className="scroll-hairline min-h-0 flex-1 overflow-y-auto px-8 pb-10"
      >
        {draft.items.length === 0 ? (
          <div className="mx-auto max-w-4xl py-8">
            <div className="mb-5 text-center">
              <h2 className="text-[18px] font-semibold tracking-[-0.01em] text-foreground">
                Start your setlist
              </h2>
              <p className="mt-1 text-[14px] text-soft">
                Pick a kind of item to add. You can reorder later.
              </p>
            </div>
            <Panel title="Add your first item">
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
            <div className="flex items-center justify-between gap-4 border-t border-rule pb-2 pt-5">
              <div className="flex min-w-0 items-baseline gap-3">
                <h2 className="text-[15px] font-semibold text-foreground">Run of show</h2>
                <span className="truncate text-[13px] text-muted-foreground">
                  Drag to reorder · hover between items to insert
                </span>
              </div>
              <div className="flex flex-none items-center gap-2">
                <Segmented
                  size="sm"
                  value={density}
                  onChange={setDensity}
                  options={[
                    { value: 'detail', label: 'Detail' },
                    { value: 'compact', label: 'Compact' }
                  ]}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => (endOpen ? closePicker() : openPickerAt(draft.items.length))}
                >
                  <PlusIcon size={15} />
                  Add item
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

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-rule pt-3 text-[13px] text-muted-foreground">
              <span className="tabular-nums">{totalsLabel}</span>
              <span>Section dividers group items. They never reach the projector.</span>
            </div>
          </>
        )}
      </section>
    </div>
  )
}
