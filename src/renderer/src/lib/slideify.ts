/**
 * slideify — turn a Setlist into a flat array of renderable items,
 * each with its own list of SlidePayloads.
 *
 * Pure function. No React, no IPC, no side effects. Given (setlist, songs),
 * you always get the same output. This is called once when Service Mode
 * starts (and again only if the setlist changes mid-service, which is rare).
 *
 * Why nested `RenderableItem[]` rather than a flat `SlidePayload[]`:
 *
 *   The service state machine tracks (itemIndex, slideIndex). If we
 *   flattened, "next item" would need to search forward for the next
 *   item-boundary. Keeping items and slides separate makes nextItem()
 *   literally `itemIndex + 1`. Clearer code, trivial perf cost.
 */

import type {
  Setlist,
  SetlistItem,
  Song,
  SongSection,
  SectionType,
  ThemeOverride
} from '@shared/types'
import type { SlidePayload } from '@shared/ipc-contract'
import { parseSongText } from '@shared/parser'
import { packScripture } from './scriptureSlides'

export interface RenderableItem {
  /** Matches SetlistItem.id — used as React key and for focused-item UI */
  id: string
  kind: SetlistItem['kind']
  /** Human-readable label shown in the operator upcoming list */
  label: string
  /** At least 1 — items that would produce 0 slides are dropped upstream */
  slides: SlidePayload[]
  /**
   * Operator-only notes carried over from `Song.notes` for song items.
   * Surfaced in Service Mode under the confidence monitor. Undefined for
   * non-song items since those have no notes field.
   */
  notes?: string
  /**
   * Optional per-item theme override. Copied from `Song.themeOverride`
   * when this item was slideified. The service store broadcasts it to
   * the output window on item change so the projector can merge it on
   * top of the active global theme. Undefined for non-song items or
   * for songs that don't have an override set.
   */
  themeOverride?: ThemeOverride | null
  /**
   * Pre-computed lower-thirds default text for this item. Populated
   * from the source record at slideify time so the operator's
   * "Auto from current item" button doesn't have to re-walk the
   * library store. Currently only set for songs (title + author);
   * other item kinds leave this undefined and the operator types
   * lower-thirds text manually.
   */
  lowerThirdsDefault?: { title: string; subtitle: string }
}

export interface SlideifyOptions {
  /**
   * Hard cap on lines per text slide. Any text slide with more lines than
   * this is split into multiple sub-slides of (at most) this many lines.
   * Manual blank-line breaks in rawText still take precedence — they
   * produce slide boundaries during parsing, so splitting only kicks in
   * for sections that the author wrote as one long block.
   *
   * Reasonable values: 2..8. Clamped inside this function so callers
   * can't accidentally pass 0 or a negative.
   */
  maxLinesPerSlide?: number
  /**
   * Whether to insert an empty "intro" slide as the first slide of
   * every song item. The intro slide shows the song's background
   * (theme + per-song override) with no lyric text — giving the
   * congregation a moment to register the visual change before the
   * first verse appears, instead of jumping straight from the
   * previous item's content into a wall of lyrics.
   *
   * Default true. Disable globally via Settings → Display.
   */
  songTransitionSlide?: boolean
}

/**
 * Slideify a setlist. Items that can't be rendered (missing song, empty
 * scripture) are dropped rather than showing a broken slide mid-service.
 * We'd rather Ate Rose see a shorter setlist than a blank projector.
 */
export function slideifySetlist(
  setlist: Setlist,
  songsById: Map<string, Song>,
  options: SlideifyOptions = {}
): RenderableItem[] {
  const maxLines = clampMaxLines(options.maxLinesPerSlide)
  const transitionSlide = options.songTransitionSlide ?? true

  const out: RenderableItem[] = []

  for (const item of setlist.items) {
    const rendered = slideifyItem(item, songsById, maxLines, transitionSlide)
    if (rendered && rendered.slides.length > 0) {
      out.push(rendered)
    }
  }

  return out
}

