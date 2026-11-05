/**
 * SetlistItemCard — renders one row of the run of show, per-kind.
 *
 * Layout (2026-11 redesign): a rounded row on the panel —
 *   time · drag handle (hover) · 16:9 thumbnail · title + kind badge +
 *   meta · hover-revealed duplicate/delete · minutes field.
 * In Detail density the per-kind editing fields sit under the title line;
 * Compact density shows the title line only.
 *
 * dnd-kit integration: this component is a sortable node. The drag
 * handle is the grip next to the time, so clicking the delete button or
 * typing inside inline fields doesn't trigger a drag. The handle is
 * hidden until the row is hovered but stays keyboard-focusable.
 *
 * Section dividers render as a labelled divider line rather than a row —
 * they're grouping-only (skipped during playback AND excluded from the
 * running clock), so they shouldn't visually compete with the actual
 * items.
 *
 * Inline editing: scripture fields, countdown target, deck/pptx title — all
 * editable inline. Images, decks, and pptx items use the native file
 * picker. Song items show the resolved song title from the library
 * (read-only; edit the actual song in the library editor).
 *
 * Timing: the leading column shows this item's computed clock time (from
 * `computeSchedule`, passed down as `at`); the trailing minutes field
 * feeds that computation.
 *
 * Media-missing: when the parent's `useMediaCheck` flags this item, an
 * amber banner offers Relink, which reopens the native picker (filtered
 * to the right kind via `relinkKindOf`) and writes the result back onto
 * the item — re-probing the page count for decks, since the replacement
 * PDF may have a different length than the one that was removed.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { CanvaOrigin, SetlistItem, Song } from '@shared/types'
import { FEATURES } from '@shared/features'
import { relinkKindOf } from '@shared/setlist-media'
import { evictPdfDocument, probePdfPageCount } from '../lib/pdfLoader'
import { evictPptxDeck, probeVisibleSlideCount } from '../lib/pptxLoader'
import { MediaPreview } from './MediaPreview'
import { useBibleStore } from '../stores/useBibleStore'
import { useCanvaStore } from '../stores/useCanvaStore'
import { ItemKindIcon, itemKindLabel } from './ItemKindIcon'
import { cn } from '../lib/utils'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { Input, Select, Textarea } from './ui/Input'
import { AlertIcon, CopyIcon, LinkChainIcon, TrashIcon } from './icons'
import { DragHandle, IconButton, InlineLabel, InlineTextInput, ItemWarning } from './setlist/parts'
import { isoToLocalInput, localInputToIso } from '../lib/datetimeLocal'
import { packScripture } from '../lib/scriptureSlides'
import { useSettingsStore } from '../stores/useSettingsStore'
import { useLibraryStore } from '../stores/useLibraryStore'

/**
 * The most recently rendered value, readable after an `await`. Async
 * handlers below (file pickers, PDF probes, Canva refresh, Bible lookup)
 * must build their onChange payload from THIS, not from the `item` their
 * closure captured — otherwise any edit made to the same item while the
 * await was in flight (e.g. typing a title during a Canva refresh) is
 * reverted when the handler writes the stale copy back.
 */
function useLatest<T>(value: T): { readonly current: T } {
  const ref = useRef(value)
  ref.current = value
  return ref
}

/** Renders the row's title line around the given title node. */
type HeadRenderer = (title: ReactNode) => JSX.Element

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
  /** Design ids the staleness check found newer in Canva than what was
   * imported. Only meaningful for deck items carrying a `canva` origin —
   * everything else ignores it. */
  staleDesignIds?: string[]
}

