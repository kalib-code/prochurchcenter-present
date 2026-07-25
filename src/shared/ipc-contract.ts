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
 * backup (Phase 9 — implemented post-v0.1.1), updater (Phase 10).
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
 * Visual theme for the lower thirds graphic. Bundled into every
 * LowerThirdsContent broadcast so settings changes propagate
 * instantly to the chroma-key window without needing to re-create
 * the BrowserWindow.
 */
export interface LowerThirdsTheme {
  fontSize: number // px
  textColor: string // hex
  boxColor: string // hex (graphic box background)
  boxOpacity: number // 0–100; 0 = no box, only text on chroma
  textEffect: 'none' | 'shadow' | 'outline'
}

/**
 * Lower thirds content shown to OBS via the chroma-key window.
 * `visible: false` clears the lower third regardless of the other
 * fields, so the operator can hide quickly without having to clear
 * inputs first. `subtitle` is empty string (not undefined) so the
 * payload shape stays stable across the IPC boundary.
 *
 * `theme` is optional only because the in-memory cache in main
 * starts with a default-shaped LowerThirdsContent before any
 * operator broadcast has happened — when present (which is on every
 * actual operator push), it carries the live appearance settings.
 */
export interface LowerThirdsContent {
  visible: boolean
  title: string
  subtitle: string
  theme?: LowerThirdsTheme
}

/**
 * Rich context broadcast from the operator to the stage monitor on
 * every slide change. Carries everything the speaker-facing view
 * needs to render its ProPresenter-style layout — current + next
 * slide, item notes, slide-progress label — without the stage
 * monitor needing access to the operator's setlist or library
 * stores.
 *
 * `nextSlide` is null when the active slide is the last in its item;
 * the stage monitor then either shows nothing in the "next" slot or
 * renders an "End of section" placeholder. `notes` is empty string
 * (not undefined) so the payload shape stays stable.
 */
export interface StageContext {
  currentSlide: SlidePayload | null
  nextSlide: SlidePayload | null
  itemLabel: string
  slideIndex: number // 0-based, matches operator state
  totalSlides: number
  notes: string
}

/**
 * Authoritative video position update sent from the OUTPUT window to
 * the operator confidence monitor so two independent <video> elements
 * playing the same source stay in sync.
 *
 * The pattern (matching FreeShow's BackgroundMedia.svelte 220ms / 0.5s
 * snap parameters): output's <video> emits `timeupdate` events ~4x/sec,
 * each one becomes a VideoTimeUpdate broadcast. The operator subscribes
 * and only nudges its local video when |local - remote| > 0.5s — below
 * that the drift is invisible at thumbnail size and snapping every
 * frame would cause visible micro-stutters.
 *
 * `paused` is included so the operator can also re-align after a
 * pause/play state change (timeupdate doesn't fire while paused).
 */
