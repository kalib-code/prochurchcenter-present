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
 * The rawText textarea is the ONLY place song content can be edited. No
 * per-section drag-and-drop, no rich text. Matches FreeShow's TextEditor.
 */

import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { Song, SongLanguage, Theme, ThemeOverride } from '@shared/types'
import type { SlidePayload, UpdateSongPatch } from '@shared/ipc-contract'
import { useLibraryStore } from '../stores/useLibraryStore'
import { useSettingsStore } from '../stores/useSettingsStore'
import { useThemeStore } from '../stores/useThemeStore'
import { useAutosave } from '../hooks/useAutosave'
import { previewSongSlides } from '../lib/slideify'
import { mergeThemeOverride } from '../lib/themeOverride'
import { SlideCard } from '../components/SlideCard'
import { SlideRenderer } from '../components/SlideRenderer'
import { ThemeFields } from '../components/ThemeFields'
import { PageHeader } from '../components/ui/PageHeader'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
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
        <PageHeader eyebrow="Library" title="Edit song" backTo="/library" />
        <main className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          No song id in URL.
        </main>
      </div>
    )
  }

  if (!draft) {
    return (
      <div className="flex h-screen w-screen flex-col bg-background text-foreground">
        <PageHeader eyebrow="Library" title="Loading song…" backTo="/library" />
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
      <PageHeader
        eyebrow="Library"
        title={draft.title.trim() || 'Untitled Song'}
        subtitle={draft.author || 'Unknown author'}
        backTo="/library"
        backLabel="Library"
        actions={
          <>
            <AutosaveStatus status={status} error={error} />
            <Button variant="destructive" size="sm" onClick={handleDelete}>
              Delete
            </Button>
          </>
        }
      />

      {/* Two-column body */}
      <div className="flex flex-1 overflow-hidden">
        {/* ── Left: metadata + raw text ──────────────────────── */}
        <section className="flex w-[48%] shrink-0 flex-col gap-4 overflow-y-auto border-r border-border/40 px-8 py-6">
          {/* Details card — title, author, and cataloging metadata */}
          <Card className="p-5">
            <SectionLabel>Details</SectionLabel>
            <div className="mt-3 space-y-3">
              <Field label="Title">
                <Input
                  value={draft.title}
                  onChange={(e) => patch({ title: e.target.value })}
                  placeholder="Song title"
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
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
                  />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
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
                  />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Language">
                  <Select
                    value={draft.language}
                    onChange={(e) =>
                      patch({ language: e.target.value as SongLanguage })
                    }
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
            </div>
          </Card>

          {/* Lyrics card */}
          <Card className="p-5">
            <div className="flex items-baseline justify-between">
              <SectionLabel>Lyrics</SectionLabel>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
                [Section] headers · blank line = new slide
              </span>
            </div>
            <textarea
              value={draft.rawText}
              onChange={(e) => patch({ rawText: e.target.value })}
              spellCheck={false}
              className="mt-3 min-h-[320px] w-full resize-y rounded-md border border-border/60 bg-background/60 p-3 font-mono text-[13px] leading-[1.5] outline-none transition-colors focus:border-brand/40 focus:bg-background"
              placeholder={`[Verse 1]\nAmazing grace, how sweet the sound\nThat saved a wretch like me\n\n[Chorus]\nMy chains are gone, I've been set free`}
            />
          </Card>

          {/* Notes card */}
          <Card className="p-5">
            <div className="flex items-baseline justify-between">
              <SectionLabel>Operator notes</SectionLabel>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
                shown in Service Mode
              </span>
            </div>
            <textarea
              value={draft.notes}
              onChange={(e) => patch({ notes: e.target.value })}
              className="mt-3 min-h-[64px] w-full resize-y rounded-md border border-border/60 bg-background/60 p-3 text-sm outline-none transition-colors focus:border-brand/40 focus:bg-background"
              placeholder="Key of G. Skip bridge if running long."
            />
          </Card>

          {/* Theme override — only usable once the global theme has loaded
              because the override editor displays the merged (effective)
              theme, not just the raw override fields. */}
          {globalTheme && (
            <ThemeOverrideSection
              override={draft.themeOverride}
              globalTheme={globalTheme}
              onChange={(next) => patch({ themeOverride: next })}
              previewPayload={themePreviewPayload}
            />
          )}
        </section>

        {/* ── Right: live preview ───────────────────────────── */}
        <aside className="flex flex-1 flex-col overflow-hidden bg-black/40 backdrop-blur-sm">
          <div className="flex shrink-0 items-baseline justify-between border-b border-white/5 px-8 py-5">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-brand/80">
                Live preview
              </div>
              <h2 className="mt-0.5 text-sm font-semibold text-foreground">
                {previewSlides.length} slide
                {previewSlides.length === 1 ? '' : 's'}
              </h2>
            </div>
            <Badge tone="outline">max {maxLines} lines</Badge>
          </div>

          <div className="flex-1 overflow-y-auto px-8 py-6">
            {previewSlides.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                <div className="max-w-xs text-center text-sm text-white/50">
                  Start typing lyrics on the left. Use{' '}
                  <code className="rounded bg-white/5 px-1 py-[1px] font-mono text-[11px] text-white/70">
                    [Section]
                  </code>{' '}
                  markers to split into verses, chorus, and bridge.
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
                {previewSlides.map((slide) => (
                  <SlideCard
                    key={slide.key}
                    sectionLabel={slide.sectionLabel}
                    shortcut={slide.shortcut}
                    lines={slide.lines}
                    // Apply the effective theme — global merged with
                    // this song's override (if any). The card body
                    // then renders the background image + theme text
                    // so the preview matches the projector output.
                    theme={
                      globalTheme
                        ? mergeThemeOverride(globalTheme, draft.themeOverride)
                        : null
                    }
                  />
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}

// ─── Local primitives used only on this page ────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/80">
      {children}
    </div>
  )
}

function Input(
  props: React.InputHTMLAttributes<HTMLInputElement>
): JSX.Element {
  return (
    <input
      type="text"
      {...props}
      className={cn(
        'h-9 w-full rounded-md border border-border/60 bg-background/60 px-3 text-sm outline-none transition-colors',
        'placeholder:text-muted-foreground/60',
        'focus:border-brand/40 focus:bg-background',
        props.className
      )}
    />
  )
}

function Select(
  props: React.SelectHTMLAttributes<HTMLSelectElement>
): JSX.Element {
  return (
    <select
      {...props}
      className={cn(
        'h-9 w-full rounded-md border border-border/60 bg-background/60 px-2 text-sm outline-none transition-colors',
        'focus:border-brand/40 focus:bg-background',
        props.className
      )}
    />
  )
}

type AutosaveStatusKind = 'idle' | 'pending' | 'saving' | 'saved' | 'error'

function AutosaveStatus({
  status,
  error
}: {
  status: AutosaveStatusKind
  error: string | null
}): JSX.Element | null {
  if (status === 'idle') return null

  // After the idle guard above, TS narrows status to the remaining 4.
  const map: Record<
    Exclude<AutosaveStatusKind, 'idle'>,
    { label: string; tone: 'neutral' | 'brand' | 'outline'; dot: string }
  > = {
    pending: { label: 'Unsaved', tone: 'outline', dot: 'bg-muted-foreground/50' },
    saving: { label: 'Saving…', tone: 'brand', dot: 'bg-brand animate-pulse' },
    saved: { label: 'Saved', tone: 'neutral', dot: 'bg-brand/70' },
    error: { label: error ? `Error: ${error}` : 'Error', tone: 'neutral', dot: 'bg-destructive' }
  }
  const { label, tone, dot } = map[status]

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider',
        tone === 'brand'
          ? 'border-brand/30 bg-brand/10 text-brand'
          : 'border-border/60 text-muted-foreground'
      )}
    >
      <span className={cn('inline-block h-1.5 w-1.5 rounded-full', dot)} />
      {label}
    </span>
  )
}

