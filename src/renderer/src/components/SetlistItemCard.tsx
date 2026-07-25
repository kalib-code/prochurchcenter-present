/**
 * SetlistItemCard — renders one item in the setlist, per-kind.
 *
 * dnd-kit integration: this component is a sortable node. The drag
 * handle is the leading ⠿ glyph so clicking the delete button or typing
 * inside inline fields doesn't trigger a drag.
 *
 * Section dividers render as a thin group-header bar rather than a full
 * card — they're grouping-only (skipped during playback AND excluded
 * from the running clock), so they shouldn't visually compete with the
 * actual items.
 *
 * Inline editing: scripture fields, countdown target, deck title — all
 * editable inline. Images and decks use the native file picker. Song
 * items show the resolved song title from the library (read-only; edit
 * the actual song in the library editor).
 *
 * Timing: the leading rail shows this item's computed clock time (from
 * `computeSchedule`, passed down as `at`); the trailing rail holds the
 * per-item duration-in-minutes input that feeds that computation.
 *
 * Media-missing: when the parent's `useMediaCheck` flags this item, a
 * signal-bordered banner offers RELINK, which reopens the native picker
 * (filtered to the right kind via `relinkKindOf`) and writes the result
 * back onto the item — re-probing the page count for decks, since the
 * replacement PDF may have a different length than the one that was
 * removed.
 */