/**
 * Split `lines` into the fewest chunks of at most `maxLines` lines,
 * balanced so no chunk is a lone widow line: 5 @ 4 → 3+2 (not 4+1),
 * 9 @ 4 → 3+3+3 (not 4+4+1). A stranded last line on its own slide
 * reads as a mistake to the congregation and wastes an advance.
 *
 * Chunk count = ceil(n / max); the lines are then dealt out evenly,
 * earlier chunks taking the remainder, so sizes differ by at most one
 * (7 @ 4 → 4+3, 10 @ 3 → 3+3+2+2). A fixed size of ceil(n / chunks)
 * is NOT enough: 10 @ 3 would give 3+3+3+1, the very widow this avoids.
 * Shared by the setlist path (enforceMaxLines) and the editor preview
 * (previewSongSlides) so both always split identically.
 */
export function splitBalanced(lines: string[], maxLines: number): string[][] {
  if (lines.length <= maxLines) return [lines]
  const chunkCount = Math.ceil(lines.length / maxLines)
  const base = Math.floor(lines.length / chunkCount)
  const remainder = lines.length % chunkCount
  const out: string[][] = []
  let start = 0
  for (let i = 0; i < chunkCount; i++) {
    const size = base + (i < remainder ? 1 : 0)
    out.push(lines.slice(start, start + size))
    start += size
  }
  return out
}

/**
 * Split text slides that exceed `maxLines` into balanced chunks (see
 * splitBalanced). All chunks inherit the original slide's sectionLabel
 * so "Verse 1" still reads as "Verse 1" on both halves.
 *
 * Non-text slides (image, countdown) pass through unchanged.
 */
function enforceMaxLines(slides: SlidePayload[], maxLines: number): SlidePayload[] {
  const out: SlidePayload[] = []
  for (const slide of slides) {
    if (slide.kind !== 'text' || slide.lines.length <= maxLines) {
      out.push(slide)
      continue
    }
    for (const lines of splitBalanced(slide.lines, maxLines)) {
      out.push({ kind: 'text', lines, sectionLabel: slide.sectionLabel })
    }
  }
  return out
}

function clampMaxLines(value: number | undefined): number {
  if (!value || !Number.isFinite(value)) return 4
  // Clamp to a safe range — 1 is too restrictive (one-word slides),
  // 20 is functionally unlimited and will re-trigger the auto-fit
  // overflow situation the feature exists to prevent.
  return Math.max(2, Math.min(20, Math.floor(value)))
}