function Field({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-baseline justify-between text-[11px] font-medium text-muted-foreground">
        <span>{label}</span>
        {hint && <span className="text-[10px] opacity-70">{hint}</span>}
      </span>
      {children}
    </label>
  )
}

/**
 * ThemeOverrideSection — collapsible block that toggles a per-song
 * theme override on/off and lets the operator edit it in place.
 *
 * Interaction model:
 *   - If override is null, show a single "Override global theme" button.
 *     Clicking seeds an EMPTY override ({}) so nothing changes
 *     immediately but the form appears, ready for edits.
 *   - If override is non-null, show a live preview panel (SlideRenderer
 *     displaying the song's first slide styled with the effective
 *     theme, so font/color/background tweaks are visible the instant
 *     the operator makes them — this is what makes override editing
 *     feel trustworthy) plus the ThemeFields form plus a "Remove
 *     override" link that sets override back to null.
 *
 * When the user changes a field, we spread the patch into the current
 * override so previously-inherited fields only switch to custom when
 * they're actually edited. This matches the partial-override semantics
 * of the underlying ThemeOverride type: unset fields inherit.
 *
 * One subtlety: the ThemeFields component receives a FULL Theme (the
 * merged effective value) so every control shows a sensible default.
 * We translate its onChange patches back into override-space by only
 * keeping the changed fields, then merging into the existing override.
 */
