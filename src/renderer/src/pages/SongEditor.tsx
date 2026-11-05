/**
 * SongEditor — two-column layout: metadata + raw text on the left,
 * live section preview on the right.
 *
 * Autosave flow:
 *   1. User types → local state updates immediately (zero lag)
 *   2. useAutosave debounces for 500ms, then calls window.api.songs.update
 *   3. Main process re-parses rawText and writes atomically
 *   4. Updated song lands back in the library store
 *
 * Live preview:
 *   We parse rawText client-side with the shared parser JUST for display.
 *   This is intentionally a duplicate of what main is about to do — we want
 *   the preview to update at keystroke speed without waiting for the IPC
 *   round-trip. The canonical sections (on disk) still come from main.
 *
 *   The right-column slide grid renders each card with the song's
 *   EFFECTIVE theme (global merged with this song's draft override) —
 *   background colour/image, real font, real text colour — so the
 *   operator can catch lyrics going unreadable over a busy background on
 *   EVERY slide, not just the single slide shown in the override editor's
 *   own live-preview panel. That panel stays as the "what does the very
 *   first slide look like right now" spot-check; this grid is additive,
 *   covering the whole song. Matches the pre-conversion SongEditor.tsx
 *   (see git history — it passed the same merged theme to each card).
 *
 *   The body/text style calculation itself lives in
 *   `../lib/slideTheming.ts`, shared with `SlideCard.tsx` (Service
 *   Mode's slide grid) so the two grids can never silently drift on how
 *   a theme's colors/fonts translate to CSS — see that module's doc
 *   comment. This file mounts the calculated style directly rather than
 *   either (a) importing the whole `SlideCard` component, whose own
 *   border/hover-ring/dark-header-bar/chip-shortcut chrome would fight
 *   this grid's rounded thumbnails and caption row, or (b) mounting
 *   a full `SlideRenderer` per card. `SlideRenderer` is deliberately NOT
 *   used here: it drives an ambient `<video>` element when the theme has
 *   `backgroundVideoPath` set, plus auto-fit measurement effects and a
 *   ResizeObserver per instance — fine for the ONE live-preview slide in
 *   ThemeOverrideEditor, but this grid can render ~20-30 cards
 *   simultaneously for a long song, and that's exactly the "N videos
 *   playing at once crashes weak hardware" case SlideCard.tsx's own doc
 *   comment already warns about. Matching the pre-conversion behavior
 *   (which used SlideCard, not SlideRenderer, for this exact reason)
 *   keeps the known-acceptable baseline: real color/image theming without
 *   the per-card video/auto-fit cost.
 *
 * The rawText textarea is the ONLY place song content can be edited. No
 * per-section drag-and-drop, no rich text. Matches FreeShow's TextEditor.
 */

import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { Song, SongLanguage, Theme, ThemeOverride } from '@shared/types'
import type { SlidePayload, UpdateSongPatch } from '@shared/ipc-contract'
import { useLibraryStore } from '../stores/useLibraryStore'
import { useSetlistStore } from '../stores/useSetlistStore'
import {
  itemsWithoutSong,
  setlistsUsingSong,
  songDeleteConfirmText
} from '../lib/setlist-helpers'
import { useSettingsStore } from '../stores/useSettingsStore'
import { useThemeStore } from '../stores/useThemeStore'
import { useAutosave } from '../hooks/useAutosave'
import { previewSongSlides, type SongPreviewSlide } from '../lib/slideify'
import { mergeThemeOverride } from '../lib/themeOverride'
import { themedBodyStyle, themedTextStyle } from '../lib/slideTheming'
import { ThemeOverrideEditor } from '../components/ThemeOverrideEditor'
import { Button } from '../components/ui/Button'
import { Panel } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { EmptyState } from '../components/ui/EmptyState'
import { Field, Input, Select, Textarea } from '../components/ui/Input'
import { PageHeader } from '../components/ui/PageHeader'
import { SaveStatePill } from '../components/ui/SaveStatePill'
import { TrashIcon } from '../components/icons'

/**
 * Local editor state — a draft of the song fields. Kept separate from
 * the store's canonical Song so typing stays snappy and autosave can
 * debounce without fighting controlled-input React semantics.
 */
interface Draft {
  title: string
  author: string
  ccli: string
  copyright: string
  year: string // kept as string in the form, parsed to number on save
  language: SongLanguage
  categories: string // comma-separated in the UI
  rawText: string
  notes: string
  /**
   * Optional per-song theme override. null = inherit global theme
   * entirely; an object = merge its fields on top of the global theme.
   * Mirrors Song.themeOverride on the wire.
   */
  themeOverride: ThemeOverride | null
}