export function SetlistItemCard({
  item,
  songsById,
  at,
  missing,
  density,
  onChange,
  onDelete,
  onDuplicate,
  staleDesignIds
}: SetlistItemCardProps): JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id })
  const latest = useLatest(item)
  // Hooks stay above the section-divider early return (rules of hooks).
  // Same max-lines setting the live slides use, so the badge matches the service.
  const maxLines = useSettingsStore((st) => st.settings?.maxLinesPerSlide ?? 4)
  const libraryLoaded = useLibraryStore((st) => st.loaded)

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1
  }

  // Section dividers get a labelled divider line so they read as "group
  // header between real items" rather than "item #3". They never reach
  // the projector and always contribute 0 to the running clock (enforced
  // in computeSchedule), so they carry no duration/time UI.
  if (item.kind === 'section-divider') {
    return (
      <div
        ref={setNodeRef}
        style={style}
        className={cn(
          'group relative flex items-center gap-3 rounded-lg px-3 pb-1 pt-4',
          isDragging && 'z-10 bg-raised'
        )}
      >
        {/* Empty time column keeps the label aligned with row thumbnails. */}
        <span className="w-11 flex-none" aria-hidden="true" />
        <DragHandle {...attributes} {...listeners} />
        <InlineTextInput
          value={item.label}
          onChange={(e) => onChange({ ...item, label: e.target.value })}
          placeholder="Section name, e.g. Worship"
          aria-label="Section name"
          className="h-7 text-[13px] font-semibold text-quiet"
        />
        <span aria-hidden="true" className="h-px min-w-8 flex-1 bg-border" />
        <span className="flex-none text-[12px] text-muted-foreground">Not projected</span>
        <IconButton
          label="Delete section"
          tone="danger"
          onClick={onDelete}
          className="h-7 w-7 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
        >
          <TrashIcon size={15} />
        </IconButton>
      </div>
    )
  }

  // Which kinds get a visual thumbnail instead of a kind glyph?
  // Media items (image, video, PDF deck, PowerPoint) show their real
  // preview once a file is chosen; everything else — and media items
  // before a file has been picked — falls back to the kind glyph.
  const previewSource = getPreviewSource(item)
  const relinkKind = relinkKindOf(item)

  const handleRelink = async (): Promise<void> => {
    if (!relinkKind) return
    const picked = await window.api.dialog.pickFile(relinkKind)
    if (!picked) return
    const cur = latest.current
    if (cur.kind === 'image') {
      onChange({ ...cur, imagePath: picked })
      return
    }
    if (cur.kind === 'video') {
      onChange({ ...cur, videoPath: picked })
      return
    }
    if (cur.kind === 'deck') {
      // The replacement PDF may have a different page count than the
      // one that went missing — re-probe rather than trust the stale
      // value, or the deck would render the wrong number of slides.
      try {
        const pageCount = await probePdfPageCount(picked)
        const now = latest.current
        if (now.kind === 'deck') onChange({ ...now, pdfPath: picked, pageCount })
      } catch (err) {
        console.error('[relink] failed to probe PDF', picked, err)
        window.alert(
          'Could not open that PDF. Try re-exporting it from PowerPoint (File → Export → Create PDF/XPS) or Keynote (File → Export To → PDF).'
        )
      }
    }
  }

  const title = rowTitle(item, songsById)
  const slideCount = slideCountLabel(item, songsById, maxLines)
  const detail = density === 'detail'
  // Compact rows have no room for the full media-missing banner (that's
  // the whole point of Compact density), but the count in the header is
  // unactionable on its own — there's no Relink and no per-row marker to
  // tell WHICH row it's talking about. An amber ring + a small Badge keeps
  // the affected row findable without spending the vertical space a full
  // banner needs.
  const compactMissing = !detail && missing && Boolean(relinkKind)
  // A song item whose library entry is gone (deleted song): slideify
  // silently drops it, so flag it loudly here instead. Only once the
  // library has loaded — before that every song is a by-id miss.
  const songMissing =
    item.kind === 'song' && libraryLoaded && !songsById.has(item.songId)
  const flagged = compactMissing || songMissing

  const meta = detail ? detailMetaFor(item, songsById, slideCount) : slideCount
  const metaTitle = mediaPathOf(item)

  const head: HeadRenderer = (titleNode) => (
    <div className="flex min-h-8 min-w-0 items-center gap-2.5">
      {titleNode}
      <Badge className="flex-none">{itemKindLabel(item.kind)}</Badge>
      {meta && (
        <span
          className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground"
          title={metaTitle ?? undefined}
        >
          {meta}
        </span>
      )}
      {!detail && flagged && (
        <Badge tone="warn" className="ml-auto flex-none">
          <AlertIcon size={12} />
          Missing
        </Badge>
      )}
    </div>
  )

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group relative flex gap-3 rounded-lg px-3 transition-colors',
        detail ? 'items-start py-3' : 'items-center py-1.5',
        flagged ? 'ring-1 ring-inset ring-warn/30' : '',
        isDragging
          ? 'z-10 bg-hover shadow-xl shadow-black/40'
          : 'bg-raised/50 hover:bg-raised focus-within:bg-raised'
      )}
    >
      {/* Leading: computed clock time, then the drag handle. */}
      <span className="flex h-8 w-11 flex-none items-center justify-end text-[13px] tabular-nums text-muted-foreground">
        {at}
      </span>
      <DragHandle {...attributes} {...listeners} />

      {/* Thumbnail — detail mode only. */}
      {detail &&
        (previewSource ? (
          <MediaPreview
            source={previewSource}
            className="h-[63px] w-[112px] rounded-lg border-0 bg-black"
          />
        ) : (
          <div className="flex h-[63px] w-[112px] flex-none items-center justify-center rounded-lg bg-app text-muted-foreground">
            <ItemKindIcon kind={item.kind} size={22} />
          </div>
        ))}

      {/* Body */}
      <div className="min-w-0 flex-1">
        {detail ? (
          <ItemBody
            item={item}
            songsById={songsById}
            onChange={onChange}
            staleDesignIds={staleDesignIds}
            head={head}
          />
        ) : (
          head(
            <span
              className={cn(
                'min-w-0 shrink truncate text-[14px] font-medium',
                songMissing ? 'text-warn' : 'text-foreground'
              )}
            >
              {title}
            </span>
          )
        )}

        {detail && songMissing && (
          <ItemWarning title="Song missing">
            This song was deleted from the library and will be skipped in service. Remove it or
            add the song again.
          </ItemWarning>
        )}

        {detail && missing && relinkKind && (
          <ItemWarning
            title="Media missing"
            action={
              <Button
                variant="secondary"
                size="sm"
                className="flex-none"
                onClick={() => void handleRelink()}
              >
                <LinkChainIcon size={14} />
                Relink
              </Button>
            }
          >
            The file moved since you added it, so this item will be skipped in service.
          </ItemWarning>
        )}
      </div>

      {/* Trailing: hover-revealed duplicate/delete, then the duration. */}
      <div className="flex h-8 flex-none items-center gap-0.5">
        <div className="flex items-center opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
          <IconButton label="Duplicate item" onClick={onDuplicate}>
            <CopyIcon size={16} />
          </IconButton>
          <IconButton label="Delete item" tone="danger" onClick={onDelete}>
            <TrashIcon size={16} />
          </IconButton>
        </div>
        <label className="ml-2 flex items-center gap-1.5">
          <Input
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
            placeholder="0"
            className="h-8 w-12 px-1.5 text-center text-[13px] tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <span className="text-[13px] text-muted-foreground">min</span>
        </label>
      </div>
    </div>
  )
}

