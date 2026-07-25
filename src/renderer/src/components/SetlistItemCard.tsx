/**
 * SetlistItemCard — renders one item in the setlist, per-kind.
 *
 * dnd-kit integration: this component is a sortable node. The drag
 * handle is the leading ⋮⋮ so clicking the delete button or typing
 * inside inline fields doesn't trigger a drag.
 *
 * Section dividers render as a thin group-header bar rather than a full
 * card — they're grouping-only (skipped during playback), so they
 * shouldn't visually compete with the actual items.
 *
 * Inline editing: scripture fields, countdown target, deck title — all
 * editable inline. Images and decks use the native file picker. Song
 * items show the resolved song title from the library (read-only; edit
 * the actual song in the library editor).
 */

import { useEffect, useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Setlist, SetlistItem, Song } from '@shared/types'
import { probePdfPageCount } from '../lib/pdfLoader'
import { MediaPreview } from './MediaPreview'
import { useBibleStore } from '../stores/useBibleStore'

interface SetlistItemCardProps {
  item: SetlistItem
  songsById: Map<string, Song>
  onChange: (patch: SetlistItem) => void
  onDelete: () => void
}

export function SetlistItemCard({
  item,
  songsById,
  onChange,
  onDelete
}: SetlistItemCardProps): JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1
  }

  // Section dividers get their own thin-bar treatment so they read as
  // "group header between real items" rather than "item #3".
  if (item.kind === 'section-divider') {
    return (
      <div
        ref={setNodeRef}
        style={style}
        className="flex items-center gap-2 rounded-md bg-muted/40 px-3 py-1.5"
      >
        <div
          {...attributes}
          {...listeners}
          className="cursor-grab select-none text-muted-foreground active:cursor-grabbing"
          aria-label="Drag to reorder"
        >
          ⋮⋮
        </div>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
          Section
        </span>
        <input
          type="text"
          value={item.label}
          onChange={(e) => onChange({ ...item, label: e.target.value })}
          placeholder="Welcome / Worship / Sermon / Offering"
          className="flex-1 bg-transparent text-xs font-semibold uppercase tracking-wide outline-none placeholder:normal-case placeholder:font-normal placeholder:tracking-normal placeholder:text-muted-foreground/60"
        />
        <span className="text-[10px] text-muted-foreground/60">
          grouping only · not projected
        </span>
        <button
          onClick={onDelete}
          className="text-xs text-red-500 hover:underline"
          aria-label="Delete section"
        >
          ✕
        </button>
      </div>
    )
  }

  // Which kinds get a visual thumbnail instead of a text badge?
  // Media items (image, video, PDF deck) show their preview; everything
  // else keeps the lowercase kind label for scannability.
  const previewSource = getPreviewSource(item)

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-start gap-3 rounded-lg border border-border/50 bg-card/50 p-3 transition-colors hover:border-border"
    >
      {/* Drag handle — just the leading dots */}
      <div
        {...attributes}
        {...listeners}
        className="mt-2 cursor-grab select-none text-muted-foreground/70 transition-colors hover:text-foreground active:cursor-grabbing"
        aria-label="Drag to reorder"
      >
        ⋮⋮
      </div>

      {/* Thumbnail for media items, else the kind text badge */}
      {previewSource ? (
        <MediaPreview source={previewSource} />
      ) : (
        <div className="mt-1 w-20 shrink-0 text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground/70">
          {item.kind}
        </div>
      )}

      {/* Body */}
      <div className="min-w-0 flex-1">
        <ItemBody item={item} songsById={songsById} onChange={onChange} />
      </div>

      <button
        onClick={onDelete}
        className="shrink-0 rounded p-1 text-[11px] text-muted-foreground/60 transition-colors hover:text-destructive"
        aria-label="Delete item"
      >
        Delete
      </button>
    </div>
  )
}

/**
 * Return the MediaPreview source for items that have visual content,
 * or null for items that should keep the text-kind label.
 * Items missing their path (e.g. a brand-new image item before the
 * user has picked a file) don't get a preview either.
 */