export interface VideoTimeUpdate {
  videoPath: string
  currentTime: number
  /**
   * Total length in seconds, read straight from the output <video>
   * element's `duration` property. Required (not optional) so an emit
   * site can never silently omit it — an optional field would let the
   * consumer's "confidence monitor" runway readout ("advances in
   * 0:32") mistake "not sent" for "not loaded yet".
   *
   * `HTMLMediaElement.duration` is `NaN` until the browser has loaded
   * the video's metadata, and can be `Infinity` for a stream — both
   * are passed through as-is, never coerced to 0 (0 would lie: it
   * reads as "already finished" rather than "not loaded yet").
   * Consumers MUST guard with `Number.isFinite(duration)` before doing
   * arithmetic on it; `duration - currentTime` on a `NaN` duration
   * renders "advances in NaN:NaN" on a live display.
   */
  duration: number
  paused: boolean
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
       * Foreground video slide. Plays with audio on the output window;
       * the confidence monitor mirrors the output via desktopCapturer
       * (Option C — see VideoSlideOperator in SlideRenderer.tsx).
       *
       * loop=true (default): plays continuously until the operator
       *   manually advances. Used for things like worship visuals or
       *   ambient pre-service loops.
       * loop=false: plays once, then auto-advances to the next setlist
       *   item via the eventVideoEnded broadcast. Used for sermon
       *   bumpers and other fixed-length transition videos.
       */
      kind: 'video'
      videoPath: string
      title?: string
      loop?: boolean
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

export type UpdateSetlistPatch = Partial<
  Pick<Setlist, 'name' | 'date' | 'items' | 'startTime'>
>

export type UpdateThemePatch = Partial<Omit<Theme, 'id'>>

export type UpdateSettingsPatch = Partial<Settings>

/**
 * File-picker filter preset. `media` is the superset used when we don't
 * care which kind the user picks (e.g., a single "choose background"
 * action that accepts either an image or a video). `pdf` is used by
 * the Deck setlist item, which accepts PDFs exported from PowerPoint,
 * Keynote, Google Slides, or LibreOffice Impress.
 */
export type PickFileKind = 'image' | 'video' | 'media' | 'pdf' | 'font'

// ─────────────────────────────────────────────────────────────────────────────
// Backup (library export / import / restore)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A single backup zip discovered in the (hidden) backups directory.
 * The renderer uses this to render the Restore list. `manifest` is
 * null when a zip is corrupt — the UI should grey those rows out
 * rather than let the user try to restore from them.
 */
export interface BackupListEntry {
  filename: string
  absolutePath: string
  sizeBytes: number
  createdAt: string
  manifest: {
    version: 1
    createdAt: string
    appVersion: string
    counts: { songs: number; setlists: number; themes: number }
  } | null
}

/**
 * Result returned when an import succeeds. `safetyBackupPath` is the
 * auto-snapshot taken immediately before the import was applied — the
 * UI surfaces this so the user has an obvious "undo this import" path.
 */
export interface BackupImportResult {
  imported: { songs: number; setlists: number; themes: number }
  safetyBackupPath: string
}

/**
 * Merge: files in the zip are written over any same-id file locally,
 * everything else is preserved. Replace: wipe library/themes/fonts/
 * media first, then extract.
 */
export type BackupImportMode = 'merge' | 'replace'

// ─────────────────────────────────────────────────────────────────────────────
// Auto-update (manual "Check for updates" surface)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Result of a manual update check triggered from Settings. The `dev`
 * branch exists so the UI can surface "auto-update is off in dev"
 * cleanly instead of pretending the check ran. The `error` branch
 * carries the message so the UI can show a real diagnostic (network
 * down, release feed unreachable, etc.) rather than a generic fail.
 */
export type ManualUpdateCheckResult =
  | { status: 'up-to-date'; currentVersion: string }
  | { status: 'update-available'; currentVersion: string; newVersion: string }
  | { status: 'error'; message: string }
  | { status: 'dev'; currentVersion: string }

/**
 * A user-uploaded custom font. `family` is what gets persisted into
 * a theme's fontFamily property; `filename` is the on-disk filename
 * inside the userData/fonts/ directory (renderer constructs the full
 * URL via the present-media:// protocol).
 */
export interface CustomFontEntry {
  family: string
  filename: string
  /** Absolute path to the file — convenient for the renderer's @font-face src. */
  absolutePath: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Pre-flight (Home readiness checks)
//
// Four things break Sunday: the projector is on the wrong display, macOS
// Screen Recording is off so the confidence monitor is black, a media file
// moved since it was added, or there is no recent backup. Pre-flight surfaces
// all four on Saturday night with the remedy attached.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What the operator can do about a failing check.
 *   'external' — `target` is a URL opened via shell.openExternal, e.g. the
 *                macOS Screen Recording privacy pane.
 *   'in-app'   — `target` is a renderer route, e.g. "/settings".
 */
export interface PreflightRemedy {
  label: string
  kind: 'external' | 'in-app'
  target: string
}

export interface PreflightCheck {
  id: 'display' | 'screenRecording' | 'media' | 'backup'
  status: 'ready' | 'warning'
  /** Short name, e.g. "Screen Recording" */
  name: string
  /** One-sentence explanation with the specific numbers filled in. */
  detail: string
  remedy?: PreflightRemedy
}

export interface PreflightReport {
  /**
   * Checks that APPLY on this platform. The screenRecording check is
   * macOS-only and is omitted entirely elsewhere, rather than emitting a
   * misleading disabled row — so consumers must never assume length 4.
   */
  checks: PreflightCheck[]
  /** ISO timestamp of when the report was produced. */
  checkedAt: string
}

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

  /**
   * Readiness checks surfaced on Home. `setlistId` is nullable so Home can
   * ask before any setlist exists; the media check is then omitted.
   */
  system: {
    getPreflight(setlistId: string | null): Promise<PreflightReport>
    /** Open a remedy's target. Routes through shell.openExternal. */
    openExternal(url: string): Promise<void>
  }

  /** Read-only existence probe. Used by pre-flight and the setlist editor. */
  files: {
    checkExists(paths: string[]): Promise<Record<string, boolean>>
  }

  dialog: {
    /**
     * Open a native file picker. Returns the absolute file path or null
     * if the user cancelled. Never throws.
     */
    pickFile(kind: PickFileKind): Promise<string | null>
  }

