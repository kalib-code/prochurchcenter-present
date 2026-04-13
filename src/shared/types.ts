/**
 * Present — core data model (v1.0)
 *
 * Every type here is locked per docs/BLUEPRINT.md. If you want to add a field,
 * make sure it's actually used in the UI and not speculative. Adding fields
 * "for future flexibility" is exactly how FreeShow got its 50-property Item
 * type, which is the trap we're deliberately avoiding.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Song
// ─────────────────────────────────────────────────────────────────────────────

export type SectionType =
  | 'verse'
  | 'chorus'
  | 'bridge'
  | 'intro'
  | 'outro'
  | 'pre-chorus'
  | 'tag'
  | 'other'

export type SongLanguage = 'en' | 'tl' | 'ceb' | 'ilo' | 'other'

export interface SongSection {
  /** Stable within a song, used as React list key */
  id: string
  type: SectionType
  /** Free-form label that appeared in brackets, e.g. "Verse 1", "Chorus 2" */
  label: string
  /** Each slide is an array of lines (string[]) */
  slides: string[][]
}

export interface Song {
  /** uuid; matches the JSON filename */
  id: string
  title: string
  author: string | null
  /** CCLI number, free-text so "N/A" works */
  ccli: string | null
  copyright: string | null
  year: number | null
  language: SongLanguage
  /** Free-form tags, e.g. ["praise", "christmas"] */
  categories: string[]
  /** SOURCE OF TRUTH — what lives in the textarea */
  rawText: string
  /** DERIVED from rawText at save time, cached for fast render */
  sections: SongSection[]
  /** Operator-only notes, shown in Service Mode but not on output */
  notes: string
  /**
   * Optional per-song theme override. When non-null, its fields are
   * merged on top of the active global theme whenever this song is the
   * current item in Service Mode. Set to null for "use global theme
   * unchanged" — the common case for most songs. Phase 5.5.
   */
  themeOverride: ThemeOverride | null
  /** ISO 8601 */
  createdAt: string
  updatedAt: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Setlist
// ─────────────────────────────────────────────────────────────────────────────

export type SetlistItem =
  | { kind: 'song'; id: string; songId: string }
  | {
      kind: 'scripture'
      id: string
      reference: string
      text: string
      translation: string
    }
  | { kind: 'section-divider'; id: string; label: string }
  | { kind: 'image'; id: string; imagePath: string; caption?: string }
  | { kind: 'countdown'; id: string; label: string; targetTime: string /* ISO */ }
  /**
   * Foreground video with audio — sermon intros, testimony reels,
   * worship videos, transition clips. Plays once from the start when
   * it becomes the active slide. Distinct from theme.backgroundVideoPath
   * which is an ambient, muted, looping background layer underneath
   * text slides.
   */
  | {
      kind: 'video'
      id: string
      videoPath: string
      /** Optional display name for the operator upcoming list */
      title?: string
    }
  /**
   * Deck — a PDF file whose pages become slides. The user exports their
   * PowerPoint/Keynote/Google Slides to PDF (one-click in every major
   * tool), picks the file, and we render each page via pdf.js.
   *
   * pageCount is cached at add-time so slideify can synchronously expand
   * a deck into N slides without re-opening the file. If the source PDF
   * is replaced with one that has a different page count, the user can
   * re-pick via the editor (which updates pageCount).
   */
  | {
      kind: 'deck'
      id: string
      pdfPath: string
      pageCount: number
      /** Optional display name shown in the operator upcoming list */
      title?: string
    }

export interface Setlist {
  id: string
  name: string
  /** ISO date YYYY-MM-DD */
  date: string
  items: SetlistItem[]
  createdAt: string
  updatedAt: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Theme
// ─────────────────────────────────────────────────────────────────────────────

export type TextAlign = 'left' | 'center' | 'right'
export type TextPosition = 'top' | 'center' | 'bottom'
export type TextEffect = 'none' | 'shadow' | 'outline' | 'highlight'
export type Transition = 'fade' | 'instant'

export interface Theme {
  /** 'default' for the bundled theme; users can create multiple in v1.1 */
  id: string
  name: string
  /** Hex color */
  backgroundColor: string
  backgroundImagePath: string | null
  /**
   * Optional looping video background. When set, plays muted + looped
   * behind the text content. Takes visual priority over the image (the
   * image is effectively the poster while the video loads). Mutually
   * exclusive with backgroundImagePath in the Settings UI — picking a
   * video clears the image and vice versa — but the schema allows both
   * so future theme presets can ship a poster + video pair.
   */
  backgroundVideoPath: string | null
  textColor: string
  /** System font family name; v1.0 only supports pre-installed fonts */
  fontFamily: string
  /** 50–150, default 100 */
  fontSizePercent: number
  textAlign: TextAlign
  textPosition: TextPosition
  textEffect: TextEffect
  /** Only used when textEffect === 'highlight' */
  highlightColor: string
  transition: Transition
  /** 0 for instant, 200 for fade default */
  transitionDurationMs: number
  /** Optional standby image (shown when 'L' key is pressed in Service Mode) */
  logoPath: string | null
}

/**
 * Per-song (or, in future, per-scripture) visual override.
 *
 * Every field is optional — the fields that ARE set override the
 * corresponding fields in the active global theme; unset fields fall
 * through. `id` and `name` are excluded because they only make sense
 * on a full theme record stored on disk.
 *
 * The effective theme at render time is computed as:
 *
 *   effective = { ...globalTheme, ...itemThemeOverride }
 *
 * which means a song with `{ backgroundColor: '#ff0000' }` gets red
 * background while inheriting everything else (font, effects, etc)
 * from the global theme. Set to `null` (not an empty object) to
 * indicate "no override at all".
 */
export type ThemeOverride = Partial<Omit<Theme, 'id' | 'name'>>

// ─────────────────────────────────────────────────────────────────────────────
// Settings
// ─────────────────────────────────────────────────────────────────────────────

export type UiLanguage = 'en' | 'tl'

export interface Settings {
  uiLanguage: UiLanguage
  /** null = primary display */
  outputDisplayId: number | null
  firstRunCompleted: boolean
  activeThemeId: string
  /**
   * Maximum number of lyric lines shown on one output slide. Any song
   * slide with more lines than this is auto-split into multiple slides.
   * Manual blank-line breaks in rawText still take precedence.
   *
   * Typical values: 2 (very readable), 4 (default, matches ProPresenter),
   * 6 (dense, for small-text hymns). Reasonable clamp: 2..8.
   */
  maxLinesPerSlide: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Bible (Phase 6)
//
// Present queries bible.helloao.org as an API client at runtime and
// caches each fetched chapter under userData/bible-cache/. We never
// REDISTRIBUTE Bible content — every user pulls from helloao directly,
// then keeps a personal cache for offline use.
//
// Translation IDs are helloao's own catalog identifiers (e.g. 'ENGWEBP'
// for World English Bible Protestant, 'tgl_ulb' for Tagalog ULB). Book
// IDs are USFM 3-letter codes (e.g. 'JHN', 'GEN', '1CO'). Both are used
// directly in the API URL pattern:
//
//   https://bible.helloao.org/api/{translation}/{book}/{chapter}.json
//
// The chapter fetch returns interleaved content (verses, headings,
// line breaks). We extract just the verses for display, but cache the
// full chapter in case future features (e.g. headings between verses)
// need them.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One verse extracted from a helloao chapter response. The text is
 * pre-flattened — inline footnote refs and word-of-Jesus markers are
 * collapsed to a plain string at fetch time. If we ever need
 * formatting metadata we can re-derive it from the cached raw JSON.
 */
export interface BibleVerse {
  number: number
  text: string
}

/**
 * A parsed scripture reference. Output of bibleReference.parseReference.
 *
 * `bookId` is the USFM 3-letter code (used directly in the helloao API
 * URL). `bookName` is the display-friendly canonical English name.
 *
 * `verseEnd` undefined means either "single verse" (when verseStart is
 * set) or "whole chapter" (when verseStart is also undefined).
 */
export interface BibleReference {
  bookId: string
  bookName: string
  chapter: number
  verseStart?: number
  verseEnd?: number
}

/**
 * Translation metadata as exposed to the renderer. Slim subset of
 * what helloao returns — we strip fields we don't display (sha256,
 * api links, verse counts).
 */
export interface BibleTranslationMeta {
  id: string
  name: string
  englishName: string
  shortName: string
  language: string
  /** Native-language language name, e.g. "English" / "Filipino" */
  languageName?: string
  /** English name of the language, e.g. "English" / "Filipino" */
  languageEnglishName?: string
  textDirection: 'ltr' | 'rtl'
  licenseUrl: string
  licenseNotes?: string | null
}

/** Per-book metadata for a translation (USFM id + display name). */
export interface BibleBookMeta {
  id: string
  name: string
  commonName: string
  order: number
  numberOfChapters: number
  firstChapterNumber: number
  lastChapterNumber: number
}

/**
 * Result of a bible.lookup call. Either a successful set of verses
 * or a parse / fetch error with a friendly message the UI can render
 * without translation.
 */
export type BibleLookupResult =
  | {
      ok: true
      reference: BibleReference
      verses: BibleVerse[]
      /** Joined display text — what the scripture editor pastes as the slide content */
      text: string
    }
  | { ok: false; error: string }

// ─────────────────────────────────────────────────────────────────────────────
// License (Phase 8 fills in the real behavior; Phase 1 just declares the shape)
// ─────────────────────────────────────────────────────────────────────────────

export type LicenseStatus = 'trial' | 'active' | 'expired' | 'invalid' | 'none'

export interface License {
  status: LicenseStatus
  /** Obscured in UI */
  key: string | null
  activatedAt: string | null
  trialStartedAt: string | null
  trialEndsAt: string | null
  /** Optional display name from polar.sh */
  churchName: string | null
  deviceId: string
}