/**
 * Return the MediaPreview source for items that have visual content,
 * or null for items that should keep the kind glyph.
 * Items missing their path (e.g. a brand-new image item before the
 * user has picked a file) don't get a preview either.
 */
function getPreviewSource(
  item: SetlistItem
):
  | { kind: 'image'; path: string }
  | { kind: 'video'; path: string }
  | { kind: 'deck'; pdfPath: string }
  | { kind: 'pptx'; pptxPath: string; slideOrdinal: number }
  | null {
  if (item.kind === 'image' && item.imagePath) {
    return { kind: 'image', path: item.imagePath }
  }
  if (item.kind === 'video' && item.videoPath) {
    return { kind: 'video', path: item.videoPath }
  }
  if (item.kind === 'deck' && item.pdfPath) {
    return { kind: 'deck', pdfPath: item.pdfPath }
  }
  if (item.kind === 'pptx' && item.pptxPath) {
    // Ordinal 1 — first visible slide, same "cover thumbnail" convention
    // as the deck case defaulting to PDF page 1.
    return { kind: 'pptx', pptxPath: item.pptxPath, slideOrdinal: 1 }
  }
  return null
}

/** Compact-mode single-line title. */
function rowTitle(item: SetlistItem, songsById: Map<string, Song>): string {
  switch (item.kind) {
    case 'song': {
      const song = songsById.get(item.songId)
      return song ? song.title : 'Missing song'
    }
    case 'scripture':
      return item.reference.trim() || 'Scripture'
    case 'image':
      return item.caption?.trim() || 'Image'
    case 'video':
      return item.title?.trim() || 'Video'
    case 'deck':
      return item.title?.trim() || 'PDF deck'
    case 'pptx':
      return item.title?.trim() || 'PowerPoint'
    case 'countdown':
      return item.label.trim() || 'Countdown'
    case 'section-divider':
      return item.label.trim() || 'Section'
  }
}