import { useEffect, useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { SetlistItem, Song } from '@shared/types'
import { relinkKindOf } from '@shared/setlist-media'
import { probePdfPageCount } from '../lib/pdfLoader'
import { MediaPreview } from './MediaPreview'
import { useBibleStore } from '../stores/useBibleStore'
import { itemKindCode } from './ItemKindIcon'
import { Badge } from './ui/Badge'
import { MonoLabel } from './ui/MonoLabel'
import { Button } from './ui/Button'

interface SetlistItemCardProps {
  item: SetlistItem
  songsById: Map<string, Song>
  /** This item's computed clock time, e.g. "10:07" — computeSchedule().at[i]. */
  at: string
  /** True when useMediaCheck flags this item's file as missing on disk. */
  missing: boolean
  density: 'detail' | 'compact'
  onChange: (patch: SetlistItem) => void
  onDelete: () => void
  onDuplicate: () => void
}

export function SetlistItemCard({
  item,
  songsById,
  at,
  missing,
  density,
  onChange,
  onDelete,
  onDuplicate
}: SetlistItemCardProps): JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1
  }

  // Section dividers get their own thin-bar treatment so they read as
  // "group header between real items" rather than "item #3". They never
  // reach the projector and always contribute 0 to the running clock
  // (enforced in computeSchedule), so they carry no duration/time UI.
  if (item.kind === 'section-divider') {
    return (
      <div
        ref={setNodeRef}
        style={style}
        className="flex items-center gap-3 border-l-2 border-signal bg-panel-hi px-3.5 py-2.5"
      >
        <div
          {...attributes}
          {...listeners}
          className="cursor-grab select-none font-mono text-[12px] text-dim active:cursor-grabbing"
          aria-label="Drag to reorder"
        >
          ⠿
        </div>
        <MonoLabel tone="signal">SECTION</MonoLabel>
        <input
          type="text"
          value={item.label}
          onChange={(e) => onChange({ ...item, label: e.target.value })}
          placeholder="Welcome / Worship / Sermon / Offering"
          className="flex-1 bg-transparent font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-bone outline-none placeholder:normal-case placeholder:font-normal placeholder:tracking-normal placeholder:text-muted-foreground/60"
        />
        <span className="whitespace-nowrap font-mono text-[10px] tracking-[0.06em] text-dim">
          GROUPING ONLY · NOT PROJECTED
        </span>
        <button
          type="button"
          onClick={onDelete}
          className="font-mono text-[12px] text-dim hover:text-signal-deep"
          aria-label="Delete section"
        >
          ✕
        </button>
      </div>
    )
  }

  // Which kinds get a visual thumbnail instead of a flat kind-code box?
  // Media items (image, video, PDF deck) show their real preview once a
  // file is chosen; everything else — and media items before a file has
  // been picked — falls back to the flat code box.
  const previewSource = getPreviewSource(item)
  const relinkKind = relinkKindOf(item)

  const handleRelink = async (): Promise<void> => {
    if (!relinkKind) return
    const picked = await window.api.dialog.pickFile(relinkKind)
    if (!picked) return
    if (item.kind === 'image') {
      onChange({ ...item, imagePath: picked })
      return
    }
    if (item.kind === 'video') {
      onChange({ ...item, videoPath: picked })
      return
    }
    if (item.kind === 'deck') {
      // The replacement PDF may have a different page count than the
      // one that went missing — re-probe rather than trust the stale
      // value, or the deck would render the wrong number of slides.
      try {
        const pageCount = await probePdfPageCount(picked)
        onChange({ ...item, pdfPath: picked, pageCount })
      } catch (err) {
        console.error('[relink] failed to probe PDF', picked, err)
        window.alert(
          'Could not open that PDF. Try re-exporting it from PowerPoint (File → Export → Create PDF/XPS) or Keynote (File → Export To → PDF).'
        )
      }
    }
  }

  const title = rowTitle(item, songsById)
  const sourceLine = sourceLineFor(item, songsById)
  const slideCount = slideCountLabel(item, songsById)
  const detail = density === 'detail'

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={
        'flex items-center gap-4 border border-border bg-card transition-colors hover:border-dim ' +
        (detail ? 'p-3.5' : 'py-2.5 px-3.5')
      }
    >
      {/* Leading rail: computed clock time above the drag handle. */}
      <div className="flex w-[52px] flex-none flex-col items-center justify-center gap-[5px]">
        <span className="font-mono text-[11px] font-semibold text-bone">{at}</span>
        <div
          {...attributes}
          {...listeners}
          className="cursor-grab select-none font-mono text-[12px] text-dim transition-colors hover:text-soft active:cursor-grabbing"
          aria-label="Drag to reorder"
        >
          ⠿
        </div>
      </div>

      {/* Thumbnail — detail mode only. */}
      {detail &&
        (previewSource ? (
          <MediaPreview source={previewSource} className="h-[60px] w-[104px]" />
        ) : (
          <div className="flex h-[60px] w-[104px] flex-none items-center justify-center border border-border bg-black font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-dim">
            {itemKindCode(item.kind)}
          </div>
        ))}

      {/* Body */}
      <div className="min-w-0 flex-1">
        <div className="mb-2 flex items-center gap-2.5">
          <Badge tone="signal" className="flex-none">
            {itemKindCode(item.kind)}
          </Badge>
          {detail && sourceLine && (
            <span className="truncate font-mono text-[11.5px] text-muted-foreground">
              {sourceLine}
            </span>
          )}
          {!detail && (
            <>
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">
                {title}
              </span>
              {slideCount && (
                <span className="flex-none font-mono text-[9px] font-medium tracking-[0.08em] text-dim">
                  {slideCount}
                </span>
              )}
            </>
          )}
        </div>

        {detail && <ItemBody item={item} songsById={songsById} onChange={onChange} />}

        {detail && missing && relinkKind && (
          <div className="mt-2.5 flex items-center gap-2.5 border border-signal/50 bg-signal/[0.08] px-[11px] py-2">
            <MonoLabel tone="signal" className="flex-none">
              MEDIA MISSING
            </MonoLabel>
            <span className="flex-1 text-[11.5px] text-bone">
              The file moved since you added it. This item will be skipped in service.
            </span>
            <Button
              variant="outline"
              size="sm"
              className="flex-none border-signal text-signal hover:border-signal hover:bg-signal hover:text-white"
              onClick={() => void handleRelink()}
            >
              RELINK
            </Button>
          </div>
        )}
      </div>

      {/* Trailing rail: duration + duplicate/delete. */}
      <div className="flex w-[112px] flex-none flex-col items-end gap-2">
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            value={item.durationMinutes ?? ''}
            onChange={(e) => {
              const raw = e.target.value
              if (raw === '') {
                onChange({ ...item, durationMinutes: undefined })
                return
              }
              const n = Number(raw)
              if (!Number.isFinite(n)) return
              onChange({ ...item, durationMinutes: Math.max(0, Math.floor(n)) })
            }}
            aria-label="Duration in minutes"
            className="w-[52px] border border-border bg-background px-[7px] py-1.5 text-center font-mono text-[11px] text-bone outline-none focus:border-signal/60"
          />
          <MonoLabel size="xs" tone="dim">
            MIN
          </MonoLabel>
        </div>
        <div className="flex gap-2.5">
          <button
            type="button"
            onClick={onDuplicate}
            className="font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-dim hover:text-white"
          >
            DUPLICATE
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-dim hover:text-signal-deep"
          >
            DELETE
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Return the MediaPreview source for items that have visual content,
 * or null for items that should keep the flat kind-code box.
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

/** Compact-mode single-line title, and the detail-mode fallback label. */
function rowTitle(item: SetlistItem, songsById: Map<string, Song>): string {
  switch (item.kind) {
    case 'song': {
      const song = songsById.get(item.songId)
      return song ? song.title : '(missing song)'
    }
    case 'scripture':
      return item.reference.trim() || 'Scripture'
    case 'image':
      return item.caption?.trim() || 'Image'
    case 'video':
      return item.title?.trim() || 'Video'
    case 'deck':
      return item.title?.trim() || 'PDF deck'
    case 'countdown':
      return item.label.trim() || 'Countdown'
    case 'section-divider':
      return item.label.trim() || 'Section'
  }
}

/**
 * The small mono "byline" shown next to the kind badge in detail mode —
 * the source filename for media items, or the closest analogous detail
 * for everything else. Null means "nothing to show here".
 */
function sourceLineFor(item: SetlistItem, songsById: Map<string, Song>): string | null {
  switch (item.kind) {
    case 'image':
      return item.imagePath ? displayFileName(item.imagePath) : null
    case 'video':
      return item.videoPath ? displayFileName(item.videoPath) : null
    case 'deck':
      return item.pdfPath
        ? `${displayFileName(item.pdfPath)} · ${item.pageCount} page${item.pageCount === 1 ? '' : 's'}`
        : null
    case 'song': {
      const song = songsById.get(item.songId)
      return song?.author?.trim() || null
    }
    case 'scripture':
      return item.translation || null
    case 'countdown':
    case 'section-divider':
      return null
  }
}