function getPreviewSource(
  item: SetlistItem
): { kind: 'image'; path: string } | { kind: 'video'; path: string } | { kind: 'deck'; pdfPath: string } | null {
  if (item.kind === 'image' && item.imagePath) {
    return { kind: 'image', path: item.imagePath }
  }
  if (item.kind === 'video' && item.videoPath) {
    return { kind: 'video', path: item.videoPath }
  }
  if (item.kind === 'deck' && item.pdfPath) {
    return { kind: 'deck', pdfPath: item.pdfPath }
  }
  return null
}

function ItemBody({
  item,
  songsById,
  onChange
}: {
  item: SetlistItem
  songsById: Map<string, Song>
  onChange: (patch: SetlistItem) => void
}): JSX.Element {
  if (item.kind === 'song') {
    const song = songsById.get(item.songId)
    return (
      <div>
        <div className="font-medium">
          {song ? song.title : '(missing song)'}
        </div>
        {song?.author && (
          <div className="text-xs text-muted-foreground">{song.author}</div>
        )}
      </div>
    )
  }

  if (item.kind === 'scripture') {
    return <ScriptureEditor item={item} onChange={onChange} />
  }

  if (item.kind === 'section-divider') {
    // Handled at the parent level with the thin-bar layout.
    return <></>
  }

  if (item.kind === 'image') {
    const handlePick = async (): Promise<void> => {
      const picked = await window.api.dialog.pickFile('image')
      if (picked) onChange({ ...item, imagePath: picked })
    }

    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <button
            onClick={handlePick}
            className="rounded-md border border-border/60 bg-background px-2.5 py-1 text-xs hover:border-border"
          >
            {item.imagePath ? 'Change image…' : 'Choose image…'}
          </button>
          {item.imagePath && (
            <span
              className="truncate text-[11px] text-muted-foreground"
              title={item.imagePath}
            >
              {displayFileName(item.imagePath)}
            </span>
          )}
        </div>
        <input
          type="text"
          value={item.caption ?? ''}
          onChange={(e) => onChange({ ...item, caption: e.target.value })}
          placeholder="Caption (optional)"
          className="w-full rounded border border-border/60 bg-background px-2 py-1 text-xs outline-none focus:border-border"
        />
      </div>
    )
  }

  if (item.kind === 'video') {
    const handlePick = async (): Promise<void> => {
      const picked = await window.api.dialog.pickFile('video')
      if (!picked) return
      onChange({
        ...item,
        videoPath: picked,
        title: item.title || defaultDeckTitle(picked)
      })
    }
    // `loop` defaults to true — undefined means "I haven't been
    // configured" which we treat as the default (continuous loop).
    const loop = item.loop ?? true

    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <button
            onClick={handlePick}
            className="rounded-md border border-border/60 bg-background px-2.5 py-1 text-xs hover:border-border"
          >
            {item.videoPath ? 'Change video…' : 'Choose video…'}
          </button>
          {item.videoPath && (
            <span
              className="truncate text-[11px] text-muted-foreground"
              title={item.videoPath}
            >
              {displayFileName(item.videoPath)}
            </span>
          )}
        </div>
        <input
          type="text"
          value={item.title ?? ''}
          onChange={(e) => onChange({ ...item, title: e.target.value })}
          placeholder="Video title (e.g. Sermon Intro — Philippians)"
          className="w-full rounded border border-border/60 bg-background px-2 py-1 text-sm outline-none focus:border-border"
        />
        <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <input
            type="checkbox"
            checked={loop}
            onChange={(e) => onChange({ ...item, loop: e.target.checked })}
            className="h-3.5 w-3.5 rounded border-border/60 bg-background"
          />
          <span>
            Loop continuously
            <span className="ml-1 text-muted-foreground/60">
              (uncheck to auto-advance when the video finishes)
            </span>
          </span>
        </label>
      </div>
    )
  }

  if (item.kind === 'deck') {
    const handlePick = async (): Promise<void> => {
      const picked = await window.api.dialog.pickFile('pdf')
      if (!picked) return
      try {
        const pageCount = await probePdfPageCount(picked)
        onChange({
          ...item,
          pdfPath: picked,
          pageCount,
          title: item.title || defaultDeckTitle(picked)
        })
      } catch (err) {
        console.error('[deck] failed to probe PDF', picked, err)
        window.alert(
          `Could not open that PDF. Try re-exporting from PowerPoint (File → Export → Create PDF/XPS).`
        )
      }
    }

    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <button
            onClick={handlePick}
            className="rounded-md border border-border/60 bg-background px-2.5 py-1 text-xs hover:border-border"
          >
            {item.pdfPath ? 'Change PDF…' : 'Choose PDF…'}
          </button>
          {item.pdfPath && (
            <>
              <span
                className="truncate text-[11px] text-muted-foreground"
                title={item.pdfPath}
              >
                {displayFileName(item.pdfPath)}
              </span>
              <span className="text-[11px] text-muted-foreground/70">
                · {item.pageCount} page{item.pageCount === 1 ? '' : 's'}
              </span>
            </>
          )}
        </div>
        <input
          type="text"
          value={item.title ?? ''}
          onChange={(e) => onChange({ ...item, title: e.target.value })}
          placeholder="Deck title (e.g. Sermon — Romans 12)"
          className="w-full rounded border border-border/60 bg-background px-2 py-1 text-sm outline-none focus:border-border"
        />
        {!item.pdfPath && (
          <p className="text-[11px] text-muted-foreground/80">
            Export your PowerPoint, Keynote, or Google Slides to PDF first,
            then pick it here. Each PDF page becomes one slide.
          </p>
        )}
      </div>
    )
  }

  if (item.kind === 'countdown') {
    // HTML datetime-local wants "YYYY-MM-DDTHH:mm" — slice the ISO.
    const localValue = item.targetTime ? item.targetTime.slice(0, 16) : ''
    return (
      <div className="flex flex-col gap-1">
        <input
          type="text"
          value={item.label}
          onChange={(e) => onChange({ ...item, label: e.target.value })}
          placeholder="Service starts in…"
          className="w-full rounded border border-border/60 bg-background px-2 py-1 text-sm outline-none focus:border-border"
        />
        <input
          type="datetime-local"
          value={localValue}
          onChange={(e) =>
            onChange({ ...item, targetTime: new Date(e.target.value).toISOString() })
          }
          className="w-full rounded border border-border/60 bg-background px-2 py-1 text-sm outline-none focus:border-border"
        />
      </div>
    )
  }

  if (item.kind === 'pptx') {
    // No file picker here yet — picking a .pptx needs to probe the file
    // for its visible slide count (probeVisibleSlideCount, built on top
    // of @shared/pptxSlides), which is a later task's job. Task 3 only
    // adds the data model + slideify fan-out, so this shows the item's
    // current data honestly rather than faking a working picker.
    return (
      <div className="flex flex-col gap-1.5">
        <div className="text-[11px] text-muted-foreground">
          {item.pptxPath
            ? `${displayFileName(item.pptxPath)} · ${item.slideCount} slide${item.slideCount === 1 ? '' : 's'}`
            : 'No PowerPoint file selected yet'}
        </div>
        <input
          type="text"
          value={item.title ?? ''}
          onChange={(e) => onChange({ ...item, title: e.target.value })}
          placeholder="PowerPoint title (optional)"
          className="w-full rounded border border-border/60 bg-background px-2 py-1 text-sm outline-none focus:border-border"
        />
      </div>
    )
  }

  // Exhaustiveness check — if you add a new SetlistItem kind and forget
  // to add a branch above, TypeScript complains here.
  const _exhaustive: never = item
  return <div>{_exhaustive}</div>
}