function ThemeOverrideSection({
  override,
  globalTheme,
  onChange,
  previewPayload
}: {
  override: ThemeOverride | null
  globalTheme: Theme
  onChange: (next: ThemeOverride | null) => void
  previewPayload: SlidePayload
}): JSX.Element {
  const isActive = override !== null
  // Effective theme for display: merge override on top of global using
  // the same null-stripping helper the runtime consumers use, so the
  // editor preview matches what the projector will actually show.
  const effective: Theme = mergeThemeOverride(globalTheme, override)

  const handleFieldChange = (patch: Partial<Theme>): void => {
    // Strip id/name — those don't belong in an override
    const { id: _id, name: _name, ...rest } = patch
    void _id
    void _name
    // Build the new override and DROP any fields that ended up null /
    // undefined — those represent "clear this override row, inherit
    // from global", not "force null on the projector". Without this
    // step a media row's "clear" button would silently kill the
    // global background image whenever this song was live.
    const merged: Record<string, unknown> = { ...(override ?? {}), ...rest }
    const cleaned: ThemeOverride = {}
    for (const [key, value] of Object.entries(merged)) {
      if (value !== null && value !== undefined) {
        ;(cleaned as Record<string, unknown>)[key] = value
      }
    }
    onChange(cleaned)
  }

  return (
    <section className="mt-2 rounded-lg border border-dashed border-border/60 p-4">
      <div className="mb-2 flex items-center justify-between">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Theme override
          </h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground/70">
            {isActive
              ? 'Fields here override the global theme only when this song is live.'
              : 'This song currently uses the global theme from Settings.'}
          </p>
        </div>
        {isActive ? (
          <button
            onClick={() => onChange(null)}
            className="text-[11px] text-red-500 hover:underline"
          >
            Remove override
          </button>
        ) : (
          <button
            onClick={() => onChange({})}
            className="rounded-md border border-border/60 bg-background px-2 py-1 text-[11px] hover:border-border"
          >
            Override global theme
          </button>
        )}
      </div>

      {isActive && (
        <div className="mt-3 space-y-4">
          {/* Live preview — a miniature SlideRenderer showing the
              song's first slide styled with the effective (global +
              override) theme. Matches what the projector will actually
              render, so the operator can tweak font/background/color
              and see the result without flipping between windows.
              Aspect ratio locked to 16:9 to match a typical projector. */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-brand/80">
                Live preview
              </span>
              <span className="text-[10px] text-muted-foreground/60">
                Reflects every change instantly
              </span>
            </div>
            <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-border/60 shadow-[0_16px_40px_-28px_hsl(var(--brand)/0.5)]">
              <SlideRenderer
                payload={previewPayload}
                mode="live"
                theme={effective}
                animate={false}
              />
            </div>
          </div>

          <ThemeFields theme={effective} onChange={handleFieldChange} />
        </div>
      )}
    </section>
  )
}