/** Compact-mode slide-count readout, or null when a kind has none. */
function slideCountLabel(item: SetlistItem, songsById: Map<string, Song>): string | null {
  switch (item.kind) {
    case 'song': {
      const song = songsById.get(item.songId)
      if (!song) return null
      const n = song.sections.reduce((sum, s) => sum + s.slides.length, 0)
      return `${n} SLIDE${n === 1 ? '' : 'S'}`
    }
    case 'deck':
      return `${item.pageCount} SLIDE${item.pageCount === 1 ? '' : 'S'}`
    case 'scripture': {
      const text = item.text.trim()
      if (!text) return null
      const n = text.split(/\n\s*\n/).filter((b) => b.trim()).length
      return n > 0 ? `${n} SLIDE${n === 1 ? '' : 'S'}` : null
    }
    case 'image':
    case 'video':
    case 'countdown':
      return '1 SLIDE'
    case 'section-divider':
      return null
  }
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
        <div className="text-[13.5px] font-medium text-foreground">
          {song ? song.title : '(missing song)'}
        </div>
        {song?.author && (
          <div className="text-[11.5px] text-muted-foreground">{song.author}</div>
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
        <button
          type="button"
          onClick={() => void handlePick()}
          className="w-fit border border-border bg-background px-2.5 py-1 text-[11px] text-soft hover:border-dim"
        >
          {item.imagePath ? 'Change image…' : 'Choose image…'}
        </button>
        <input
          type="text"
          value={item.caption ?? ''}
          onChange={(e) => onChange({ ...item, caption: e.target.value })}
          placeholder="Caption (optional)"
          className="w-full border border-border bg-background px-2 py-1.5 text-[13.5px] text-foreground outline-none focus:border-signal/50"
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
        <button
          type="button"
          onClick={() => void handlePick()}
          className="w-fit border border-border bg-background px-2.5 py-1 text-[11px] text-soft hover:border-dim"
        >
          {item.videoPath ? 'Change video…' : 'Choose video…'}
        </button>
        <input
          type="text"
          value={item.title ?? ''}
          onChange={(e) => onChange({ ...item, title: e.target.value })}
          placeholder="Video title (e.g. Sermon Intro — Philippians)"
          className="w-full border border-border bg-background px-2 py-1.5 text-[13.5px] text-foreground outline-none focus:border-signal/50"
        />
        <label className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
          <input
            type="checkbox"
            checked={loop}
            onChange={(e) => onChange({ ...item, loop: e.target.checked })}
            className="h-3.5 w-3.5 border-border bg-background accent-signal"
          />
          <span>
            Loop continuously
            <span className="ml-1 text-muted-foreground/70">
              — uncheck to auto-advance when the video finishes
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
        <button
          type="button"
          onClick={() => void handlePick()}
          className="w-fit border border-border bg-background px-2.5 py-1 text-[11px] text-soft hover:border-dim"
        >
          {item.pdfPath ? 'Change PDF…' : 'Choose PDF…'}
        </button>
        <input
          type="text"
          value={item.title ?? ''}
          onChange={(e) => onChange({ ...item, title: e.target.value })}
          placeholder="Deck title (e.g. Sermon — Romans 12)"
          className="w-full border border-border bg-background px-2 py-1.5 text-[13.5px] text-foreground outline-none focus:border-signal/50"
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
      <div className="flex flex-col gap-1.5">
        <input
          type="text"
          value={item.label}
          onChange={(e) => onChange({ ...item, label: e.target.value })}
          placeholder="Service starts in…"
          className="w-full border border-border bg-background px-2 py-1.5 text-[13.5px] text-foreground outline-none focus:border-signal/50"
        />
        <input
          type="datetime-local"
          value={localValue}
          onChange={(e) =>
            onChange({ ...item, targetTime: new Date(e.target.value).toISOString() })
          }
          className="w-full border border-border bg-background px-2 py-1.5 text-[13px] text-foreground outline-none focus:border-signal/50 [color-scheme:dark]"
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
  return base.replace(/\.pdf$/i, '').replace(/\.[^.]+$/, '')
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
          className="flex-1 border border-border bg-background px-2 py-1.5 text-[13.5px] text-foreground outline-none focus:border-signal/50"
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
          className="w-32 border border-border bg-background px-1 text-[11px] text-foreground outline-none focus:border-signal/50 disabled:opacity-50"
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
          type="button"
          onClick={() => void handleLookup()}
          disabled={lookupBusy || !item.reference.trim() || !item.translation}
          className="border border-signal/40 bg-signal/10 px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-signal hover:bg-signal/20 disabled:opacity-40"
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
        className="min-h-[60px] w-full border border-border bg-background px-2 py-1.5 text-[13.5px] text-foreground outline-none focus:border-signal/50"
      />
    </div>
  )
}
