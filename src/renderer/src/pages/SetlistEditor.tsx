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
 * Item creation: "+ Add" button opens a small menu of kinds. Song adds
 * use the SongPicker; other kinds create an empty instance inline.
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
import { SongPicker } from '../components/SongPicker'
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

// Small ID generator for setlist items — these live inside a setlist
// JSON and don't need to be UUIDs; short random is fine and keeps files
// readable.
function genItemId(): string {
  return `item-${Math.random().toString(36).slice(2, 10)}`
}

export function SetlistEditor(): JSX.Element {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { setlists, load: loadSetlists, update, remove, getById } = useSetlistStore()
  const { songs, load: loadLibrary } = useLibraryStore()

  const [draft, setDraft] = useState<Draft | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [addMenuOpen, setAddMenuOpen] = useState(false)

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

  // Map for O(1) song lookup inside cards
  const songsById = useMemo(() => {
    const m = new Map<string, (typeof songs)[number]>()
    for (const s of songs) m.set(s.id, s)
    return m
  }, [songs])

  // dnd-kit sensors: pointer for mouse, keyboard for a11y (Space picks up, arrows move)
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
    patch({
      items: [...draft.items, { kind: 'song', id: genItemId(), songId }]
    })
    setPickerOpen(false)
    setAddMenuOpen(false)
  }

  const addScripture = (): void => {
    patch({
      items: [
        ...draft.items,
        {
          kind: 'scripture',
          id: genItemId(),
          reference: '',
          text: '',
          translation: 'NIV'
        }
      ]
    })
    setAddMenuOpen(false)
  }

  const addDivider = (): void => {
    patch({
      items: [...draft.items, { kind: 'section-divider', id: genItemId(), label: '' }]
    })
    setAddMenuOpen(false)
  }

  const addImage = async (): Promise<void> => {
    setAddMenuOpen(false)
    const picked = await window.api.dialog.pickFile('image')
    if (!picked) return
    patch({
      items: [...draft.items, { kind: 'image', id: genItemId(), imagePath: picked }]
    })
  }

  const addVideo = async (): Promise<void> => {
    setAddMenuOpen(false)
    const picked = await window.api.dialog.pickFile('video')
    if (!picked) return
    const title = picked.split(/[/\\]/).pop()?.replace(/\.[^.]+$/, '') ?? 'Video'
    patch({
      items: [
        ...draft.items,
        { kind: 'video', id: genItemId(), videoPath: picked, title }
      ]
    })
  }

  const addDeck = async (): Promise<void> => {
    // Pick the PDF FIRST, then probe page count, then insert — this
    // avoids creating an empty placeholder item if the user cancels the
    // picker, and guarantees pageCount is stamped before slideify ever
    // sees the item.
    setAddMenuOpen(false)
    const picked = await window.api.dialog.pickFile('pdf')
    if (!picked) return
    try {
      const pageCount = await probePdfPageCount(picked)
      const title = picked.split(/[/\\]/).pop()?.replace(/\.pdf$/i, '') ?? 'PDF deck'
      patch({
        items: [
          ...draft.items,
          {
            kind: 'deck',
            id: genItemId(),
            pdfPath: picked,
            pageCount,
            title
          }
        ]
      })
    } catch (err) {
      console.error('[SetlistEditor] failed to open PDF', picked, err)
      window.alert(
        'Could not open that PDF. Try re-exporting it from PowerPoint (File → Export → Create PDF/XPS) or Keynote (File → Export To → PDF).'
      )
    }
  }

  const addCountdown = (): void => {
    patch({
      items: [
        ...draft.items,
        {
          kind: 'countdown',
          id: genItemId(),
          label: 'Service starts in',
          targetTime: new Date(Date.now() + 15 * 60_000).toISOString()
        }
      ]
    })
    setAddMenuOpen(false)
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

  return (
    <div className="flex h-screen w-screen flex-col bg-background text-foreground">
      {/* Header */}
      <header className="flex items-center gap-4 border-b border-border/40 px-6 py-3">
        <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
          ← Home
        </Link>
        <span className="text-xs text-muted-foreground">{statusLabel[status]}</span>
        <div className="ml-auto flex items-center gap-3">
          <Link
            to={`/service/${id}`}
            className="rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:opacity-90"
          >
            Start Service →
          </Link>
          <button
            onClick={handleDelete}
            className="text-xs text-red-500 hover:underline"
          >
            Delete
          </button>
        </div>
      </header>

      {/* Metadata */}
      <section className="border-b border-border/40 px-6 py-4">
        <div className="flex gap-3">
          <label className="flex-1">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">
              Name
            </span>
            <input
              type="text"
              value={draft.name}
              onChange={(e) => patch({ name: e.target.value })}
              className="w-full rounded-md border border-border/60 bg-background px-3 py-1.5 text-sm outline-none focus:border-border"
            />
          </label>
          <label className="w-56">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">
              Date
            </span>
            <input
              type="date"
              value={draft.date}
              onChange={(e) => patch({ date: e.target.value })}
              className="w-full rounded-md border border-border/60 bg-background px-3 py-1.5 text-sm outline-none focus:border-border"
            />
          </label>
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {formatServiceDate(draft.date)} · {draft.items.length} item
          {draft.items.length === 1 ? '' : 's'}
        </div>
      </section>

      {/* Items list */}
      <main className="flex-1 overflow-y-auto px-6 py-4">
        {draft.items.length === 0 && (
          <div className="rounded-lg border border-dashed border-border/60 p-8 text-center">
            <p className="text-sm font-medium">Empty setlist</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Use the Add button below to insert songs, scripture, or dividers.
            </p>
          </div>
        )}

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={draft.items.map((i) => i.id)}
            strategy={verticalListSortingStrategy}
          >
            <ul className="flex flex-col gap-2">
              {draft.items.map((item) => (
                <li key={item.id}>
                  <SetlistItemCard
                    item={item}
                    songsById={songsById}
                    onChange={(next) => updateItem(item.id, next)}
                    onDelete={() => deleteItem(item.id)}
                  />
                </li>
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      </main>

      {/* Add menu */}
      <footer className="relative border-t border-border/40 px-6 py-3">
        <div className="relative inline-block">
          <button
            onClick={() => {
              setAddMenuOpen((v) => !v)
              setPickerOpen(false)
            }}
            className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90"
          >
            + Add Item
          </button>

          {addMenuOpen && !pickerOpen && (
            <div className="absolute bottom-full left-0 z-10 mb-1 w-64 rounded-md border border-border/60 bg-background shadow-lg">
              <MenuButton onClick={() => setPickerOpen(true)}>Song…</MenuButton>
              <MenuButton onClick={addScripture}>Scripture</MenuButton>
              <MenuButton onClick={() => void addImage()}>Image…</MenuButton>
              <MenuButton onClick={() => void addVideo()}>
                <div className="flex flex-col">
                  <span>Video…</span>
                  <span className="text-[10px] font-normal text-muted-foreground">
                    Plays with audio on the projector
                  </span>
                </div>
              </MenuButton>
              <MenuButton onClick={() => void addDeck()}>
                <div className="flex flex-col">
                  <span>PDF deck…</span>
                  <span className="text-[10px] font-normal text-muted-foreground">
                    For sermons / PowerPoint — export to PDF first
                  </span>
                </div>
              </MenuButton>
              <MenuButton onClick={addCountdown}>Countdown</MenuButton>
              <div className="my-1 border-t border-border/40" />
              <MenuButton onClick={addDivider}>
                <div className="flex flex-col">
                  <span>Section header</span>
                  <span className="text-[10px] font-normal text-muted-foreground">
                    Grouping only — not projected
                  </span>
                </div>
              </MenuButton>
            </div>
          )}

          {pickerOpen && (
            <div className="absolute bottom-full left-0 z-20 mb-1">
              <SongPicker
                songs={songs}
                onPick={addSong}
                onClose={() => {
                  setPickerOpen(false)
                  setAddMenuOpen(false)
                }}
              />
            </div>
          )}
        </div>
      </footer>
    </div>
  )
}

function MenuButton({
  onClick,
  children
}: {
  onClick: () => void
  children: React.ReactNode
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
    >
      {children}
    </button>
  )
}
