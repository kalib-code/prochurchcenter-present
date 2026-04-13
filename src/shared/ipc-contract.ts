/**
 * Present — IPC contract
 *
 * This file is the single source of truth for every IPC call between
 * the renderer and the main process. The preload exposes `window.api`
 * that implements PresentApi; the main process registers handlers keyed
 * by the CHANNELS strings.
 *
 * Phase 1 covers: songs, setlists, settings, theme.
 * Phase 4 adds: output (slide broadcasting to the output window).
 * Later phases add: bible (Phase 6), license (Phase 8),
 * backup (Phase 9), updater (Phase 10).
 */

import type {
  Song,
  Setlist,
  Theme,
  Settings,
  SongLanguage,
  ThemeOverride,
  BibleBookMeta,
  BibleLookupResult,
  BibleTranslationMeta,
  BibleVerse
} from './types'

// ─────────────────────────────────────────────────────────────────────────────
// Output slide payload — what the output window renders at any given moment
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What the output window is currently displaying. 'live' means the current
 * slide; 'black' is a total blackout (no logo, no text); 'logo' shows the
 * configured standby image.
 */
export type OutputMode = 'live' | 'black' | 'logo'

/**
 * Live playback controls for the currently-active video slide. Shared
 * between the operator (confidence monitor) and the output window so
 * pause/mute stays in sync across both displays. Resets to
 * { paused: false, muted: false } whenever the active slide changes.
 */
export interface VideoControl {
  paused: boolean
  muted: boolean
}

/**
 * A single renderable slide. The output window never sees a Song or a
 * SetlistItem — just these flat payloads. Keeps the output view dumb and
 * future-proof (same contract for Bible, images, countdown).
 */
export type SlidePayload =
  | {
      kind: 'text'
      /** Each string is one line to render */
      lines: string[]
      /** Optional breadcrumb ("Verse 1", "John 3:16") — operator UI only */
      sectionLabel?: string
    }
  | {
      kind: 'image'
      imagePath: string
      caption?: string
    }
  | {
      kind: 'countdown'
      label: string
      /** ISO timestamp */
      targetTime: string
    }
  | {
      /**
       * One page of a PDF deck. The renderer rasterizes via pdf.js to a
       * canvas sized to the container. Multiple pdf-page slides within
       * one deck item share a cached PDFDocumentProxy keyed by pdfPath.
       */
      kind: 'pdf-page'
      pdfPath: string
      /** 1-based page number — matches pdf.js getPage() semantics */
      pageIndex: number
      pageCount: number
    }
  | {
      /**
       * Foreground video slide. Plays once with audio on the output
       * window; confidence monitor renders the same source muted.
       */
      kind: 'video'
      videoPath: string
      title?: string
    }

// ─────────────────────────────────────────────────────────────────────────────
// Input shapes (what the renderer sends over IPC)
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateSongInput {
  title: string
  author?: string | null
  ccli?: string | null
  copyright?: string | null
  year?: number | null
  language?: SongLanguage
  categories?: string[]
  rawText: string
  notes?: string
}

export type UpdateSongPatch = Partial<
  Pick<
    Song,
    | 'title'
    | 'author'
    | 'ccli'
    | 'copyright'
    | 'year'
    | 'language'
    | 'categories'
    | 'rawText'
    | 'notes'
    | 'themeOverride'
  >
>

export interface CreateSetlistInput {
  name: string
  date: string
}

export type UpdateSetlistPatch = Partial<Pick<Setlist, 'name' | 'date' | 'items'>>

export type UpdateThemePatch = Partial<Omit<Theme, 'id'>>

export type UpdateSettingsPatch = Partial<Settings>

/**
 * File-picker filter preset. `media` is the superset used when we don't
 * care which kind the user picks (e.g., a single "choose background"
 * action that accepts either an image or a video). `pdf` is used by
 * the Deck setlist item, which accepts PDFs exported from PowerPoint,
 * Keynote, Google Slides, or LibreOffice Impress.
 */
export type PickFileKind = 'image' | 'video' | 'media' | 'pdf'

// ─────────────────────────────────────────────────────────────────────────────
// PresentApi — the surface exposed on `window.api`
// ─────────────────────────────────────────────────────────────────────────────

export interface PresentApi {
  songs: {
    list(): Promise<Song[]>
    get(id: string): Promise<Song | null>
    create(input: CreateSongInput): Promise<Song>
    update(id: string, patch: UpdateSongPatch): Promise<Song>
    delete(id: string): Promise<void>
    exportText(id: string): Promise<string>
  }

  setlists: {
    list(): Promise<Setlist[]>
    get(id: string): Promise<Setlist | null>
    create(input: CreateSetlistInput): Promise<Setlist>
    update(id: string, patch: UpdateSetlistPatch): Promise<Setlist>
    delete(id: string): Promise<void>
    clone(sourceId: string, newName: string, newDate: string): Promise<Setlist>
  }

  theme: {
    list(): Promise<Theme[]>
    get(id: string): Promise<Theme | null>
    update(id: string, patch: UpdateThemePatch): Promise<Theme>
    /**
     * Output-window subscription — fires whenever any theme is updated.
     * The output window uses this to re-render when the operator tweaks
     * colors/fonts in Settings. Returns an unsubscribe function.
     */
    onChange(callback: (theme: Theme) => void): () => void
  }

