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
 *   this grid's `HairlineGrid` seams and KLB mono header, or (b) mounting
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
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { Song, SongLanguage, Theme, ThemeOverride } from '@shared/types'
import type { SlidePayload, UpdateSongPatch } from '@shared/ipc-contract'
import { useLibraryStore } from '../stores/useLibraryStore'
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
import { MonoLabel } from '../components/ui/MonoLabel'
import { SaveStatePill } from '../components/ui/SaveStatePill'
import { HairlineGrid } from '../components/ui/HairlineGrid'
import { cn } from '../lib/utils'

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
    year: draft.year.trim() ? Number(draft.year.trim()) : null,
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

export function SongEditor(): JSX.Element {
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
  const { status, error } = useAutosave<Draft | null>({
    value: draft,
    onSave: async (value) => {
      if (!value || !id) return
      await update(id, draftToPatch(value))
    }
  })

  if (!id) {
    return (
      <div className="flex h-screen w-screen flex-col bg-background text-foreground">
        <BackLink />
        <main className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          No song id in URL.
        </main>
      </div>
    )
  }

  if (!draft) {
    return (
      <div className="flex h-screen w-screen flex-col bg-background text-foreground">
        <BackLink />
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
    const ok = window.confirm(`Delete "${draft.title}"?`)
    if (!ok) return
    await remove(id)
    navigate('/library')
  }

  return (
    <div className="flex h-screen w-screen flex-col bg-background text-foreground">
      {/* ── Header ──────────────────────────────────────────────── */}
      <header className="flex shrink-0 items-center justify-between border-b border-border bg-card px-6 py-4">
        <div className="min-w-0">
          <Link
            to="/library"
            className="mb-2 block font-mono text-[9.5px] font-semibold uppercase leading-none tracking-[0.12em] text-muted-foreground transition-colors hover:text-signal"
          >
            ← SONGS
          </Link>
          <h1 className="truncate text-[26px] font-extrabold leading-none tracking-[-0.03em] text-foreground">
            {draft.title.trim() || 'Untitled Song'}
          </h1>
          <p className="mt-1 truncate text-[12px] text-soft">
            {draft.author || 'Unknown author'}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3.5">
          <SaveStatePill status={status} error={error} />
          <Button type="button" variant="danger" size="md" onClick={handleDelete}>
            DELETE
          </Button>
        </div>
      </header>

      {/* Two-column body */}
      <div className="grid flex-1 grid-cols-[47%_53%] overflow-hidden">
        {/* ── Left: metadata + raw text ──────────────────────── */}
        <section className="scroll-hairline flex flex-col gap-[22px] overflow-y-auto border-r border-border px-6 py-[22px] pb-10">
          {/* Details — title, author, and cataloging metadata */}
          <Panel title="DETAILS">
            <div className="grid grid-cols-2 gap-3.5 p-4">
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
              <Field label="CCLI #">
                <Input
                  value={draft.ccli}
                  onChange={(e) => patch({ ccli: e.target.value })}
                  placeholder="optional"
                  className="font-mono"
                />
              </Field>

              <Field label="Copyright">
                <Input
                  value={draft.copyright}
                  onChange={(e) => patch({ copyright: e.target.value })}
                  placeholder="optional"
                />
              </Field>
              <Field label="Year">
                <Input
                  inputMode="numeric"
                  value={draft.year}
                  onChange={(e) => patch({ year: e.target.value })}
                  placeholder="optional"
                  className="font-mono"
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
              <Field label="Categories" hint="comma-separated">
                <Input
                  value={draft.categories}
                  onChange={(e) => patch({ categories: e.target.value })}
                  placeholder="praise, christmas"
                />
              </Field>
            </div>
          </Panel>

          {/* Lyrics */}
          <Panel
            title="LYRICS"
            action={
              <span className="font-mono text-[10px] tracking-[0.04em] text-dim">
                [SECTION] HEADERS · BLANK LINE = NEW SLIDE
              </span>
            }
          >
            <textarea
              value={draft.rawText}
              onChange={(e) => patch({ rawText: e.target.value })}
              spellCheck={false}
              className="min-h-[300px] w-full resize-y border-0 bg-background p-4 font-mono text-[13px] leading-[2] text-bone outline-none placeholder:text-muted-foreground/50"
              placeholder={`[Verse 1]\nAmazing grace, how sweet the sound\nThat saved a wretch like me\n\n[Chorus]\nMy chains are gone, I've been set free`}
            />
          </Panel>

          {/* Operator notes */}
          <Panel title="OPERATOR NOTES · NEVER PROJECTED">
            <textarea
              value={draft.notes}
              onChange={(e) => patch({ notes: e.target.value })}
              className="min-h-[72px] w-full resize-y border-0 bg-background px-4 py-3.5 text-[13px] leading-[1.6] text-bone outline-none placeholder:text-muted-foreground/50"
              placeholder="Key of G. Skip bridge if running long."
            />
          </Panel>

          {/* Theme override — only usable once the global theme has loaded
              because the override editor displays the merged (effective)
              theme, not just the raw override fields. */}
          {globalTheme && (
            <ThemeOverrideEditor
              override={draft.themeOverride}
              globalTheme={globalTheme}
              onChange={(next) => patch({ themeOverride: next })}
              previewSlide={themePreviewPayload}
            />
          )}
        </section>

        {/* ── Right: live preview ───────────────────────────── */}
        <section className="scroll-hairline overflow-y-auto px-6 py-[22px] pb-10">
          <div className="mb-[14px] flex items-center justify-between">
            <MonoLabel size="sm">
              LIVE PREVIEW · {previewSlides.length} SLIDE{previewSlides.length === 1 ? '' : 'S'}
            </MonoLabel>
            <Badge tone="signal">MAX {maxLines} LINES</Badge>
          </div>

          {previewSlides.length === 0 ? (
            <div className="border border-dashed border-dim px-6 py-10 text-center text-[12px] text-dim">
              Start typing lyrics on the left. Use{' '}
              <span className="font-mono text-[11px] text-soft">[Section]</span> markers to
              split into verses, chorus, and bridge.
            </div>
          ) : (
            <HairlineGrid cols={2}>
              {previewSlides.map((slide) => (
                <SlidePreviewCard key={slide.key} slide={slide} theme={effectiveTheme} />
              ))}
            </HairlineGrid>
          )}
        </section>
      </div>
    </div>
  )
}

// ─── Local primitives used only on this page ────────────────────────

/** Bare back-to-library link, used by the loading/error fallback states
 * above so the operator is never stranded without a way out. */
function BackLink(): JSX.Element {
  return (
    <div className="shrink-0 border-b border-border bg-card px-6 py-4">
      <Link
        to="/library"
        className="font-mono text-[9.5px] font-semibold uppercase leading-none tracking-[0.12em] text-muted-foreground transition-colors hover:text-signal"
      >
        ← SONGS
      </Link>
    </div>
  )
}

function Input({
  className,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement>): JSX.Element {
  return (
    <input
      type="text"
      {...rest}
      className={cn(
        'h-9 w-full border border-border bg-background px-3 text-[13px] text-foreground outline-none transition-colors',
        'placeholder:text-muted-foreground/60',
        'focus:border-signal/50',
        className
      )}
    />
  )
}

function Select({
  className,
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement>): JSX.Element {
  return (
    <select
      {...rest}
      className={cn(
        'h-9 w-full border border-border bg-background px-2 text-[13px] text-foreground outline-none transition-colors',
        'focus:border-signal/50',
        className
      )}
    />
  )
}

function Field({
  label,
  hint,
  className,
  children
}: {
  label: string
  hint?: string
  className?: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <label className={cn('flex flex-col gap-1.5', className)}>
      <span className="flex items-baseline justify-between">
        <MonoLabel size="xs">{label}</MonoLabel>
        {hint && <span className="text-[10px] text-dim">{hint}</span>}
      </span>
      {children}
    </label>
  )
}

/**
 * SlidePreviewCard — one cell of the right-column layout grid: a mono
 * header bar (section label), a 16:9 body themed with the song's
 * EFFECTIVE theme (background colour/image + real font/text colour —
 * see the module doc for why video and auto-fit are deliberately not
 * reproduced here), and a corner shortcut glyph.
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
    <div className="bg-card">
      <div className="border-b border-border px-2.5 py-[7px]">
        <MonoLabel size="xs" tone="soft">
          {slide.sectionLabel || '—'}
        </MonoLabel>
      </div>
      <div
        className="relative flex aspect-video items-center justify-center overflow-hidden p-3.5"
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
          <span className="text-[10px] italic text-dim">(empty)</span>
        ) : (
          <div
            className="whitespace-pre-line text-center text-[12px] font-bold leading-[1.5]"
            style={textStyle}
          >
            {slide.lines.join('\n')}
          </div>
        )}
        {slide.shortcut && (
          <div className="pointer-events-none absolute bottom-1.5 right-2 font-mono text-[10px] text-dim">
            {slide.shortcut}
          </div>
        )}
      </div>
    </div>
  )
}
