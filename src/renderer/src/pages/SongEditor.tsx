/**
 * SongEditor — three columns, modelled on writing tools with an outline
 * (Craft, Grain) and slide editors with a live canvas (Figma Slides):
 *
 *   Sections  the song's [Section]s with slide counts; click to jump,
 *             drag to reorder, add a section.
 *   Lyrics    the plain-text source of truth, with slide numbers in the
 *             gutter, dashed rules at automatic max-lines splits and the
 *             cursor's slide highlighted (see LyricsEditor).
 *   Panel     Preview (the cursor's slide, large, plus every slide),
 *             Details, Look (theme override), Notes.
 *
 * The title and author are edited in place in the header.
 *
 * Autosave flow:
 *   1. User types → local draft updates immediately (zero lag)
 *   2. useAutosave debounces for 500ms, then calls window.api.songs.update
 *   3. Main process re-parses rawText and writes atomically
 *   4. Updated song lands back in the library store
 *
 * Slide numbering comes from `layoutLyrics`, which walks the text with the
 * parser's rules and splits with the same `splitBalanced` as the projector
 * path, so "slide 5" here is slide 5 in Service Mode.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { SetlistItem, Song, SongLanguage, Theme, ThemeOverride } from '@shared/types'
import type { UpdateSongPatch } from '@shared/ipc-contract'
import { useLibraryStore } from '../stores/useLibraryStore'
import { useSetlistStore } from '../stores/useSetlistStore'
import {
  itemsWithoutSong,
  pickHero,
  setlistsUsingSong,
  songDeleteConfirmText
} from '../lib/setlist-helpers'
import { useSettingsStore } from '../stores/useSettingsStore'
import { useThemeStore } from '../stores/useThemeStore'
import { useAutosave } from '../hooks/useAutosave'
import { mergeThemeOverride } from '../lib/themeOverride'
import { layoutLyrics, slideAtLine } from '../lib/lyricsLayout'
import { moveSection } from '../lib/lyricsEdit'
import type { TidyResult } from '../lib/tidyLyrics'
import { LyricsEditor, type LyricsEditorHandle } from '../components/song/LyricsEditor'
import { SectionOutline } from '../components/song/SectionOutline'
import { SongSidePanel, type SongDetails } from '../components/song/SongSidePanel'
import { Button } from '../components/ui/Button'
import { PageHeader } from '../components/ui/PageHeader'
import { SaveStatePill } from '../components/ui/SaveStatePill'
import { CheckIcon, PlusIcon, TrashIcon } from '../components/icons'

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

  return (
    <SongEditorView
      id={id}
      draft={draft}
      patch={patch}
      status={status}
      error={error}
      maxLines={settings?.maxLinesPerSlide ?? 4}
      globalTheme={globalTheme}
      onDelete={async () => {
        // main's deleteSong only unlinks the file and slideify drops song
        // items whose song is gone, so deleting a song silently removed it
        // from every service using it. Re-read setlists from disk (an
        // editor may have just autosaved), name them in the confirm, and
        // remove the song's items from them before deleting the song.
        const setlistStore = useSetlistStore.getState()
        await setlistStore.load()
        const { setlists, error: loadError } = useSetlistStore.getState()
        if (loadError) {
          window.alert(`Couldn't check which services use this song: ${loadError}`)
          return
        }
        const usedIn = setlistsUsingSong(setlists, id)
        const ok = window.confirm(
          songDeleteConfirmText(draft.title.trim() || 'Untitled Song', usedIn)
        )
        if (!ok) return
        try {
          for (const s of usedIn) {
            await setlistStore.update(s.id, { items: itemsWithoutSong(s.items, id) })
          }
          // Drop any pending autosave so it can't race the delete (or
          // fire on unmount) and write the song back to disk.
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
      }}
    />
  )
}

// ─── Layout ─────────────────────────────────────────────────────────

/** Breadcrumb back to the library — also on the loading/error states so
 * the operator is never stranded without a way out. */
const BACK = { to: '/library', label: 'Songs' }

function genItemId(): string {
  return `item-${Math.random().toString(36).slice(2, 10)}`
}