function songToDraft(song: Song): Draft {
  return {
    title: song.title,
    author: song.author ?? '',
    ccli: song.ccli ?? '',
    copyright: song.copyright ?? '',
    year: song.year?.toString() ?? '',
    language: song.language,
    categories: song.categories.join(', '),
    rawText: song.rawText,
    notes: song.notes,
    themeOverride: song.themeOverride ?? null
  }
}

function draftToPatch(draft: Draft): UpdateSongPatch {
  return {
    title: draft.title.trim() || 'Untitled Song',
    author: draft.author.trim() || null,
    ccli: draft.ccli.trim() || null,
    copyright: draft.copyright.trim() || null,
    year: parseYear(draft.year),
    language: draft.language,
    categories: draft.categories
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean),
    rawText: draft.rawText,
    notes: draft.notes,
    themeOverride: draft.themeOverride
  }
}

/**
 * Free-text year → integer in a plausible range, else null. `Number()`
 * alone let "abc" through as NaN and "1999.5" / "20250" through as-is.
 */
function parseYear(raw: string): number | null {
  const trimmed = raw.trim()
  if (!/^\d{1,4}$/.test(trimmed)) return null
  const n = Number(trimmed)
  return n >= 1000 && n <= 2100 ? n : null
}

/**
 * Keyed by id so moving from one song straight to another remounts the
 * editor: a reused instance would keep the previous song's draft and
 * autosave it under the new id (the same bug fixed in SetlistEditor).
 */
export function SongEditor(): JSX.Element {
  const { id } = useParams<{ id: string }>()
  return <SongEditorForId key={id ?? ''} />
}