/** Full path of the item's backing file, for the meta line's tooltip. */
function mediaPathOf(item: SetlistItem): string | null {
  switch (item.kind) {
    case 'image':
      return item.imagePath || null
    case 'video':
      return item.videoPath || null
    case 'deck':
      return item.pdfPath || null
    case 'pptx':
      return item.pptxPath || null
    default:
      return null
  }
}

/**
 * The muted meta shown after the kind badge in detail mode — the source
 * filename for media items, or the closest analogous detail for
 * everything else. Null means "nothing to show here".
 */
function detailMetaFor(
  item: SetlistItem,
  songsById: Map<string, Song>,
  slideCount: string | null
): string | null {
  switch (item.kind) {
    case 'image':
      return item.imagePath ? displayFileName(item.imagePath) : null
    case 'video':
      return item.videoPath ? displayFileName(item.videoPath) : null
    case 'deck':
      return item.pdfPath
        ? `${displayFileName(item.pdfPath)} · ${item.pageCount} page${item.pageCount === 1 ? '' : 's'}`
        : null
    case 'pptx':
      // "slides", not "pages" — slideCount counts VISIBLE slides only,
      // matching how PowerPoint itself presents the deck.
      return item.pptxPath
        ? `${displayFileName(item.pptxPath)} · ${item.slideCount} slide${item.slideCount === 1 ? '' : 's'}`
        : null
    case 'song': {
      const author = songsById.get(item.songId)?.author?.trim()
      return [author, slideCount].filter(Boolean).join(' · ') || null
    }
    case 'scripture':
      return slideCount
    case 'countdown':
    case 'section-divider':
      return null
  }
}

/** Slide-count readout ("5 slides"), or null when a kind has none. */
function slideCountLabel(
  item: SetlistItem,
  songsById: Map<string, Song>,
  maxLines: number
): string | null {
  const plural = (n: number): string => `${n} slide${n === 1 ? '' : 's'}`
  switch (item.kind) {
    case 'song': {
      const song = songsById.get(item.songId)
      if (!song) return null
      return plural(song.sections.reduce((sum, s) => sum + s.slides.length, 0))
    }
    case 'deck':
      return plural(item.pageCount)
    case 'pptx':
      return plural(item.slideCount)
    case 'scripture': {
      const text = item.text.trim()
      if (!text) return null
      // Must match slideify's scripture packing, or the badge says
      // "1 slide" for a chapter the service splits across many.
      const n = packScripture(text, maxLines).length
      return n > 0 ? plural(n) : null
    }
    case 'image':
    case 'video':
    case 'countdown':
      return '1 slide'
    case 'section-divider':
      return null
  }
}

/** One row of secondary controls under the title line. */
function FieldRow({ children }: { children: ReactNode }): JSX.Element {
  return <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">{children}</div>
}

function Hint({ children }: { children: ReactNode }): JSX.Element {
  return <p className="mt-1.5 text-[13px] text-muted-foreground">{children}</p>
}