function slideifyItem(
  item: SetlistItem,
  songsById: Map<string, Song>,
  maxLines: number,
  transitionSlide: boolean
): RenderableItem | null {
  if (item.kind === 'song') {
    const song = songsById.get(item.songId)
    if (!song) return null
    const slides: SlidePayload[] = []
    // Optional intro / transition slide: empty lyrics on the song's
    // background. Lets the operator move from the previous item
    // (image, video, scripture) into the song's visual context for
    // a beat before the first verse appears. The empty `lines` array
    // means SlideRenderer paints just the background — the lower
    // thirds auto-follow also stays hidden because empty lyrics
    // string fails its truthiness check.
    if (transitionSlide) {
      slides.push({
        kind: 'text',
        lines: [],
        sectionLabel: 'Intro'
      })
    }
    for (const section of song.sections) {
      for (const slide of section.slides) {
        slides.push({
          kind: 'text',
          lines: slide,
          sectionLabel: section.label || undefined
        })
      }
    }
    return {
      id: item.id,
      kind: 'song',
      label: song.title,
      slides: enforceMaxLines(slides, maxLines),
      notes: song.notes || undefined,
      themeOverride: song.themeOverride ?? null,
      lowerThirdsDefault: {
        title: song.title,
        subtitle: song.author?.trim() ?? ''
      }
    }
  }

  if (item.kind === 'scripture') {
    const text = item.text.trim()
    if (!text) return null
    // Packed by character budget, not line count: each line here is a
    // whole verse, so line-count splitting crammed 4 long verses onto a
    // slide. Blank lines in the text are still honored as hard breaks.
    const slides: SlidePayload[] = packScripture(text, maxLines).map((lines) => ({
      kind: 'text',
      lines,
      sectionLabel: `${item.reference} (${item.translation})`
    }))
    return {
      id: item.id,
      kind: 'scripture',
      label: `${item.reference} · ${item.translation}`,
      slides
    }
  }

  if (item.kind === 'section-divider') {
    // Section dividers are grouping-only in the editor — they don't
    // project anything. Returning null drops them from the renderable
    // timeline so N/P skip straight from the last worship song into the
    // sermon without stopping on a "WORSHIP" slide.
    return null
  }

  if (item.kind === 'image') {
    if (!item.imagePath) return null
    return {
      id: item.id,
      kind: 'image',
      label: item.caption || 'Image',
      slides: [{ kind: 'image', imagePath: item.imagePath, caption: item.caption }]
    }
  }

  if (item.kind === 'countdown') {
    return {
      id: item.id,
      kind: 'countdown',
      label: item.label,
      slides: [
        { kind: 'countdown', label: item.label, targetTime: item.targetTime }
      ]
    }
  }

  if (item.kind === 'video') {
    if (!item.videoPath) return null
    // `loop` defaults to true (continuous playback). Volunteers usually
    // want loops for worship visuals and ambient backgrounds; the
    // explicit-false case is for sermon bumpers and fixed-length
    // transition videos that should auto-advance the setlist.
    const loop = item.loop ?? true
    return {
      id: item.id,
      kind: 'video',
      label: item.title?.trim() || 'Video',
      slides: [
        {
          kind: 'video',
          videoPath: item.videoPath,
          title: item.title,
          loop
        }
      ]
    }
  }

  if (item.kind === 'deck') {
    // Expand the deck into N pdf-page slides. pageCount was recorded
    // when the deck was added (via probePdfPageCount) so this is a pure
    // synchronous fan-out. A deck with 0 pages (unreadable / empty) is
    // dropped rather than shown as a broken item.
    if (!item.pdfPath || item.pageCount <= 0) return null
    const slides: SlidePayload[] = []
    for (let i = 1; i <= item.pageCount; i++) {
      slides.push({
        kind: 'pdf-page',
        pdfPath: item.pdfPath,
        pageIndex: i,
        pageCount: item.pageCount
      })
    }
    return {
      id: item.id,
      kind: 'deck',
      label: item.title?.trim() || 'PDF deck',
      slides
    }
  }

  if (item.kind === 'pptx') {
    // Expand into N pptx-slide payloads, one per VISIBLE slide. slideCount was
    // recorded at add-time (via probeVisibleSlideCount) so this stays a pure
    // synchronous fan-out, exactly like the deck branch above. A deck with 0
    // slides (unreadable / all-hidden) is dropped rather than shown broken.
    if (!item.pptxPath || item.slideCount <= 0) return null
    const slides: SlidePayload[] = []
    for (let i = 1; i <= item.slideCount; i++) {
      slides.push({
        kind: 'pptx-slide',
        pptxPath: item.pptxPath,
        slideOrdinal: i,
        slideCount: item.slideCount
      })
    }
    return {
      id: item.id,
      kind: 'pptx',
      label: item.title?.trim() || 'PowerPoint',
      slides
    }
  }

  // Exhaustiveness — TypeScript forces a new branch above if a kind is added
  const _never: never = item
  return _never
}

// ─────────────────────────────────────────────────────────────────────────────
// Song-level preview helpers — used by SongEditor's slide-card grid.
//
// These do the same parse + max-lines splitting that slideifySetlist does
// for song items, but operate on a raw textarea string so they can preview
// unsaved edits without going through IPC.
// ─────────────────────────────────────────────────────────────────────────────

export interface SongPreviewSlide {
  /** Stable React key. Unique per slide within a song. */
  key: string
  /** Human label shown in the card header ("Verse 1", "Chorus", etc) */
  sectionLabel: string
  sectionType: SectionType
  /** Section shortcut shown in the bottom-right corner ("1", "C", "B", …) */
  shortcut: string
  lines: string[]
  /** 0-based index of this sub-slide within its section (after splitting) */
  slideIndex: number
  /** Total sub-slides in this section after splitting */
  slideCount: number
}

/**
 * String-based shortcut computation used by the Service Mode grid.
 *
 * The Service Mode grid builds cards from `SlidePayload` objects (which
 * only carry a `sectionLabel` string, not a `SectionType`), so it needs
 * a version of shortcut lookup that works from the label alone. Uses
 * the same rules as `slideShortcutFor`, just from a free-form string.
 *
 *   "Verse 1"   → "1"
 *   "Verse 12"  → "12"
 *   "Chorus 2"  → "C"
 *   "Bridge"    → "B"
 *   "Pre-Chorus"→ "P"
 *   "John 3:16 (NIV)" → "J"   (scripture fallback: first letter)
 *   ""          → ""
 */