function displayFileName(path: string): string {
  const parts = path.split(/[/\\]/)
  return parts[parts.length - 1] || path
}

function defaultDeckTitle(path: string): string {
  const base = displayFileName(path)
  return base.replace(/\.pdf$/i, '')
}

// ─── Scripture editor ────────────────────────────────────────────────
//
// Pulled out into its own component so the bibleStore subscription +
// lookup loading state don't pollute the (otherwise pure) ItemBody
// switch. Mounting this once per scripture item in the setlist is
// fine — the underlying useBibleStore is module-level and shared
// across instances, so the translation list is fetched at most once.

interface ScriptureItem {
  kind: 'scripture'
  id: string
  reference: string
  text: string
  translation: string
}

function ScriptureEditor({
  item,
  onChange
}: {
  item: ScriptureItem
  onChange: (next: ScriptureItem) => void
}): JSX.Element {
  const { translations, loading: translationsLoading, loadTranslations } =
    useBibleStore()
  const [lookupBusy, setLookupBusy] = useState(false)
  const [lookupError, setLookupError] = useState<string | null>(null)

  // Lazy-load the translation list the first time any scripture item
  // mounts. Idempotent inside the store.
  useEffect(() => {
    void loadTranslations()
  }, [loadTranslations])

  // Default to ENGWEBP (World English Bible) if the operator hasn't
  // chosen a translation yet AND the catalog has loaded. Picking a
  // sensible default matters more than picking the "right" one — they
  // can swap from the dropdown.
  useEffect(() => {
    if (item.translation || translations.length === 0) return
    const fallback =
      translations.find((t) => t.id === 'ENGWEBP') ??
      translations.find((t) => t.language === 'eng') ??
      translations[0]
    if (fallback) onChange({ ...item, translation: fallback.id })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [translations.length, item.translation])

  const handleLookup = async (): Promise<void> => {
    if (!item.reference.trim() || !item.translation) return
    setLookupBusy(true)
    setLookupError(null)
    try {
      const result = await window.api.bible.lookup(
        item.translation,
        item.reference
      )
      if (result.ok) {
        onChange({ ...item, text: result.text })
      } else {
        setLookupError(result.error)
      }
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : 'Lookup failed')
    } finally {
      setLookupBusy(false)
    }
  }

  // Allow Enter inside the reference input to trigger lookup — common
  // operator pattern, matches Google Search-style behavior.
  const handleReferenceKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>
  ): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      void handleLookup()
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-stretch gap-2">
        <input
          type="text"
          value={item.reference}
          onChange={(e) => onChange({ ...item, reference: e.target.value })}
          onKeyDown={handleReferenceKeyDown}
          placeholder="John 3:16  or  Romans 12:1-3"
          className="flex-1 rounded border border-border/60 bg-background px-2 py-1 text-sm outline-none focus:border-brand/40"
        />
        <select
          value={item.translation}
          onChange={(e) => onChange({ ...item, translation: e.target.value })}
          disabled={translationsLoading || translations.length === 0}
          title={
            translationsLoading
              ? 'Loading translations…'
              : 'Pick a Bible translation'
          }
          className="w-32 rounded border border-border/60 bg-background px-1 text-xs outline-none focus:border-brand/40 disabled:opacity-50"
        >
          {translations.length === 0 ? (
            <option value="">
              {translationsLoading ? 'Loading…' : 'No translations'}
            </option>
          ) : (
            translations.map((t) => (
              <option key={t.id} value={t.id}>
                {t.shortName} · {t.languageEnglishName ?? t.language}
              </option>
            ))
          )}
        </select>
        <button
          onClick={() => void handleLookup()}
          disabled={lookupBusy || !item.reference.trim() || !item.translation}
          className="rounded border border-brand/40 bg-brand/10 px-3 text-xs font-semibold uppercase tracking-wider text-brand hover:bg-brand/20 disabled:opacity-40"
          title="Look up this reference (Enter)"
        >
          {lookupBusy ? '…' : 'Lookup'}
        </button>
      </div>
      {lookupError && (
        <p className="text-[11px] text-destructive">{lookupError}</p>
      )}
      <textarea
        value={item.text}
        onChange={(e) => onChange({ ...item, text: e.target.value })}
        placeholder="Verse text — fill via Lookup or paste manually"
        className="min-h-[60px] w-full rounded border border-border/60 bg-background px-2 py-1 text-sm outline-none focus:border-brand/40"
      />
    </div>
  )
}

// Re-export for SetlistEditor to import one thing
export type { Setlist }