function ItemBody({
  item,
  songsById,
  onChange,
  staleDesignIds,
  head
}: {
  item: SetlistItem
  songsById: Map<string, Song>
  onChange: (patch: SetlistItem) => void
  staleDesignIds?: string[]
  head: HeadRenderer
}): JSX.Element {
  const latest = useLatest(item)

  if (item.kind === 'song') {
    const song = songsById.get(item.songId)
    return head(
      <span
        className={cn(
          'min-w-0 shrink truncate text-[14px] font-medium',
          song ? 'text-foreground' : 'text-warn'
        )}
      >
        {song ? song.title : 'Missing song'}
      </span>
    )
  }

  if (item.kind === 'scripture') {
    return <ScriptureEditor item={item} onChange={onChange} head={head} />
  }

  if (item.kind === 'section-divider') {
    // Handled at the parent level with the divider-line layout.
    return <></>
  }

  if (item.kind === 'image') {
    const handlePick = async (): Promise<void> => {
      const picked = await window.api.dialog.pickFile('image')
      const cur = latest.current
      if (picked && cur.kind === 'image') onChange({ ...cur, imagePath: picked })
    }

    return (
      <div>
        {head(
          <InlineTextInput
            value={item.caption ?? ''}
            onChange={(e) => onChange({ ...item, caption: e.target.value })}
            placeholder="Caption (optional)"
            aria-label="Image caption"
          />
        )}
        <FieldRow>
          <Button variant="secondary" size="sm" onClick={() => void handlePick()}>
            {item.imagePath ? 'Change image…' : 'Choose image…'}
          </Button>
        </FieldRow>
      </div>
    )
  }

  if (item.kind === 'video') {
    const handlePick = async (): Promise<void> => {
      const picked = await window.api.dialog.pickFile('video')
      const cur = latest.current
      if (!picked || cur.kind !== 'video') return
      onChange({
        ...cur,
        videoPath: picked,
        title: cur.title || defaultDeckTitle(picked)
      })
    }
    // `loop` defaults to true — undefined means "I haven't been
    // configured" which we treat as the default (continuous loop).
    const loop = item.loop ?? true

    return (
      <div>
        {head(
          <InlineTextInput
            value={item.title ?? ''}
            onChange={(e) => onChange({ ...item, title: e.target.value })}
            placeholder="Video title, e.g. Sermon intro"
            aria-label="Video title"
          />
        )}
        <FieldRow>
          <Button variant="secondary" size="sm" onClick={() => void handlePick()}>
            {item.videoPath ? 'Change video…' : 'Choose video…'}
          </Button>
          <label className="flex cursor-pointer items-center gap-2 text-[13px] text-soft">
            <input
              type="checkbox"
              checked={loop}
              onChange={(e) => onChange({ ...item, loop: e.target.checked })}
              className="h-4 w-4 cursor-pointer rounded accent-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
            />
            <span>
              Loop continuously
              <span className="text-muted-foreground"> · off moves on when it ends</span>
            </span>
          </label>
        </FieldRow>
      </div>
    )
  }

  if (item.kind === 'deck') {
    // Pulled out into its own component (same reason as ScriptureEditor
    // below) — the in-flight `refreshing` guard needs a `useState`, and
    // ItemBody's if/else switch cannot host a hook that only some
    // branches would call.
    return (
      <DeckEditor
        item={item}
        onChange={onChange}
        staleDesignIds={staleDesignIds}
        head={head}
      />
    )
  }

  if (item.kind === 'countdown') {
    // datetime-local is wall-clock LOCAL time; targetTime is a UTC ISO.
    // Convert both ways via local date parts (slicing the ISO showed UTC,
    // so every edit shifted the target by the zone offset — 8h in Manila).
    const localValue = isoToLocalInput(item.targetTime)
    return (
      <div>
        {head(
          <InlineTextInput
            value={item.label}
            onChange={(e) => onChange({ ...item, label: e.target.value })}
            placeholder="Service starts in…"
            aria-label="Countdown label"
          />
        )}
        <FieldRow>
          <label className="flex items-center gap-2">
            <InlineLabel>Counts down to</InlineLabel>
            <Input
              type="datetime-local"
              value={localValue}
              onChange={(e) => {
                // Cleared / partial input → null; ignore it rather than throw
                // (new Date('').toISOString() is a RangeError) or save garbage.
                const iso = localInputToIso(e.target.value)
                if (iso) onChange({ ...item, targetTime: iso })
              }}
              className="h-8 w-auto px-2.5 text-[13px] tabular-nums"
            />
          </label>
        </FieldRow>
      </div>
    )
  }

  if (item.kind === 'pptx') {
    const handlePick = async (): Promise<void> => {
      const picked = await window.api.dialog.pickFile('pptx')
      if (!picked) return
      try {
        // Evict before probing — re-picking the SAME path (fix a typo,
        // re-import) must see the edited file, not a cached pre-edit
        // parse. See the matching comment in SetlistEditor.tsx / the
        // note in pptxLoader.ts for why this only clears the operator
        // window's cache.
        evictPptxDeck(picked)
        const slideCount = await probeVisibleSlideCount(picked)
        if (slideCount === 0) {
          // Never leave the item pointed at a deck that cannot render —
          // see the matching check in SetlistEditor.tsx's addPptx.
          window.alert(
            'Every slide in that PowerPoint file is marked hidden, so there is nothing to project. Unhide at least one slide in PowerPoint and try again.'
          )
          return
        }
        const cur = latest.current
        if (cur.kind !== 'pptx') return
        onChange({
          ...cur,
          pptxPath: picked,
          slideCount,
          title: cur.title || defaultPptxTitle(picked)
        })
      } catch (err) {
        console.error('[pptx] failed to probe PowerPoint file', picked, err)
        window.alert(
          'Could not open that PowerPoint file. Make sure it is a .pptx (not an older .ppt), or export it to PDF from PowerPoint (File → Export → Create PDF/XPS) and add it as a PDF deck instead.'
        )
      }
    }

    return (
      <div>
        {head(
          <InlineTextInput
            value={item.title ?? ''}
            onChange={(e) => onChange({ ...item, title: e.target.value })}
            placeholder="PowerPoint title (optional)"
            aria-label="PowerPoint title"
          />
        )}
        <FieldRow>
          <Button variant="secondary" size="sm" onClick={() => void handlePick()}>
            {item.pptxPath ? 'Change PowerPoint…' : 'Choose PowerPoint…'}
          </Button>
        </FieldRow>
        {!item.pptxPath && (
          <Hint>
            Projects directly, no PDF export needed. Only .pptx files work (not the older .ppt
            format).
          </Hint>
        )}
      </div>
    )
  }

  // Exhaustiveness check — if you add a new SetlistItem kind and forget
  // to add a branch above, TypeScript complains here.
  const _exhaustive: never = item
  return <div>{_exhaustive}</div>
}