export function shortcutFromLabel(label: string): string {
  if (!label) return ''
  const lower = label.toLowerCase().trim()
  const verseMatch = lower.match(/verse\s*(\d+)/)
  if (verseMatch) return verseMatch[1]
  if (lower.startsWith('pre-chorus') || lower.startsWith('prechorus') || lower.startsWith('pre chorus')) return 'P'
  if (lower.startsWith('chorus')) return 'C'
  if (lower.startsWith('bridge')) return 'B'
  if (lower.startsWith('intro')) return 'I'
  if (lower.startsWith('outro')) return 'O'
  if (lower.startsWith('tag')) return 'T'
  return label.trim()[0]?.toUpperCase() ?? ''
}

/**
 * Compute the one-character shortcut FreeShow/ProPresenter-style:
 *
 *   Verse 1  → "1"   (extracted from label)
 *   Verse 2  → "2"
 *   Chorus   → "C"
 *   Bridge   → "B"
 *   Intro    → "I"
 *   Outro    → "O"
 *   Pre-Chorus → "P"
 *   Tag      → "T"
 *   Other    → first letter of label, uppercase (or "")
 *
 * Deliberately simple: operators memorize "V1 V2 C V3 C B C" for a whole
 * service and don't need a complicated mapping.
 */
export function slideShortcutFor(
  section: Pick<SongSection, 'type' | 'label'>
): string {
  switch (section.type) {
    case 'verse': {
      const m = section.label.match(/\d+/)
      return m ? m[0] : 'V'
    }
    case 'chorus':
      return 'C'
    case 'bridge':
      return 'B'
    case 'intro':
      return 'I'
    case 'outro':
      return 'O'
    case 'pre-chorus':
      return 'P'
    case 'tag':
      return 'T'
    default:
      return section.label.trim()[0]?.toUpperCase() ?? ''
  }
}

/**
 * Parse a raw song textarea string and return one `SongPreviewSlide` per
 * renderable slide, with max-lines splitting applied. This is exactly
 * what the output window would render for the song, modulo setlist
 * context — safe to call on every keystroke (cheap).
 */
export function previewSongSlides(
  rawText: string,
  maxLinesPerSlide: number
): SongPreviewSlide[] {
  const maxLines = clampMaxLines(maxLinesPerSlide)
  const sections = parseSongText(rawText)
  const out: SongPreviewSlide[] = []

  for (const section of sections) {
    const shortcut = slideShortcutFor(section)
    const label = section.label || section.type

    // Apply max-lines splitting to each parser-produced slide — same
    // helper as enforceMaxLines so the editor preview never disagrees
    // with what the projector shows.
    const expanded: string[][] = section.slides.flatMap((slide) =>
      splitBalanced(slide, maxLines)
    )

    expanded.forEach((lines, idx) => {
      out.push({
        key: `${section.id}-${idx}`,
        sectionLabel: label,
        sectionType: section.type,
        shortcut,
        lines,
        slideIndex: idx,
        slideCount: expanded.length
      })
    })
  }

  return out
}

/**
 * Format an ISO target time as a H:MM:SS-style countdown string.
 * Output:
 *   - "15:32"           when under an hour
 *   - "1:02:45"         when over an hour
 *   - "Starting now"    when <= 0
 *   - "--:--"           when targetISO doesn't parse
 *
 * An unparseable target gets a neutral placeholder, NOT "Starting now":
 * a bad/empty target time on a pre-service countdown would otherwise
 * tell the room the service is starting when nobody set a time.
 *
 * Pure + cheap so the output window can call it on every 500ms tick
 * without breaking a sweat.
 */
export function formatCountdown(targetISO: string, now: number = Date.now()): string {
  const target = new Date(targetISO).getTime()
  if (!Number.isFinite(target)) return '--:--'
  const remainingMs = target - now
  if (remainingMs <= 0) return 'Starting now'

  const totalSeconds = Math.floor(remainingMs / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  const mm = String(minutes).padStart(2, '0')
  const ss = String(seconds).padStart(2, '0')

  return hours > 0 ? `${hours}:${mm}:${ss}` : `${minutes}:${ss}`
}