  settings: {
    get(): Promise<Settings>
    update(patch: UpdateSettingsPatch): Promise<Settings>
  }

  dialog: {
    /**
     * Open a native file picker. Returns the absolute file path or null
     * if the user cancelled. Never throws.
     */
    pickFile(kind: PickFileKind): Promise<string | null>
  }

  bible: {
    /**
     * List all translations available from helloao. Cached on disk
     * after the first successful fetch — call is instant after that.
     */
    listTranslations(): Promise<BibleTranslationMeta[]>
    /** List the books of a given translation. Cached per translation. */
    listBooks(translationId: string): Promise<BibleBookMeta[]>
    /** Fetch (or read cached) verses for a single chapter. */
    getChapter(
      translationId: string,
      bookId: string,
      chapter: number
    ): Promise<BibleVerse[]>
    /**
     * Parse a free-form reference like "John 3:16-18" and return the
     * matching verses. Returns a discriminated union so the renderer
     * can render either the result or a friendly error inline without
     * try/catch.
     */
    lookup(
      translationId: string,
      reference: string
    ): Promise<BibleLookupResult>
  }

  output: {
    /** Send a new slide to the output window. Fire-and-forget. */
    setSlide(payload: SlidePayload): Promise<void>
    /** Switch the output window to a blackout. */
    setBlack(): Promise<void>
    /** Switch the output window to the configured logo image. */
    setLogo(): Promise<void>
    /** Switch back to showing the last-sent slide. */
    setLive(): Promise<void>
    /**
     * Push the current item's theme override (or null to clear) to the
     * output window. Called by the service store on every item change
     * so the projector can re-merge with the active global theme.
     */
    setItemThemeOverride(override: ThemeOverride | null): Promise<void>
    /**
     * Push pause/mute state for the active video slide to the output
     * window. Called on toggle AND on every slide change so a new
     * video always starts from a clean (playing, unmuted) baseline.
     */
    setVideoControl(control: VideoControl): Promise<void>
    /** List available displays for the output-display picker. */
    listDisplays(): Promise<{ id: number; label: string; primary: boolean }[]>
    /**
     * Move the output window to a given display. Phase 5 implements this;
     * Phase 4 registers the handler as a no-op so calls don't crash.
     */
    setDisplay(displayId: number | null): Promise<void>

    // ── Output-window-only subscriptions ──────────────────────────────────
    // These live on window.api inside the OUTPUT renderer so it can react
    // to main-process broadcasts. Returns an unsubscribe function.

    /** Subscribe to slide updates. Output window only. */
    onSlide(callback: (payload: SlidePayload) => void): () => void
    /** Subscribe to mode changes (live/black/logo). Output window only. */
    onMode(callback: (mode: OutputMode) => void): () => void
    /**
     * Subscribe to per-item theme override changes. Output window only.
     * The payload is either a partial theme (spread over the global) or
     * null (no override — render with the pristine global theme).
     */
    onItemThemeOverride(
      callback: (override: ThemeOverride | null) => void
    ): () => void
    /**
     * Subscribe to video control (pause/mute) updates. Output window
     * only. Fires on every toggle AND on slide changes.
     */
    onVideoControl(callback: (control: VideoControl) => void): () => void
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CHANNELS — wire-format channel names
// ─────────────────────────────────────────────────────────────────────────────

export const CHANNELS = {
  songs: {
    list: 'songs:list',
    get: 'songs:get',
    create: 'songs:create',
    update: 'songs:update',
    delete: 'songs:delete',
    exportText: 'songs:exportText'
  },
  setlists: {
    list: 'setlists:list',
    get: 'setlists:get',
    create: 'setlists:create',
    update: 'setlists:update',
    delete: 'setlists:delete',
    clone: 'setlists:clone'
  },
  theme: {
    list: 'theme:list',
    get: 'theme:get',
    update: 'theme:update',
    // Event broadcast from main -> output window on any theme update
    eventChange: 'theme:event:change'
  },
  settings: {
    get: 'settings:get',
    update: 'settings:update'
  },
  dialog: {
    pickFile: 'dialog:pickFile'
  },
  bible: {
    listTranslations: 'bible:listTranslations',
    listBooks: 'bible:listBooks',
    getChapter: 'bible:getChapter',
    lookup: 'bible:lookup'
  },
  output: {
    setSlide: 'output:setSlide',
    setBlack: 'output:setBlack',
    setLogo: 'output:setLogo',
    setLive: 'output:setLive',
    setItemThemeOverride: 'output:setItemThemeOverride',
    setVideoControl: 'output:setVideoControl',
    listDisplays: 'output:listDisplays',
    setDisplay: 'output:setDisplay',
    // Events broadcast from main -> output window
    eventSlide: 'output:event:slide',
    eventMode: 'output:event:mode',
    eventItemThemeOverride: 'output:event:itemThemeOverride',
    eventVideoControl: 'output:event:videoControl'
  }
} as const