function SongEditorView({
  id,
  draft,
  patch,
  status,
  error,
  maxLines,
  globalTheme,
  onDelete
}: {
  id: string
  draft: Draft
  patch: (changes: Partial<Draft>) => void
  status: Parameters<typeof SaveStatePill>[0]['status']
  error: string | null
  maxLines: number
  globalTheme: Theme | null
  onDelete: () => void
}): JSX.Element {
  const editor = useRef<LyricsEditorHandle>(null)
  const [caretLine, setCaretLine] = useState(0)

  const layout = useMemo(() => layoutLyrics(draft.rawText, maxLines), [draft.rawText, maxLines])
  const currentSlide = slideAtLine(layout, caretLine)
  const currentSection = layout.lines[caretLine]?.section ?? null

  // Effective theme: global merged with THIS SONG'S DRAFT override, so
  // Look-tab edits show in the preview immediately.
  const effectiveTheme: Theme | null = globalTheme
    ? mergeThemeOverride(globalTheme, draft.themeOverride)
    : null

  const details: SongDetails = {
    ccli: draft.ccli,
    copyright: draft.copyright,
    year: draft.year,
    language: draft.language,
    categories: draft.categories,
    notes: draft.notes
  }

  // Fill CCLI / copyright from a tidied paste, without overwriting.
  const onTidied = (result: TidyResult): void => {
    const changes: Partial<Draft> = {}
    if (result.ccli && !draft.ccli.trim()) changes.ccli = result.ccli
    if (result.copyright && !draft.copyright.trim()) changes.copyright = result.copyright
    if (Object.keys(changes).length > 0) patch(changes)
  }

  // A brand-new song: put the cursor in the title, ready to type over it.
  const titleInput = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (draft.rawText === '' && draft.title === 'Untitled Song') {
      titleInput.current?.focus()
      titleInput.current?.select()
    }
    // Only on first mount of this song.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const slideCount = layout.slides.length

  return (
    <div className="flex h-full w-full min-h-0 flex-col text-foreground">
      <header className="flex shrink-0 items-end gap-4 border-b border-rule px-7 pb-3.5 pt-5">
        <div className="min-w-0 flex-1">
          <Link
            to={BACK.to}
            className="mb-1 inline-flex items-center gap-1 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <span aria-hidden="true">←</span> {BACK.label}
          </Link>
          <input
            ref={titleInput}
            aria-label="Song title"
            value={draft.title}
            onChange={(e) => patch({ title: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                editor.current?.focusLine(0)
              }
            }}
            placeholder="Song title"
            className="-ml-1.5 block w-full truncate rounded-md bg-transparent px-1.5 text-[26px] font-semibold leading-tight tracking-[-0.02em] text-foreground placeholder:text-dim hover:bg-raised/60 focus:bg-raised focus:outline-none"
          />
          <div className="mt-1 flex items-center gap-2 text-[13.5px] text-soft">
            {/* Grows with its text: an invisible copy sizes the grid cell. */}
            <span className="-ml-1.5 inline-grid">
              <span aria-hidden="true" className="invisible col-start-1 row-start-1 whitespace-pre px-1.5 py-0.5">
                {draft.author || 'Add author'}
              </span>
              <input
                aria-label="Author"
                value={draft.author}
                onChange={(e) => patch({ author: e.target.value })}
                placeholder="Add author"
                size={1}
                className="col-start-1 row-start-1 w-full min-w-0 rounded-md bg-transparent px-1.5 py-0.5 text-soft placeholder:text-dim hover:bg-raised/60 focus:bg-raised focus:text-foreground focus:outline-none"
              />
            </span>
            <span aria-hidden="true" className="text-muted-foreground">·</span>
            <span className="tabular-nums">
              {slideCount === 0
                ? 'No lyrics yet'
                : `${slideCount} slide${slideCount === 1 ? '' : 's'} · ${layout.sections.length} section${layout.sections.length === 1 ? '' : 's'}`}
            </span>
            <SaveStatePill status={status} error={error} />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <AddToNextService songId={id} />
          <Button type="button" variant="ghost" size="md" onClick={onDelete} className="hover:bg-live/10 hover:text-live">
            <TrashIcon size={15} />
            Delete
          </Button>
        </div>
      </header>

      {/* Side columns give way first on smaller windows so the lyrics
          keep a comfortable line length. */}
      <div className="grid min-h-0 flex-1 grid-cols-[172px_minmax(0,1fr)_300px] xl:grid-cols-[192px_minmax(0,1fr)_350px] 2xl:grid-cols-[208px_minmax(0,1fr)_400px]">
        <SectionOutline
          layout={layout}
          currentSection={currentSection}
          onJump={(i) => editor.current?.focusLine(layout.sections[i].startLine)}
          onAdd={(kind) => editor.current?.insertSection(kind)}
          onMove={(from, to) => {
            const next = moveSection(draft.rawText, layout, from, to)
            if (next !== draft.rawText) editor.current?.replaceAll(next)
          }}
        />

        <LyricsEditor
          ref={editor}
          value={draft.rawText}
          onChange={(rawText) => patch({ rawText })}
          layout={layout}
          maxLines={maxLines}
          currentSlide={currentSlide}
          onCaretLine={setCaretLine}
          onTidied={onTidied}
        />

        <SongSidePanel
          layout={layout}
          currentSlide={currentSlide}
          onSelectSlide={(i) => {
            const slide = layout.slides[i]
            if (slide) editor.current?.focusLine(slide.firstLine)
          }}
          theme={effectiveTheme}
          globalTheme={globalTheme}
          themeOverride={draft.themeOverride}
          onThemeOverride={(next) => patch({ themeOverride: next })}
          details={details}
          onDetails={(changes) => patch(changes)}
          maxLines={maxLines}
        />
      </div>
    </div>
  )
}

/**
 * "Add to {next service}" — the same setlist the Songs page targets
 * (pickHero). Shows "In {name}" once added; clicking again removes it.
 */
function AddToNextService({ songId }: { songId: string }): JSX.Element | null {
  const setlists = useSetlistStore((s) => s.setlists)
  const load = useSetlistStore((s) => s.load)
  const update = useSetlistStore((s) => s.update)
  useEffect(() => {
    if (setlists.length === 0) void load()
  }, [setlists.length, load])

  const hero = pickHero(setlists)
  if (!hero) return null
  const isMember = hero.items.some((i) => i.kind === 'song' && i.songId === songId)
  const name = hero.name || 'next service'

  const toggle = async (): Promise<void> => {
    const items: SetlistItem[] = isMember
      ? hero.items.filter((i) => !(i.kind === 'song' && i.songId === songId))
      : [...hero.items, { kind: 'song', id: genItemId(), songId }]
    await update(hero.id, { items })
  }

  return (
    <Button
      type="button"
      variant="secondary"
      size="md"
      onClick={() => void toggle()}
      title={isMember ? `Remove from ${name}` : `Add to the end of ${name}`}
      className="max-w-[260px]"
    >
      {isMember ? <CheckIcon size={15} className="text-ok" /> : <PlusIcon size={15} />}
      <span className="truncate">{isMember ? `In ${name}` : `Add to ${name}`}</span>
    </Button>
  )
}