// ─── Deck editor ─────────────────────────────────────────────────────
//
// Pulled out of ItemBody's if/else switch for the same reason as
// ScriptureEditor further down: it needs a `useState` (the in-flight
// `refreshing` guard below), and a hook can only live in a component
// that calls it on every render — not in one branch of a switch that
// other item kinds skip.

type DeckItem = Extract<SetlistItem, { kind: 'deck' }>

function DeckEditor({
  item,
  onChange,
  staleDesignIds,
  head
}: {
  item: DeckItem
  onChange: (next: DeckItem) => void
  staleDesignIds?: string[]
  head: HeadRenderer
}): JSX.Element {
  const latest = useLatest(item)

  const handlePick = async (): Promise<void> => {
    const picked = await window.api.dialog.pickFile('pdf')
    if (!picked) return
    try {
      const pageCount = await probePdfPageCount(picked)
      const cur = latest.current
      // Drop `canva`: a hand-picked PDF has no Canva provenance. Keeping
      // the old key here would lie about where this file came from — the
      // card would keep showing "From Canva", the background staleness
      // check would keep polling a design this deck no longer contains,
      // and Refresh would silently overwrite the operator's deliberate
      // manual choice with a re-pull from Canva.
      const { canva: _discard, ...rest } = cur
      onChange({
        ...rest,
        pdfPath: picked,
        pageCount,
        title: cur.title || defaultDeckTitle(picked)
      })
    } catch (err) {
      console.error('[deck] failed to probe PDF', picked, err)
      window.alert(
        `Could not open that PDF. Try re-exporting from PowerPoint (File → Export → Create PDF/XPS).`
      )
    }
  }

  // `item.canva`'s presence is the sole trigger for any Canva UI on
  // this card — a hand-picked PDF deck has no `canva` key and must
  // show no badge and no Refresh button. With Canva feature-flagged off
  // (shared/features.ts) an imported deck is treated as a plain PDF deck:
  // the `canva` key stays on the item, but no Canva badge/Refresh shows.
  const origin: CanvaOrigin | undefined = FEATURES.canva ? item.canva : undefined
  const isStale = origin ? (staleDesignIds ?? []).includes(origin.designId) : false

  // In-flight guard: a refresh is a full network round trip (export job
  // + poll + download), seconds wide, not a native dialog like
  // handlePick. Without this, an operator who thinks a click didn't
  // register can double-click, and two overlapping refreshes both
  // capture the same `previousPath` — the loser's freshly downloaded
  // PDF is then referenced by nothing (never evicted, never deleted): a
  // leaked cache entry plus a leaked file per double-click. This is
  // per-card local state (not store state) so multiple Canva decks in
  // one setlist stay independently refreshable.
  const [refreshing, setRefreshing] = useState(false)

  // Every Canva call here goes through useCanvaStore, never
  // window.api.canva directly — same reason as CanvaPicker: a revoked
  // grant must flip connection state via the store's wrapCanvaCall, or
  // this button would keep offering a retry that can never succeed.
  // getState() is used (not the `useCanvaStore()` hook) because this
  // only runs inside an event handler, not during render.
  const handleRefresh = async (): Promise<void> => {
    if (!origin || refreshing) return
    setRefreshing(true)
    try {
      const previousPath = item.pdfPath

      // importDesign() never throws — wrapCanvaCall catches internally
      // and records the failure in the store, returning null. Nothing
      // has been touched yet, so a null result is a clean no-op abort.
      const result = await useCanvaStore
        .getState()
        .importDesign(origin.designId, item.title ?? '')
      if (!result) {
        window.alert(
          useCanvaStore.getState().error ??
            'Could not refresh that design from Canva.'
        )
        return
      }

      // The refreshed PDF is on disk under a brand-new path (the import
      // pipeline timestamps filenames precisely so refreshes never reuse
      // a path). Probe it before touching the item at all — if pdf.js
      // can't open it, the existing deck must keep working exactly as
      // it did before this refresh was attempted.
      let pageCount: number
      try {
        pageCount = await probePdfPageCount(result.pdfPath)
      } catch (err) {
        console.error('[deck] failed to probe refreshed PDF', result.pdfPath, err)
        window.alert(
          'Downloaded the refreshed design, but could not open the PDF. Keeping the previous version.'
        )
        return
      }

      // Only now — after the replacement is confirmed good — swap the
      // item over to it.
      onChange({
        ...latest.current,
        pdfPath: result.pdfPath,
        pageCount,
        canva: {
          ...origin,
          designUpdatedAt: result.designUpdatedAt,
          importedAt: new Date().toISOString()
        }
      })

      // Release pdf.js's cached handle on the superseded file BEFORE
      // asking main to delete it: on Windows an open file cannot be
      // removed, so skipping this leaks one PDF per refresh.
      evictPdfDocument(previousPath)
      const deleted = await useCanvaStore.getState().deletePdf(previousPath)
      if (!deleted) {
        // The live deck is already correct at this point — this is not
        // surfaced to the operator, just left as a trace for whoever
        // debugs disk growth before the startup sweep cleans it up.
        console.warn('[deck] failed to delete superseded PDF (will be swept later):', previousPath)
      }
    } finally {
      // Cleared on every exit path — null-import abort, probe-failure
      // abort, and success alike — via `finally` rather than duplicating
      // the reset at each `return`, so the button can never stay
      // permanently disabled.
      setRefreshing(false)
    }
  }

  return (
    <div>
      {head(
        <InlineTextInput
          value={item.title ?? ''}
          onChange={(e) => onChange({ ...item, title: e.target.value })}
          placeholder="Deck title, e.g. Sermon — Romans 12"
          aria-label="Deck title"
        />
      )}
      <FieldRow>
        <Button variant="secondary" size="sm" onClick={() => void handlePick()}>
          {item.pdfPath ? 'Change PDF…' : 'Choose PDF…'}
        </Button>
        {/* Canva-only UI (hidden while FEATURES.canva is off). */}
        {origin && (
          <>
            <Badge>From Canva</Badge>
            {isStale && <Badge tone="warn">Updated in Canva</Badge>}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void handleRefresh()}
              disabled={refreshing}
            >
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </Button>
          </>
        )}
      </FieldRow>
      {!item.pdfPath && (
        <Hint>
          Export your PowerPoint, Keynote, or Google Slides to PDF first, then pick it here. Each
          PDF page becomes one slide.
        </Hint>
      )}
    </div>
  )
}