function SongEditorForId(): JSX.Element {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { songs, load, update, remove, getById } = useLibraryStore()
  const { settings, load: loadSettings } = useSettingsStore()
  // Global theme is needed so the override editor can display EFFECTIVE
  // field values (global merged with override) rather than showing blank
  // fields for everything the override doesn't specifically set.
  const { theme: globalTheme, load: loadTheme } = useThemeStore()

  const [draft, setDraft] = useState<Draft | null>(null)

  // Load library + settings + theme on first mount if not already loaded
  useEffect(() => {
    if (songs.length === 0) load()
    if (!settings) loadSettings()
    if (!globalTheme) loadTheme()
  }, [songs.length, settings, globalTheme, load, loadSettings, loadTheme])

  // When the target song lands in the store, seed the draft ONCE
  useEffect(() => {
    if (draft) return
    if (!id) return
    const song = getById(id)
    if (song) setDraft(songToDraft(song))
  }, [id, draft, songs, getById])

  // Autosave — only runs once draft is seeded
  const { status, error, cancel } = useAutosave<Draft | null>({
    value: draft,
    onSave: async (value) => {
      if (!value || !id) return
      await update(id, draftToPatch(value))
    }
  })

  if (!id) {
    return (
      <div className="flex h-full w-full min-h-0 flex-col text-foreground">
        <PageHeader back={BACK} title="Song" />
        <main className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          No song id in URL.
        </main>
      </div>
    )
  }

  if (!draft) {
    return (
      <div className="flex h-full w-full min-h-0 flex-col text-foreground">
        <PageHeader back={BACK} title="Song" />
        <main className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Reading from disk…
        </main>
      </div>
    )
  }

  const patch = (changes: Partial<Draft>): void => {
    setDraft((prev) => (prev ? { ...prev, ...changes } : prev))
  }

  // Client-side preview — runs the same parse + max-lines split that the
  // main process will do at save time. Cheap enough to rerun on every
  // keystroke; throwaway render data that never gets persisted.
  const maxLines = settings?.maxLinesPerSlide ?? 4
  const previewSlides = previewSongSlides(draft.rawText, maxLines)

  // Effective theme for the right-column slide grid — global merged with
  // THIS SONG'S DRAFT override (not the saved record), so edits made in
  // the override editor below show up here immediately, matching how
  // every other part of this page previews unsaved state. `globalTheme`
  // can still be null while the theme store is loading; guard exactly
  // like the pre-conversion code did rather than rendering a broken card.
  const effectiveTheme: Theme | null = globalTheme
    ? mergeThemeOverride(globalTheme, draft.themeOverride)
    : null

  // Sample SlidePayload for the theme-override preview inside the left
  // column. Prefer the song's own first slide (so the operator sees
  // their actual lyrics styled with the override) and fall back to a
  // generic placeholder if the textarea is empty — that way the
  // preview is useful even before any lyrics are typed.
  const themePreviewPayload: SlidePayload = previewSlides[0]
    ? {
        kind: 'text',
        lines: previewSlides[0].lines,
        sectionLabel: previewSlides[0].sectionLabel
      }
    : {
        kind: 'text',
        lines: ['Sample lyric line', 'Shows your theme override'],
        sectionLabel: 'Preview'
      }

  const handleDelete = async (): Promise<void> => {
    // main's deleteSong only unlinks the file and slideify drops song
    // items whose song is gone, so deleting a song silently removed it
    // from every service using it. Re-read setlists from disk (an editor
    // may have just autosaved), name them in the confirm, and remove the
    // song's items from them before deleting the song itself.
    const setlistStore = useSetlistStore.getState()
    await setlistStore.load()
    const { setlists, error: loadError } = useSetlistStore.getState()
    if (loadError) {
      window.alert(`Couldn't check which services use this song: ${loadError}`)
      return
    }
    const usedIn = setlistsUsingSong(setlists, id)
    const ok = window.confirm(songDeleteConfirmText(draft.title.trim() || 'Untitled Song', usedIn))
    if (!ok) return
    try {
      for (const s of usedIn) {
        await setlistStore.update(s.id, { items: itemsWithoutSong(s.items, id) })
      }
      // Drop any pending autosave so it can't race the delete (or fire on
      // unmount) and write the song back to disk.
      cancel()
      await remove(id)
    } catch (err) {
      console.error('[SongEditor] delete failed', err)
      window.alert(
        `Couldn't delete the song: ${err instanceof Error ? err.message : String(err)}`
      )
      return
    }
    navigate('/library')
  }

  return (
    <div className="flex h-full w-full min-h-0 flex-col text-foreground">
      <PageHeader
        back={BACK}
        title={draft.title.trim() || 'Untitled Song'}
        description={draft.author || 'Unknown author'}
        action={
          <>
            <SaveStatePill status={status} error={error} />
            <Button type="button" variant="danger" size="md" onClick={handleDelete}>
              <TrashIcon size={15} />
              Delete
            </Button>
          </>
        }
      />

      {/* Two panes: editing on the left, live preview on the right. Each
          scrolls on its own, so the preview stays in view while typing. */}
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-8 border-t border-rule px-8">
        {/* ── Left: details, lyrics, notes, theme override ──── */}
        <section
          aria-label="Song details"
          className="scroll-hairline -mr-3 flex flex-col gap-7 overflow-y-auto pb-12 pr-3 pt-6"
        >
          <Panel title="Details" className="shrink-0">
            <div className="grid grid-cols-2 gap-x-4 gap-y-4 p-4">
              <Field label="Title" className="col-span-2">
                <Input
                  value={draft.title}
                  onChange={(e) => patch({ title: e.target.value })}
                  placeholder="Song title"
                  className="font-medium"
                />
              </Field>

              <Field label="Author">
                <Input
                  value={draft.author}
                  onChange={(e) => patch({ author: e.target.value })}
                  placeholder="e.g. Chris Tomlin"
                />
              </Field>
              <Field label="CCLI number">
                <Input
                  value={draft.ccli}
                  onChange={(e) => patch({ ccli: e.target.value })}
                  placeholder="Optional"
                  className="tabular-nums"
                />
              </Field>

              <Field label="Copyright">
                <Input
                  value={draft.copyright}
                  onChange={(e) => patch({ copyright: e.target.value })}
                  placeholder="Optional"
                />
              </Field>
              <Field label="Year">
                <Input
                  inputMode="numeric"
                  value={draft.year}
                  onChange={(e) => patch({ year: e.target.value })}
                  placeholder="Optional"
                  className="tabular-nums"
                />
              </Field>

              <Field label="Language">
                <Select
                  value={draft.language}
                  onChange={(e) => patch({ language: e.target.value as SongLanguage })}
                >
                  <option value="en">English</option>
                  <option value="tl">Tagalog</option>
                  <option value="ceb">Cebuano</option>
                  <option value="ilo">Ilocano</option>
                  <option value="other">Other</option>
                </Select>
              </Field>
              <Field label="Categories" hint="Comma-separated">
                <Input
                  value={draft.categories}
                  onChange={(e) => patch({ categories: e.target.value })}
                  placeholder="praise, christmas"
                />
              </Field>
            </div>
          </Panel>

          {/* Lyrics — the only place song content is edited. */}
          <div className="flex shrink-0 flex-col gap-2">
            <div className="flex items-baseline justify-between gap-3">
              <label htmlFor="song-lyrics" className="text-[15px] font-semibold text-foreground">
                Lyrics
              </label>
              <span className="text-[12.5px] text-muted-foreground">
                [Section] headers · blank line = new slide
              </span>
            </div>
            <Textarea
              id="song-lyrics"
              value={draft.rawText}
              onChange={(e) => patch({ rawText: e.target.value })}
              spellCheck={false}
              className="min-h-[380px] resize-y px-4 py-3 font-mono text-[13.5px] leading-[1.9] text-bone"
              placeholder={`[Verse 1]\nAmazing grace, how sweet the sound\nThat saved a wretch like me\n\n[Chorus]\nMy chains are gone, I've been set free`}
            />
          </div>

          {/* Operator notes */}
          <div className="flex shrink-0 flex-col gap-2">
            <div className="flex items-baseline justify-between gap-3">
              <label htmlFor="song-notes" className="text-[15px] font-semibold text-foreground">
                Operator notes
              </label>
              <span className="text-[12.5px] text-muted-foreground">Never projected</span>
            </div>
            <Textarea
              id="song-notes"
              value={draft.notes}
              onChange={(e) => patch({ notes: e.target.value })}
              className="min-h-[84px] resize-y px-4 py-3 text-[13.5px] leading-[1.6] text-bone"
              placeholder="Key of G. Skip bridge if running long."
            />
          </div>

          {/* Theme override — only usable once the global theme has loaded
              because the override editor displays the merged (effective)
              theme, not just the raw override fields. */}
          {globalTheme && (
            <div className="shrink-0">
              <ThemeOverrideEditor
                override={draft.themeOverride}
                globalTheme={globalTheme}
                onChange={(next) => patch({ themeOverride: next })}
                previewSlide={themePreviewPayload}
              />
            </div>
          )}
        </section>

        {/* ── Right: live preview ───────────────────────────── */}
        <section aria-label="Slide preview" className="scroll-hairline -mr-3 overflow-y-auto pb-12 pr-3">
          <div className="sticky top-0 z-10 flex items-center justify-between gap-3 bg-panel pb-3 pt-6">
            <div className="flex items-baseline gap-2.5">
              <h2 className="text-[15px] font-semibold text-foreground">Preview</h2>
              <span className="text-[13px] tabular-nums text-soft">
                {previewSlides.length} slide{previewSlides.length === 1 ? '' : 's'}
              </span>
            </div>
            <Badge tone="neutral">
              Max {maxLines} line{maxLines === 1 ? '' : 's'} per slide
            </Badge>
          </div>

          {previewSlides.length === 0 ? (
            <EmptyState
              title="No slides yet"
              description="Start typing lyrics on the left. Use [Section] markers to split them into verses, chorus and bridge."
            />
          ) : (
            <div className="grid grid-cols-2 gap-x-3 gap-y-4">
              {previewSlides.map((slide) => (
                <SlidePreviewCard key={slide.key} slide={slide} theme={effectiveTheme} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

// ─── Local pieces used only on this page ────────────────────────────

/** Breadcrumb back to the library — also on the loading/error states so
 * the operator is never stranded without a way out. */
const BACK = { to: '/library', label: 'Songs' }

/**
 * SlidePreviewCard — one rounded 16:9 thumbnail themed with the song's
 * EFFECTIVE theme (background colour/image + real font/text colour — see
 * the module doc for why video and auto-fit are deliberately not
 * reproduced here), with the section label chip and the slide's
 * keyboard shortcut underneath.
 */
function SlidePreviewCard({
  slide,
  theme
}: {
  slide: SongPreviewSlide
  theme: Theme | null
}): JSX.Element {
  // Shared with SlideCard.tsx — see ../lib/slideTheming.ts's doc comment.
  const bodyStyle = themedBodyStyle(theme)
  const textStyle = themedTextStyle(theme)

  return (
    <figure className="min-w-0">
      <div
        className="relative flex aspect-video items-center justify-center overflow-hidden rounded-lg p-3.5 ring-1 ring-inset ring-white/5"
        style={bodyStyle}
      >
        {/* Deliberately NO scrim here, unlike SlideCard.tsx's `bg-black/25`
            overlay. This grid exists so the operator can catch lyrics
            going unreadable over a busy background — a scrim would
            artificially lift legibility and hide exactly the failure
            this preview is meant to surface. SlideRenderer (what the
            projector actually renders) has no scrim either, so this is
            the honest rendering, not an incomplete one. */}
        {slide.lines.length === 0 ? (
          <span className="text-[12px] italic text-muted-foreground">Empty slide</span>
        ) : (
          <div
            className="whitespace-pre-line text-center text-[12px] font-bold leading-[1.5]"
            style={textStyle}
          >
            {slide.lines.join('\n')}
          </div>
        )}
      </div>
      <figcaption className="mt-1.5 flex items-center justify-between gap-2 px-0.5">
        <Badge tone="neutral" className="min-w-0 truncate">
          {slide.sectionLabel || 'Untitled'}
        </Badge>
        {slide.shortcut && (
          <kbd
            className="shrink-0 rounded border border-border px-1.5 py-0.5 font-sans text-[12px] leading-none text-muted-foreground"
            title="Keyboard shortcut in Service Mode"
          >
            {slide.shortcut}
          </kbd>
        )}
      </figcaption>
    </figure>
  )
}