  /**
   * Custom font management. Volunteers pick a TTF/OTF/WOFF/WOFF2 file
   * from disk; we copy it into userData/fonts/ for stable storage and
   * surface it in the theme font picker alongside system + bundled
   * fonts. Persisted fonts survive app reinstalls / settings resets
   * because they live next to (not inside) settings.json.
   */
  fonts: {
    list(): Promise<CustomFontEntry[]>
    /**
     * Open the native font file picker, copy the selection into
     * userData/fonts/, and return the resulting entry. Returns null
     * if the user cancelled the picker.
     */
    upload(): Promise<CustomFontEntry | null>
    delete(family: string): Promise<void>
  }

  /**
   * Auto-update surface. The background check + "Restart now?" dialog
   * are wired from main/updater.ts and don't need renderer
   * involvement. These calls exist solely for the manual "Check for
   * updates" UX in Settings → About.
   */
  updater: {
    /** Current packaged app version (e.g., "0.1.1"). */
    getVersion(): Promise<string>
    /**
     * Trigger an on-demand update check. Returns a discriminated
     * union describing what happened — the UI uses this to show
     * "up to date", "downloading v0.1.2", or an error message.
     */
    checkNow(): Promise<ManualUpdateCheckResult>
  }

  /**
   * Backup surface — library export, import, restore, and the auto-
   * backup status readout. Every call operates on the hidden backups
   * directory under userData/backups/ (not user-visible in Finder).
   * The renderer never handles file paths directly for export — the
   * main process picks the timestamped filename and returns the result.
   */
  backup: {
    /**
     * Write a new backup zip immediately. Returns the list entry for
     * the just-created backup so the UI can show "Backup created at
     * 9:32 AM" without re-listing.
     */
    exportNow(): Promise<BackupListEntry>
    /** List every backup zip, newest first. */
    list(): Promise<BackupListEntry[]>
    /**
     * Restore from a backup zip. `absolutePath` must be one returned
     * by `list()` — we don't accept arbitrary paths from the renderer
     * to keep the blast radius small. Always writes a pre-import
     * safety snapshot first.
     */
    restore(
      absolutePath: string,
      mode: BackupImportMode
    ): Promise<BackupImportResult>
    /** Delete a backup zip. Used by the "trash" action in the list. */
    delete(absolutePath: string): Promise<void>
    /** Open the hidden backups folder in Finder/Explorer. */
    openFolder(): Promise<void>
    /**
     * Import from a user-picked zip (file picker). Used for "restore
     * from a zip someone sent me" — versus `restore()` which restores
     * from one of our own managed backups.
     */
    importFromFile(mode: BackupImportMode): Promise<BackupImportResult | null>
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
    /**
     * Push rich stage-monitor context (current + next slide, item
     * notes, slide progress) to the stage monitor window. Called
     * from the operator on every slide change. Cached in main so
     * the stage monitor recovers the right state on hot reload.
     */
    setStageContext(context: StageContext): Promise<void>
    /**
     * Push the OUTPUT window's authoritative video playback position
     * to the operator confidence monitor. Called from the output
     * renderer's <video> element on `timeupdate` / `seeked` /
     * `play` / `pause` events. Operator subscribes via
     * onVideoTimeUpdate and snaps its local video when drift > 500ms.
     */
    setVideoTimeUpdate(update: VideoTimeUpdate): Promise<void>
    /**
     * Notify the operator that a non-looping video has finished
     * playing. Called once from the output renderer's `ended` event
     * handler. The operator subscribes via onVideoEnded and advances
     * the setlist to the next item.
     *
     * Carries `videoPath` so the operator can validate the event
     * matches the slide that's currently active — guards against
     * race conditions where the operator manually advanced past the
     * video before its `ended` event arrived.
     */
    setVideoEnded(payload: { videoPath: string }): Promise<void>
    /**
     * Return the desktopCapturer source id for the output window so the
     * operator renderer can mirror its pixels via getUserMedia with a
     * `chromeMediaSource: 'desktop'` constraint. Used by the confidence
     * monitor's VideoSlide to avoid independent-clock drift between two
     * `<video>` elements decoding the same file.
     *
     * Returns null if the output window doesn't exist yet, or if the
     * capturer can't find a source matching its title (which would
     * happen if the OS hasn't registered the window — rare, transient).
     */
    getCaptureSourceId(): Promise<string | null>
    /** List available displays for the output-display picker. */
    listDisplays(): Promise<{ id: number; label: string; primary: boolean }[]>
    /**
     * Move the output window to a given display. Phase 5 implements this;
     * Phase 4 registers the handler as a no-op so calls don't crash.
     */
    setDisplay(displayId: number | null): Promise<void>

    // ── Stage monitor (on-demand projector for the speaker) ──────────
    /**
     * Enable or disable the stage monitor window. When enabled the
     * window is created on demand and starts mirroring the main
     * output's slide content. Disabling closes the window.
     */
    setStageMonitorEnabled(enabled: boolean): Promise<void>
    /**
     * Move the stage monitor window to a given display. Null = the
     * "smart default" (first non-primary display, or primary if only
     * one display exists). No-op if the stage monitor window doesn't
     * currently exist.
     */
    setStageMonitorDisplay(displayId: number | null): Promise<void>

    // ── Lower thirds (chroma-key window for OBS) ─────────────────────
    /**
     * Enable or disable the lower thirds window. When enabled the
     * window is created on demand with a chroma-key background ready
     * to be captured by OBS. Disabling closes the window.
     */
    setLowerThirdsEnabled(enabled: boolean): Promise<void>
    /** Move the lower thirds window to a given display. */
    setLowerThirdsDisplay(displayId: number | null): Promise<void>
    /**
     * Push new lower-thirds content (title / subtitle / visibility)
     * to the lower thirds window. Cached in main so a hot-reloaded
     * lower thirds renderer immediately resyncs.
     */
    setLowerThirdsContent(content: LowerThirdsContent): Promise<void>

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
    /**
     * Subscribe to authoritative video time updates from the OUTPUT
     * window. Operator confidence monitor only. The operator's
     * VideoSlide nudges its local <video> currentTime when drift
     * exceeds the snap threshold (~500ms).
     */
    onVideoTimeUpdate(
      callback: (update: VideoTimeUpdate) => void
    ): () => void
    /**
     * Subscribe to "non-looping video reached natural end" events
     * from the OUTPUT window. Operator only — used by ServiceMode
     * to auto-advance the setlist.
     */
    onVideoEnded(
      callback: (payload: { videoPath: string }) => void
    ): () => void
    /**
     * Subscribe to lower thirds content updates. Used by the lower
     * thirds renderer to redraw its DOM when the operator changes
     * the title/subtitle/visibility.
     */
    onLowerThirdsContent(
      callback: (content: LowerThirdsContent) => void
    ): () => void
    /**
     * Subscribe to stage-monitor context updates. Used by StageView
     * to render the ProPresenter-style layout (current + next slide,
     * notes, progress).
     */
    onStageContext(callback: (context: StageContext) => void): () => void
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
  system: {
    getPreflight: 'system:getPreflight',
    openExternal: 'system:openExternal'
  },
  files: {
    checkExists: 'files:checkExists'
  },
  dialog: {
    pickFile: 'dialog:pickFile'
  },
  fonts: {
    list: 'fonts:list',
    upload: 'fonts:upload',
    delete: 'fonts:delete'
  },
  backup: {
    exportNow: 'backup:exportNow',
    list: 'backup:list',
    restore: 'backup:restore',
    delete: 'backup:delete',
    openFolder: 'backup:openFolder',
    importFromFile: 'backup:importFromFile'
  },
  updater: {
    getVersion: 'updater:getVersion',
    checkNow: 'updater:checkNow'
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
    setVideoTimeUpdate: 'output:setVideoTimeUpdate',
    setVideoEnded: 'output:setVideoEnded',
    getCaptureSourceId: 'output:getCaptureSourceId',
    listDisplays: 'output:listDisplays',
    setDisplay: 'output:setDisplay',
    setStageMonitorEnabled: 'output:setStageMonitorEnabled',
    setStageMonitorDisplay: 'output:setStageMonitorDisplay',
    setLowerThirdsEnabled: 'output:setLowerThirdsEnabled',
    setLowerThirdsDisplay: 'output:setLowerThirdsDisplay',
    setLowerThirdsContent: 'output:setLowerThirdsContent',
    setStageContext: 'output:setStageContext',
    // Events broadcast from main -> output window (output renderer subscribes)
    eventSlide: 'output:event:slide',
    eventMode: 'output:event:mode',
    eventItemThemeOverride: 'output:event:itemThemeOverride',
    eventVideoControl: 'output:event:videoControl',
    // Events broadcast from main -> operator window (operator subscribes
    // for video sync; the output window IS the source so it does not
    // also subscribe — that would be a feedback loop)
    eventVideoTimeUpdate: 'output:event:videoTimeUpdate',
    // Fired by the OUTPUT window when a non-looping video reaches its
    // natural end, so the operator can auto-advance the setlist.
    eventVideoEnded: 'output:event:videoEnded',
    // Lower thirds content broadcast from main -> lower thirds window
    eventLowerThirdsContent: 'output:event:lowerThirdsContent',
    // Stage monitor context broadcast from main -> stage window
    eventStageContext: 'output:event:stageContext'
  }
} as const