function displayFileName(path: string): string {
  const parts = path.split(/[/\\]/)
  return parts[parts.length - 1] || path
}

function defaultDeckTitle(path: string): string {
  const base = displayFileName(path)
  return base.replace(/\.pdf$/i, '').replace(/\.[^.]+$/, '')
}

function defaultPptxTitle(path: string): string {
  const base = displayFileName(path)
  return base.replace(/\.pptx$/i, '')
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
  onChange,
  head
}: {
  item: ScriptureItem
  onChange: (next: ScriptureItem) => void
  head: HeadRenderer
}): JSX.Element {
  const { translations, loading: translationsLoading, loadTranslations } =
    useBibleStore()
  const [lookupBusy, setLookupBusy] = useState(false)
  const [lookupError, setLookupError] = useState<string | null>(null)
  const latest = useLatest(item)

  // Lazy-load the translation list the first time any scripture item
  // mounts. Idempotent inside the store.
  useEffect(() => {
    void loadTranslations()
  }, [loadTranslations])

  // Default to ENGWEBP (World English Bible) if the operator hasn't
  // chosen a translation yet AND the catalog has loaded. Picking a
  // sensible default matters more than picking the "right" one — they
  // can swap from the dropdown. Also replaces an id the catalog doesn't
  // know (e.g. 'NIV' from older builds): the <select> would display the
  // first option while state kept the bogus id, so Lookup always failed.
  useEffect(() => {
    if (translations.length === 0) return
    if (item.translation && translations.some((t) => t.id === item.translation)) return
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
      const { translation, reference } = item
      const result = await window.api.bible.lookup(translation, reference)
      if (result.ok) {
        // Skip if the reference/translation was edited mid-lookup: the
        // text belongs to the old query and would mislabel the slide.
        const cur = latest.current
        if (cur.reference !== reference || cur.translation !== translation) return
        onChange({ ...cur, text: result.text })
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
    <div>
      {head(
        <InlineTextInput
          value={item.reference}
          onChange={(e) => onChange({ ...item, reference: e.target.value })}
          onKeyDown={handleReferenceKeyDown}
          placeholder="Reference, e.g. John 3:16 or Romans 12:1-3"
          aria-label="Scripture reference"
        />
      )}
      <FieldRow>
        <Select
          value={item.translation}
          onChange={(e) => onChange({ ...item, translation: e.target.value })}
          disabled={translationsLoading || translations.length === 0}
          aria-label="Bible translation"
          title={
            translationsLoading
              ? 'Loading translations…'
              : 'Pick a Bible translation'
          }
          className="h-8 w-auto max-w-[280px] text-[13px]"
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
        </Select>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void handleLookup()}
          disabled={lookupBusy || !item.reference.trim() || !item.translation}
          title="Look up this reference (Enter)"
        >
          {lookupBusy ? 'Looking up…' : 'Look up'}
        </Button>
        {lookupError && (
          <p className="flex items-center gap-1.5 text-[13px] text-warn">
            <AlertIcon size={14} className="flex-none" />
            {lookupError}
          </p>
        )}
      </FieldRow>
      <Textarea
        value={item.text}
        onChange={(e) => onChange({ ...item, text: e.target.value })}
        placeholder="Verse text. Fill it with Look up or paste it in."
        aria-label="Verse text"
        className="mt-2 min-h-[72px] text-[13.5px]"
      />
    </div>
  )
}
