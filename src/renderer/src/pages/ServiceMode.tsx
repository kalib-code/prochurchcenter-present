/**
 * ServiceMode — the operator view during a live service. KLB layout:
 *
 *   ┌─────────────────────────────────────────────────────────────────┐
 *   │ [name/counter] [timer]      [LIVE/BLACK/LOGO] [B][L][?] [EXIT]  │
 *   ├──────────┬──────────────────────────────────┬───────────────────┤
 *   │  ITEMS   │  ALL SLIDES toolbar (sticky)      │  ON SCREEN mirror │
 *   │  rail +  │  GROUPED: sticky per-item header  │  video runway     │
 *   │  filter  │  + that item's slide cards        │  NEXT panel       │
 *   │ (resize) │  FLAT: one grid of every slide     │  notes (resize)  │
 *   ├──────────┴──────────────────────────────────┴───────────────────┤
 *   │  Lower thirds strip (title/subtitle/hide) — only when enabled    │
 *   └───────────────────────────────────────────────────────────────────┘
 *
 * Flow:
 *   - Mounts with :setlistId from URL
 *   - Loads setlist + songs if not cached
 *   - Slideifies → calls useServiceStore.start()
 *   - useKeyboard picks up, every key dispatches a store action,
 *     store broadcasts to output window
 *   - Pressing Esc triggers confirm + exit → navigate back to Home
 *   - Pressing past the last slide → ended state → end screen
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useSetlistStore } from '../stores/useSetlistStore'
import { useLibraryStore } from '../stores/useLibraryStore'
import { useServiceStore } from '../stores/useServiceStore'
import { useSettingsStore } from '../stores/useSettingsStore'
import { useThemeStore } from '../stores/useThemeStore'
import { shortcutFromLabel, slideifySetlist } from '../lib/slideify'
import { mergeThemeOverride } from '../lib/themeOverride'
import { loadPptxDeck } from '../lib/pptxLoader'
import { OutputMirror } from '../components/OutputMirror'
import { SlideCard } from '../components/SlideCard'
import { KeyCheatSheet } from '../components/KeyCheatSheet'
import { ServiceNextPanel } from '../components/ServiceNextPanel'
import { VideoRunway } from '../components/VideoRunway'
import { Button } from '../components/ui/Button'
import { MonoLabel } from '../components/ui/MonoLabel'
import { Segmented, type SegmentedOption } from '../components/ui/Segmented'
import { StatusDot } from '../components/ui/StatusDot'
import { TitleDot } from '../components/ui/TitleDot'
import { WarningBanner, type WarningItem } from '../components/ui/WarningBanner'
import type { PptxThumbError } from '../components/MediaPreview'
import type { PptxSlideErrorKind } from '../components/PptxSlideView'
import { useKeyboard } from '../hooks/useKeyboard'
import type { Song } from '@shared/types'
import type {
  LowerThirdsContent,
  OutputMode,
  SlidePayload,
  VideoControl,
  VideoTimeUpdate
} from '@shared/ipc-contract'

/**
 * Shared height for the grid toolbar AND the offset the sticky group
 * headers pin under. One constant so the two sticky layers can never
 * drift apart — see the module doc's ASCII layout above.
 */
export const GRID_TOOLBAR_H = 37

/**
 * Height of each GROUPED-mode sticky item header (the row showing the
 * item number, label, kind, and estimated runtime). Pinned under
 * GRID_TOOLBAR_H via its own `style={{ top: GRID_TOOLBAR_H }}` below —
 * see that element for the matching comment on why its border colors
 * are side-specific.
 *
 * Exists as a named constant (not a bare Tailwind class) for the same
 * reason GRID_TOOLBAR_H does: `scrollIntoView({ block: 'nearest' })`
 * only respects a scrolled element's OWN `scroll-margin-top`, not the
 * height of whatever happens to be sticky above it. Without composing
 * both constants into that margin, jumping backward mid-service parks
 * the active card flush under ~72px of opaque sticky header — GROUPED
 * mode's toolbar + item header both painted over it — with no way to
 * tell where you are short of scrolling by hand.
 */
export const GRID_GROUP_HEADER_H = 35

type GridMode = 'grouped' | 'flat'

const DISPLAY_MODE_OPTIONS: SegmentedOption<OutputMode>[] = [
  { value: 'live', label: 'LIVE' },
  { value: 'black', label: 'BLACK' },
  { value: 'logo', label: 'LOGO' }
]

const GRID_MODE_OPTIONS: SegmentedOption<GridMode>[] = [
  { value: 'grouped', label: 'GROUPED' },
  { value: 'flat', label: 'FLAT' }
]

export function ServiceMode(): JSX.Element {
  const { setlistId } = useParams<{ setlistId: string }>()
  const navigate = useNavigate()

  const { setlists, load: loadSetlists, getById: getSetlist } = useSetlistStore()
  const { songs, load: loadLibrary } = useLibraryStore()
  const { settings, load: loadSettings } = useSettingsStore()
  // Theme is needed so the confidence monitor mirrors the projector's
  // look exactly — same colors, fonts, effects, alignment. Without this
  // the operator sees the FALLBACK_THEME (black/white/center) while the
  // real output shows whatever they picked in Settings, and they think
  // it's broken.
  const { theme, load: loadTheme } = useThemeStore()
  const state = useServiceStore((s) => s.state)
  const start = useServiceStore((s) => s.start)
  const exit = useServiceStore((s) => s.exit)
  const toggleBlack = useServiceStore((s) => s.toggleBlack)
  const toggleLogo = useServiceStore((s) => s.toggleLogo)
  const toggleCheatSheet = useServiceStore((s) => s.toggleCheatSheet)
  const jumpTo = useServiceStore((s) => s.jumpTo)

  // Keyboard handler — active whenever running
  useKeyboard({ enabled: state.mode === 'running' })

  // Load deps once
  useEffect(() => {
    if (setlists.length === 0) loadSetlists()
    if (songs.length === 0) loadLibrary()
    if (!settings) loadSettings()
    if (!theme) loadTheme()
  }, [setlists.length, songs.length, settings, theme, loadSetlists, loadLibrary, loadSettings, loadTheme])

  // When all deps + setlistId are ready, start the service. Only runs once
  // per mount — if already running for this setlistId, skip. Settings
  // must be loaded first so slideify knows how to split long slides.
  useEffect(() => {
    if (!setlistId) return
    if (!settings) return
    if (state.mode === 'running' && state.setlistId === setlistId) return
    if (state.mode === 'ended' && state.setlistId === setlistId) return
    const setlist = getSetlist(setlistId)
    if (!setlist) return
    if (songs.length === 0 && setlist.items.some((i) => i.kind === 'song')) {
      // Wait for songs to load before slideifying, otherwise song items
      // get dropped silently.
      return
    }
    const songsById = new Map<string, Song>()
    for (const s of songs) songsById.set(s.id, s)
    const items = slideifySetlist(setlist, songsById, {
      maxLinesPerSlide: settings.maxLinesPerSlide,
      songTransitionSlide: settings.songTransitionSlide
    })
    start({
      setlistId: setlist.id,
      setlistName: setlist.name,
      items
    })
  }, [setlistId, setlists, songs, settings, state.mode, getSetlist, start])

  // Per-item estimated runtime, keyed by RenderableItem.id (= the source
  // SetlistItem.id — slideifySetlist preserves it 1:1 for every kind).
  // Pulled from the RAW setlist rather than invented, because a made-up
  // timing estimate on a live-service screen is worse than none: an
  // operator who trusts a fabricated "3:45" could mistime the whole
  // service. `durationMinutes` is the same operator-entered figure
  // SetlistEditor's own clock uses (lib/serviceClock.ts), just re-read
  // here rather than re-derived.
  const durationById = useMemo(() => {
    const map = new Map<string, number>()
    if (!setlistId) return map
    const setlist = getSetlist(setlistId)
    if (!setlist) return map
    for (const item of setlist.items) {
      const d = item.durationMinutes
      if (typeof d === 'number' && Number.isFinite(d) && d > 0) {
        map.set(item.id, d)
      }
    }
    return map
  }, [setlistId, setlists, getSetlist])

  // If no setlist id, bail
  if (!setlistId) {
    return <div className="p-6">No setlist id.</div>
  }

  // ── LOADING ────────────────────────────────────────────────────────────
  if (state.mode === 'idle') {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center gap-4 bg-background text-foreground">
        <StatusDot tone="signal" pulse />
        <MonoLabel tone="signal">PREPARING SERVICE</MonoLabel>
        <p className="max-w-sm text-center text-[12.5px] text-soft">
          If this sticks, the setlist might be empty or missing songs.
        </p>
        <Button type="button" variant="outline" size="sm" onClick={() => navigate('/')}>
          CANCEL → HOME
        </Button>
      </div>
    )
  }

  // ── ENDED ──────────────────────────────────────────────────────────────
  // The last thing an operator sees every Sunday — worth landing on the
  // same KLB language as the rest of the app rather than a bare white
  // button on black.
  if (state.mode === 'ended') {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center gap-6 bg-background text-foreground">
        <div className="text-center">
          <MonoLabel tone="signal">SERVICE ENDED</MonoLabel>
          <h1 className="mt-2 text-[36px] font-extrabold leading-none tracking-[-0.03em] text-foreground">
            {state.setlistName}
            <TitleDot />
          </h1>
          <p className="mt-2 text-[13px] text-soft">
            Started {new Date(state.startedAt).toLocaleTimeString()}
          </p>
        </div>
        <Button
          type="button"
          variant="signal"
          size="md"
          onClick={() => {
            exit()
            navigate('/')
          }}
        >
          BACK TO HOME
        </Button>
      </div>
    )
  }

  // ── RUNNING ────────────────────────────────────────────────────────────
  return (
    <RunningView
      state={state}
      jumpTo={jumpTo}
      toggleBlack={toggleBlack}
      toggleLogo={toggleLogo}
      toggleCheatSheet={toggleCheatSheet}
      durationById={durationById}
      onExit={() => {
        const ok = window.confirm('Exit service mode?')
        if (!ok) return
        exit()
        navigate('/')
      }}
    />
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// RunningView — extracted so hooks don't fire when state.mode !== 'running'
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A single entry in the flat service-wide slide grid. Maps a (itemIndex,
 * slideIndex) pair to display metadata so the grid can render + jumpTo.
 */
interface GridEntry {
  itemIndex: number
  slideIndex: number
  sectionLabel: string
  shortcut: string
  lines: string[]
  /**
   * Optional media thumbnail preview source. Populated for image, video,
   * pdf-page, and pptx-slide slides so the grid shows visual content
   * instead of "(image)" placeholder text.
   */
  preview?:
    | { kind: 'image'; path: string }
    | { kind: 'video'; path: string }
    | { kind: 'deck'; pdfPath: string; pageIndex: number }
    | { kind: 'pptx'; pptxPath: string; slideOrdinal: number }
}

/** "≈ N MIN" for a known duration, or an em dash when the operator never set one. */
function formatEstimatedRuntime(minutes: number | undefined): string {
  if (typeof minutes !== 'number') return '—'
  return `≈ ${minutes} MIN`
}

function RunningView({
  state,
  jumpTo,
  toggleBlack,
  toggleLogo,
  toggleCheatSheet,
  durationById,
  onExit
}: {
  state: Extract<
    ReturnType<typeof useServiceStore.getState>['state'],
    { mode: 'running' }
  >
  jumpTo: (itemIndex: number, slideIndex?: number) => void
  toggleBlack: () => void
  toggleLogo: () => void
  toggleCheatSheet: () => void
  durationById: Map<string, number>
  onExit: () => void
}): JSX.Element {
  const currentItem = state.items[state.itemIndex]
  const currentSlide = currentItem?.slides[state.slideIndex] ?? null
  const gridContainerRef = useRef<HTMLDivElement>(null)

  // ── Resizable side panels ──────────────────────────────────────────
  // Both the left items sidebar and the right confidence-monitor panel
  // are operator-adjustable. Widths persist in localStorage so the
  // operator's preference survives across services. usePanelWidth
  // encapsulates the load/clamp/persist dance so each panel only
  // needs one line. 190 / 400 are the KLB design's INITIAL widths only
  // — an operator who has already resized keeps their saved value.
  const itemsPanel = usePanelWidth({
    storageKey: 'present:itemsPanelWidth',
    defaultPx: 190,
    min: 140,
    max: 360
  })
  const sidePanel = usePanelWidth({
    storageKey: 'present:sidePanelWidth',
    defaultPx: 400,
    min: 280,
    max: 720
  })

  // ── Video playback controls ─────────────────────────────────────────
  // Live pause/mute state for the currently-rendered video slide. Reset
  // to defaults whenever the active slide changes — a new video always
  // starts playing and unmuted, regardless of what the previous slide
  // was. Broadcast via IPC so the output window stays in sync.
  const [videoControl, setVideoControl] = useState<VideoControl>({
    paused: false,
    muted: false
  })
  const isVideoSlide = currentSlide?.kind === 'video'

  // Authoritative playback position broadcast FROM the output window's
  // <video> element, fed into <VideoRunway> below. Only trusted when it
  // names the same file as the slide currently on screen — otherwise a
  // stale update from the PREVIOUS video could flash briefly on the new
  // one before the first fresh broadcast arrives.
  const [videoTimeUpdate, setVideoTimeUpdate] = useState<VideoTimeUpdate | null>(null)
  useEffect(() => {
    const off = window.api.output.onVideoTimeUpdate((update) => {
      setVideoTimeUpdate(update)
    })
    return off
  }, [])

  // Reset + broadcast whenever the active slide changes. Fires for every
  // navigation, not just video → video transitions, so the broadcast is
  // idempotent (output window has a cached last state and will re-apply
  // the default cleanly).
  useEffect(() => {
    const fresh: VideoControl = { paused: false, muted: false }
    setVideoControl(fresh)
    setVideoTimeUpdate(null)
    void window.api.output.setVideoControl(fresh)
  }, [state.itemIndex, state.slideIndex])

  const togglePause = useCallback((): void => {
    setVideoControl((prev) => {
      const next = { ...prev, paused: !prev.paused }
      void window.api.output.setVideoControl(next)
      return next
    })
  }, [])

  const toggleMute = useCallback((): void => {
    setVideoControl((prev) => {
      const next = { ...prev, muted: !prev.muted }
      void window.api.output.setVideoControl(next)
      return next
    })
  }, [])

  // Keyboard shortcuts for video control — P = pause, M = mute. Only
  // bound while a video slide is active, so they don't interfere with
  // normal text-slide navigation. useKeyboard owns Space/Arrows/B/L/?,
  // this effect handles the video-specific keys locally.
  useEffect(() => {
    if (!isVideoSlide) return
    const handler = (e: KeyboardEvent): void => {
      const target = e.target
      if (target instanceof HTMLElement) {
        const tag = target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable)
          return
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'p' || e.key === 'P') {
        e.preventDefault()
        togglePause()
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault()
        toggleMute()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [isVideoSlide, togglePause, toggleMute])

  // ── Auto-advance on video end ──────────────────────────────────────
  // The output window fires setVideoEnded the moment a non-looping
  // video reaches its natural end. We listen here and advance the
  // setlist — but only if the active slide is STILL that same video,
  // since the operator may have manually navigated away in the
  // milliseconds between the ended event and the IPC arriving.
  //
  // currentSlideRef bridges the long-lived subscription with the
  // ever-changing currentSlide value: subscribe-on-mount means the
  // listener closure would otherwise capture a stale slide reference.
  const nextSlide = useServiceStore((s) => s.nextSlide)
  const currentSlideRef = useRef(currentSlide)
  useEffect(() => {
    currentSlideRef.current = currentSlide
  }, [currentSlide])
  useEffect(() => {
    const off = window.api.output.onVideoEnded((payload) => {
      const active = currentSlideRef.current
      if (active?.kind === 'video' && active.videoPath === payload.videoPath) {
        nextSlide()
      }
    })
    return off
  }, [nextSlide])

  // ── Lower thirds (auto-follow mode) ───────────────────────────────
  // The lower thirds window AUTO-FOLLOWS the active setlist item:
  //   - Song item → auto-shows with title + author from the song
  //   - Non-song item → auto-hides
  //
  // The operator can still edit title/subtitle on the fly (typing
  // updates the broadcast immediately) and can manually hide via
  // the bottom-strip button. Per-item edits are intentionally
  // ephemeral — the moment the operator advances to a new item the
  // auto-follow re-asserts that item's defaults. This matches the
  // ProPresenter / EasyWorship model: lower thirds are a function
  // of the current item, not a separate piece of operator state.
  const lowerThirdsEnabled = useSettingsStore(
    (s) => s.settings?.lowerThirdsEnabled ?? false
  )
  // Theme fields read from settings. Bundled into every push so
  // changes propagate to the chroma-key window without recreating
  // the BrowserWindow. Tracked as separate selectors (one per field)
  // rather than the whole settings object because Zustand's
  // shallow-eq selector minimizes re-renders that way.
  const ltFontSize = useSettingsStore((s) => s.settings?.lowerThirdsFontSize ?? 36)
  const ltTextColor = useSettingsStore(
    (s) => s.settings?.lowerThirdsTextColor ?? '#FFFFFF'
  )
  const ltBoxColor = useSettingsStore(
    (s) => s.settings?.lowerThirdsBoxColor ?? '#0F121C'
  )
  const ltBoxOpacity = useSettingsStore(
    (s) => s.settings?.lowerThirdsBoxOpacity ?? 92
  )
  const ltTextEffect = useSettingsStore(
    (s) => s.settings?.lowerThirdsTextEffect ?? 'shadow'
  )
  const [lowerThirdsContent, setLowerThirdsContentState] =
    useState<LowerThirdsContent>({
      visible: false,
      title: '',
      subtitle: ''
    })
  // Tracks whether the OPERATOR has overridden auto-follow's content for
  // the current slide (typed over title/subtitle, or manually hit
  // SHOW/HIDE) — as opposed to the content on screen being whatever
  // auto-follow last computed. Feeds the three-state status readout
  // below (spec §5.5): reset to false at the top of the auto-follow
  // effect (which reruns on every slide change), so it always "resets
  // on advance" per that same design.
  const [ltEdited, setLtEdited] = useState(false)
  // pushLowerThirds takes whatever the caller provides and stamps
  // the current theme onto it. Callers don't need to know about
  // theme — the helper handles it. This means typing in the bottom
  // strip, auto-follow, and manual show/hide all carry the live
  // theme automatically.
  const pushLowerThirds = useCallback(
    (next: LowerThirdsContent) => {
      const withTheme: LowerThirdsContent = {
        ...next,
        theme: {
          fontSize: ltFontSize,
          textColor: ltTextColor,
          boxColor: ltBoxColor,
          boxOpacity: ltBoxOpacity,
          textEffect: ltTextEffect
        }
      }
      setLowerThirdsContentState(withTheme)
      void window.api.output.setLowerThirdsContent(withTheme)
    },
    [ltFontSize, ltTextColor, ltBoxColor, ltBoxOpacity, ltTextEffect]
  )
  // Same as pushLowerThirds, but for content changes the OPERATOR
  // initiated (typing in the bottom-strip inputs, clicking SHOW/HIDE) —
  // as opposed to auto-follow's own pushes. Marks ltEdited so the status
  // readout can tell the two apart.
  const pushLowerThirdsManual = useCallback(
    (next: LowerThirdsContent) => {
      setLtEdited(true)
      pushLowerThirds(next)
    },
    [pushLowerThirds]
  )
  // What lyrics (if any) the CURRENT slide would auto-populate — shared
  // between the auto-follow effect below and the status readout, so the
  // two can never disagree about what "auto-following" means.
  const autoFollowLyrics =
    currentItem?.kind === 'song' && currentSlide?.kind === 'text'
      ? currentSlide.lines.join('\n').trim()
      : ''
  // Auto-follow effect — runs on every slide change. For song
  // slides, the lower thirds shows the CURRENT LYRIC LINES being
  // sung, with the song title + author as a small subtitle for
  // broadcast attribution. This matches the standard church
  // live-stream pattern: the camera frames the worship team, and
  // the lower-third overlay shows what's being sung right now so
  // remote viewers can sing along.
  //
  // For non-song items (Scripture, image, video, PDF, countdown),
  // the lower thirds auto-hides — the operator can still type
  // manual content and click Show if they want to overlay
  // something on a non-song item.
  //
  // Deps include currentSlide (not just currentItem) so the
  // broadcast updates on every arrow press, not just when the
  // operator advances between items.
  useEffect(() => {
    if (!lowerThirdsEnabled) return
    // Advancing to a new slide always re-asserts auto-follow's default,
    // so any prior manual override no longer applies.
    setLtEdited(false)
    if (autoFollowLyrics) {
      // Lyrics-only mode: just the verse text, no song-title or
      // author subtitle. The operator can still type a subtitle
      // manually if they want one for a particular song.
      pushLowerThirds({
        visible: true,
        title: autoFollowLyrics,
        subtitle: ''
      })
      return
    }
    // Everything else: hide. Includes non-song items, blank/empty
    // song slides, and any slide kind we don't have a good
    // auto-population strategy for.
    pushLowerThirds({ visible: false, title: '', subtitle: '' })
  }, [currentItem, currentSlide, lowerThirdsEnabled, pushLowerThirds, autoFollowLyrics])
  // Three-state readout for the bottom strip (spec §5.5), replacing the
  // old two-state LIVE/HIDDEN that couldn't tell the operator WHY it was
  // showing or hiding.
  const lowerThirdsStatusLabel = ltEdited
    ? 'EDITED · RESETS ON ADVANCE'
    : autoFollowLyrics
      ? 'AUTO-FOLLOWING SONG'
      : 'AUTO-HIDDEN · NOT A SONG'

  // ── Live notes (operator-editable, broadcast to stage monitor) ────
  // The notes shown on the stage monitor and in the operator's own
  // confidence sidebar both come from this single piece of local
  // state. It's seeded from currentItem.notes whenever the item
  // changes, but the operator can then edit it freely during the
  // service — per-service edits are ephemeral and don't write back
  // to the song record. Useful for in-service announcements,
  // last-minute reminders, sermon timing markers, etc.
  const [liveNotes, setLiveNotes] = useState('')
  useEffect(() => {
    setLiveNotes(currentItem?.notes ?? '')
  }, [currentItem])

  // ── Stage monitor context broadcast ────────────────────────────────
  // Send a fresh StageContext on every slide change OR live-notes
  // change. The stage monitor (if enabled) renders its
  // ProPresenter-style layout from this — current slide + next
  // slide preview + slide progress + live notes. Broadcasting
  // unconditionally is fine: the IPC handler in main no-ops if the
  // stage monitor window doesn't exist, and the cost of one IPC
  // message per keystroke is negligible.
  useEffect(() => {
    const slides = currentItem?.slides ?? []
    // Cross the item boundary rather than stopping at the current item's
    // last slide: when the operator is sitting on the last slide of item
    // N, "next" is the FIRST slide of item N+1, not null. This matters
    // beyond the stage monitor's "Up Next" panel — it's also the one
    // piece of lookahead the output/stage windows get for warming a
    // PowerPoint deck's parse before the operator actually advances into
    // it (see the warm effects in OutputView/StageView). Stopping at the
    // item boundary would make that lookahead go null at exactly the
    // moment it matters most: the transition ONTO a new pptx deck.
    //
    // Named ...ForStage, NOT `nextSlide`: that identifier is already the
    // store's advance ACTION in this scope, and shadowing it here would
    // silently break SPACE.
    const nextSlideForStage: SlidePayload | null =
      state.slideIndex + 1 < slides.length
        ? slides[state.slideIndex + 1]
        : (state.items[state.itemIndex + 1]?.slides[0] ?? null)
    void window.api.output.setStageContext({
      currentSlide: currentSlide ?? null,
      nextSlide: nextSlideForStage,
      itemLabel: currentItem?.label ?? '',
      slideIndex: state.slideIndex,
      totalSlides: slides.length,
      notes: liveNotes
    })
  }, [currentItem, currentSlide, state.items, state.itemIndex, state.slideIndex, liveNotes])
  // Pulled directly from the store rather than prop-drilled — the parent
  // baseTheme is still pulled because the slide grid cards below
  // need it to render per-card preview themes. The confidence
  // monitor itself no longer needs a merged theme — it's a pixel
  // mirror of the output (see <OutputMirror /> below) so the
  // projector's actual rendered pixels are what the operator sees,
  // not an independent re-render.
  const baseTheme = useThemeStore((s) => s.theme)

  // ── PowerPoint deck warnings ────────────────────────────────────────
  // Operator-facing only — RunningView is the ServiceMode component tree,
  // which renders inside the operator's own window. It is never reached
  // by OutputView or StageView (the projector / stage-monitor windows),
  // so nothing pushed into this list can end up on a screen the
  // congregation can see.
  //
  // Keyed by `${pptxPath}::${bucket}` — NOT by the human-readable reason
  // text — rather than an array of composed strings. Two mechanisms feed
  // this: the warm-on-entry preload below (one shot, whole-file) and
  // reportPptxError (one call per failing slide's PptxThumb — see
  // MediaPreview.tsx). The grid is unvirtualized, so a single broken deck
  // can fail on all N of its slides at once; without this keying, that
  // produces N near-identical banner lines (plus a 41st from preload)
  // instead of the one line the operator actually needs.
  //
  // `bucket` is PptxSlideErrorKind — a stable classification assigned at
  // the throw site in PptxSlideView, not derived from the message text.
  // That distinction matters: a totally-unreadable file's message happens
  // not to vary per slide, so keying on raw reason text "works" for that
  // one case — but an out-of-range ordinal's message embeds the ordinal
  // itself ("Slide 7 is missing..."), so every failing slide would
  // produce a distinct reason string and none would collapse. Keying on
  // the bucket instead of the text means a deck failing for the SAME
  // underlying cause from both mechanisms (the common case: a
  // missing/renamed file classifies as 'file-unreadable' whether caught
  // here or inside PptxSlideView) collapses to one entry regardless of
  // which mechanism reports it first, while genuinely different failure
  // kinds for the same deck still get distinct, honest lines.
  interface DeckWarning {
    kind: 'preload' | 'render'
    message: string
    /** Distinct slide ordinals counted so far (render kind only) — lets
     *  the message grow "N slides failed" without re-counting a slide
     *  that reports again (StrictMode's dev-mode double effect-invoke,
     *  or a card re-mounting after a scroll). */
    ordinals: Set<number>
  }
  const [deckWarnings, setDeckWarnings] = useState<Record<string, DeckWarning>>({})

  // Warm every PowerPoint deck referenced by this service up front. Two
  // reasons: it removes any stall on the first advance onto a pptx item,
  // and it surfaces a missing or corrupt file NOW — while the operator
  // can still fix it — instead of on slide 12 mid-service. loadPptxDeck
  // caches its parse promise per path, so this is a cheap no-op if a
  // grid thumbnail (below) already triggered the same parse.
  useEffect(() => {
    const paths = [
      ...new Set(
        state.items.flatMap((item) =>
          item.slides
            .filter(
              (s): s is Extract<SlidePayload, { kind: 'pptx-slide' }> =>
                s.kind === 'pptx-slide'
            )
            .map((s) => s.pptxPath)
        )
      )
    ]
    for (const path of paths) {
      void loadPptxDeck(path).catch((err) => {
        console.error('[ServiceMode] deck failed to preload', path, err)
        const fileName = path.split(/[/\\]/).pop() ?? path
        // A preload failure can only mean the file itself couldn't be
        // read/parsed — there's no ordinal involved, so it always
        // classifies as 'file-unreadable'.
        const bucket: PptxSlideErrorKind = 'file-unreadable'
        // Unconditional overwrite (not a merge) — a whole-file preload
        // failure is always the clearest framing for this key, whether
        // it arrives before or after any per-slide render failures that
        // share the same (path, bucket).
        setDeckWarnings((prev) => ({
          ...prev,
          [`${path}::${bucket}`]: {
            kind: 'preload',
            message: `${fileName} could not be opened. Its slides will not project.`,
            ordinals: new Set()
          }
        }))
      })
    }
  }, [state.items])

  // Stable across every render and every grid card — required because
  // this callback is threaded down into PptxSlideView's onError, which
  // sits in that component's effect dependency array. A fresh identity
  // per render would cancel and restart the in-flight slide render on
  // every unrelated ServiceMode re-render (video ticks, timer updates,
  // keystrokes), repeatedly, mid-service.
  const reportPptxError = useCallback(({ pptxPath, slideOrdinal, kind }: PptxThumbError) => {
    setDeckWarnings((prev) => {
      const key = `${pptxPath}::${kind}`
      const existing = prev[key]
      // A whole-deck preload failure already covers every slide in this
      // file for this same bucket — a per-slide render failure on top
      // of it is the same root cause, not new information.
      if (existing?.kind === 'preload') return prev
      const ordinals = new Set(existing?.ordinals)
      if (ordinals.has(slideOrdinal)) return prev
      ordinals.add(slideOrdinal)
      const fileName = pptxPath.split(/[/\\]/).pop() ?? pptxPath
      const n = ordinals.size
      const slides = `${n} slide${n === 1 ? '' : 's'}`
      // A partial render must not be reported as a failure. The slide DID
      // draw; some shape or image inside it did not. Telling a volunteer
      // "4 slides failed to render" minutes before a service, when the
      // slides are fine apart from one missing image each, reads as "this
      // deck is broken, pull it" — a false alarm that costs more than the
      // missing image does.
      const message =
        kind === 'partial-render'
          ? `${fileName} — ${slides} may be missing part of their content.`
          : `${fileName} — ${slides} failed to render.`
      return {
        ...prev,
        [key]: { kind: 'render', message, ordinals }
      }
    })
  }, [])

  const dismissDeckWarning = useCallback((key: string) => {
    setDeckWarnings((prev) => {
      if (!(key in prev)) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  }, [])

  const deckWarningItems: WarningItem[] = Object.entries(deckWarnings).map(([key, w]) => ({
    id: key,
    message: w.message
  }))

  // Flatten every slide of every item into one grid feed. Section label
  // and shortcut are derived here because the SlidePayload type (shared
  // with the output IPC) can't carry operator-only metadata. Note the
  // per-item `slideIdx` below is what `jumpTo` expects (the LOCAL index
  // within that item's own slides array) — it resets to 0 at every item
  // boundary rather than counting up across the whole service. Passing
  // a true flat/global counter here instead would send every item after
  // the first to the wrong slide.
  const grid = useMemo<GridEntry[]>(() => {
    const out: GridEntry[] = []
    state.items.forEach((item, itemIdx) => {
      item.slides.forEach((slide, slideIdx) => {
        if (slide.kind === 'text') {
          const label = slide.sectionLabel || item.label
          out.push({
            itemIndex: itemIdx,
            slideIndex: slideIdx,
            sectionLabel: label,
            shortcut: shortcutFromLabel(slide.sectionLabel ?? ''),
            lines: slide.lines
          })
        } else if (slide.kind === 'image') {
          out.push({
            itemIndex: itemIdx,
            slideIndex: slideIdx,
            sectionLabel: item.label,
            shortcut: '',
            lines: [],
            preview: { kind: 'image', path: slide.imagePath }
          })
        } else if (slide.kind === 'pdf-page') {
          out.push({
            itemIndex: itemIdx,
            slideIndex: slideIdx,
            sectionLabel: item.label,
            shortcut: `${slide.pageIndex}`,
            lines: [],
            preview: {
              kind: 'deck',
              pdfPath: slide.pdfPath,
              pageIndex: slide.pageIndex
            }
          })
        } else if (slide.kind === 'video') {
          out.push({
            itemIndex: itemIdx,
            slideIndex: slideIdx,
            sectionLabel: item.label,
            shortcut: '▶',
            lines: [],
            preview: { kind: 'video', path: slide.videoPath }
          })
        } else if (slide.kind === 'pptx-slide') {
          out.push({
            itemIndex: itemIdx,
            slideIndex: slideIdx,
            sectionLabel: item.label,
            shortcut: `${slide.slideOrdinal}`,
            lines: [],
            preview: {
              kind: 'pptx',
              pptxPath: slide.pptxPath,
              slideOrdinal: slide.slideOrdinal
            }
          })
        } else {
          // countdown
          out.push({
            itemIndex: itemIdx,
            slideIndex: slideIdx,
            sectionLabel: item.label,
            shortcut: '',
            lines: [slide.label, '⏱']
          })
        }
      })
    })
    return out
  }, [state.items])

  // Bucket the flat `grid` back into per-item groups for GROUPED mode.
  // No new derivation: each entry already carries the itemIndex it was
  // built from, so this is a straight re-grouping, not a recomputation
  // — the (itemIndex, slideIndex) pairs handed to jumpTo are identical
  // in both GROUPED and FLAT mode.
  const groups = useMemo(() => {
    const byItem = new Map<number, GridEntry[]>()
    for (const entry of grid) {
      const bucket = byItem.get(entry.itemIndex)
      if (bucket) bucket.push(entry)
      else byItem.set(entry.itemIndex, [entry])
    }
    return state.items
      .map((item, itemIndex) => ({
        item,
        itemIndex,
        entries: byItem.get(itemIndex) ?? []
      }))
      .filter((g) => g.entries.length > 0)
  }, [grid, state.items])

  const [gridMode, setGridMode] = useState<GridMode>('grouped')

  // Keep the active card in view as the operator advances via keyboard.
  // Query-by-attribute lets us avoid tracking a ref per card.
  useEffect(() => {
    const container = gridContainerRef.current
    if (!container) return
    const active = container.querySelector<HTMLElement>('[data-active="true"]')
    if (active) {
      active.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [state.itemIndex, state.slideIndex])

  // scrollIntoView({ block: 'nearest' }) below only ever respects the
  // ACTIVE card's own scroll-margin-top — it has no idea two sticky
  // layers (toolbar +, in GROUPED mode, the per-item header) paint over
  // the top of the scroll container. Composing both constants here
  // (rather than a second hardcoded number) is what keeps this in sync
  // if either sticky layer's height ever changes.
  const activeCardScrollMargin =
    gridMode === 'grouped' ? GRID_TOOLBAR_H + GRID_GROUP_HEADER_H : GRID_TOOLBAR_H

  const renderCard = (entry: GridEntry): JSX.Element => {
    const active =
      entry.itemIndex === state.itemIndex && entry.slideIndex === state.slideIndex
    // Per-card theme: use the per-item override if THAT slide's parent
    // item has one, else the merged base theme. This keeps each grid
    // card visually faithful to what its slide will actually look like
    // on the projector — songs with a per-song background show their
    // override, others share the global look.
    const cardItem = state.items[entry.itemIndex]
    const cardTheme = baseTheme
      ? mergeThemeOverride(baseTheme, cardItem?.themeOverride ?? null)
      : null
    return (
      <SlideCard
        key={`${entry.itemIndex}-${entry.slideIndex}`}
        sectionLabel={entry.sectionLabel}
        shortcut={entry.shortcut}
        lines={entry.lines}
        preview={entry.preview}
        onPreviewError={reportPptxError}
        theme={cardTheme}
        active={active}
        style={active ? { scrollMarginTop: activeCardScrollMargin } : undefined}
        onClick={() => jumpTo(entry.itemIndex, entry.slideIndex)}
      />
    )
  }

  // ── Jump-to filter (left rail) ───────────────────────────────────────
  // Case-insensitive label filter. Keeps each surviving row's ORIGINAL
  // index alongside it — jumpTo needs the true item index, not the
  // filtered list's position, or clicking a filtered row would jump to
  // the wrong item mid-service.
  const [itemFilter, setItemFilter] = useState('')
  const filteredItems = useMemo(() => {
    const q = itemFilter.trim().toLowerCase()
    return state.items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => !q || item.label.toLowerCase().includes(q))
  }, [state.items, itemFilter])

  // ── Display mode segmented control (LIVE / BLACK / LOGO) ─────────────
  // Presentational wrapper over the existing toggleBlack/toggleLogo
  // actions — there is no separate "setMode" action, and adding one
  // would duplicate the state machine the B/L keys already exercise.
  // Clicking the ALREADY-active segment is a no-op (not a toggle-off):
  // a mode selector shouldn't flip back to LIVE just because you
  // clicked BLACK a second time.
  const handleDisplayModeChange = (mode: OutputMode): void => {
    if (mode === state.displayMode) return
    if (mode === 'black') toggleBlack()
    else if (mode === 'logo') toggleLogo()
    else if (state.displayMode === 'black') toggleBlack()
    else if (state.displayMode === 'logo') toggleLogo()
  }

  const mirrorCut = state.displayMode !== 'live'
  // Feed <VideoRunway> the latest broadcast IF it names the slide
  // that's actually on screen right now; otherwise show a fresh-slide
  // default rather than a stale reading from the previous video.
  const videoUpdateForCurrent: VideoTimeUpdate | null =
    currentSlide?.kind === 'video'
      ? videoTimeUpdate && videoTimeUpdate.videoPath === currentSlide.videoPath
        ? videoTimeUpdate
        : {
            videoPath: currentSlide.videoPath,
            currentTime: 0,
            duration: NaN,
            paused: videoControl.paused
          }
      : null

  return (
    <div className="relative flex h-screen w-screen flex-col bg-background text-foreground">
      {/* ── Top bar ──────────────────────────────────────────────────── */}
      <header className="flex h-14 shrink-0 items-center justify-between gap-5 border-b border-border bg-card px-[18px]">
        <div className="flex min-w-0 items-center gap-5">
          <div className="min-w-0">
            <div className="truncate text-[14px] font-bold tracking-[-0.01em] text-foreground">
              {state.setlistName}
            </div>
            <div className="mt-0.5 font-mono text-[9.5px] font-medium tracking-[0.08em] text-muted-foreground">
              ITEM {state.itemIndex + 1} OF {state.items.length} · SLIDE{' '}
              {state.slideIndex + 1} OF {currentItem?.slides.length ?? 0}
            </div>
          </div>
          <ElapsedTimer startedAt={state.startedAt} />
        </div>

        <div className="flex shrink-0 items-center gap-3.5">
          <Segmented
            options={DISPLAY_MODE_OPTIONS}
            value={state.displayMode}
            onChange={handleDisplayModeChange}
          />
          <div className="flex gap-1.5">
            <SquareIconButton label="B" title="Blackout (B)" onClick={toggleBlack} />
            <SquareIconButton label="L" title="Logo / standby (L)" onClick={toggleLogo} />
            <SquareIconButton
              label="?"
              title="Keyboard shortcuts (?)"
              onClick={toggleCheatSheet}
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onExit}
            title="Exit (Esc)"
            className="border-signal-deep text-signal hover:border-signal-deep hover:bg-signal-deep hover:text-white"
          >
            EXIT
          </Button>
        </div>
      </header>

      {/* Deck warnings — preload failures at entry + per-slide render
          failures during the service, both routed through
          reportPptxError/deckWarnings above. Operator-only: see
          WarningBanner.tsx for why this can never reach the projector. */}
      <WarningBanner items={deckWarningItems} onDismiss={dismissDeckWarning} />

      {/* Main: three-panel layout
          ┌─ items list ─┬──── slide grid ────┬─ confidence ─┐
          │   (narrow)   │      (flex)         │   (fixed)    │
          └──────────────┴─────────────────────┴──────────────┘
      */}
      <section className="flex min-h-0 flex-1">
        {/* ── Items sidebar ────────────────────────────────────────────
            Coarse navigator: click any row to jump to that item's first
            slide. Width is operator-adjustable via the resize handle to
            its right. The "Jump to…" filter narrows the list by label
            without renumbering — each row keeps its TRUE item index so
            jumpTo always lands correctly. */}
        <aside
          style={{ width: `${itemsPanel.width}px` }}
          className="flex shrink-0 flex-col border-r border-border bg-card"
        >
          <div className="shrink-0 border-b border-border px-3.5 py-[11px]">
            <MonoLabel>ITEMS · {state.items.length}</MonoLabel>
          </div>
          <div className="shrink-0 border-b border-border p-2.5">
            <input
              type="text"
              value={itemFilter}
              onChange={(e) => setItemFilter(e.target.value)}
              placeholder="Jump to…"
              aria-label="Filter items by label"
              className="w-full border border-border bg-background px-2.5 py-2 font-mono text-[11px] font-medium tracking-[0.06em] text-foreground outline-none placeholder:text-muted-foreground focus:border-signal"
            />
          </div>
          <ol className="min-h-0 flex-1 overflow-y-auto scroll-hairline">
            {filteredItems.map(({ item, index }) => {
              const isActive = index === state.itemIndex
              return (
                <li key={item.id} className="border-b border-rule">
                  <button
                    type="button"
                    onClick={() => jumpTo(index, 0)}
                    className={`block w-full border-l-2 px-3.5 py-3 text-left transition-colors ${
                      isActive
                        ? 'border-l-signal bg-ember'
                        : 'border-l-transparent hover:bg-panel-hi'
                    }`}
                  >
                    <span className="flex items-baseline gap-2">
                      <span className="w-4 shrink-0 text-right font-mono text-[10px] font-medium text-dim">
                        {index + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-foreground">
                        {item.label}
                      </span>
                    </span>
                    <span className="mt-1 block pl-[18px] font-mono text-[9px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                      {item.kind} · {item.slides.length}
                    </span>
                  </button>
                </li>
              )
            })}
            {filteredItems.length === 0 && (
              <li className="px-3.5 py-6 text-center text-[11px] text-muted-foreground">
                No items match “{itemFilter}”.
              </li>
            )}
          </ol>
        </aside>

        {/* ── Resize handle (items sidebar | grid) ────────────────────── */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize items sidebar"
          onMouseDown={itemsPanel.startResize('right')}
          className="group relative flex w-1 shrink-0 cursor-col-resize select-none items-center justify-center bg-border transition-colors hover:bg-signal/40 active:bg-signal/60"
        >
          <div className="absolute inset-y-0 -left-1.5 -right-1.5" />
        </div>

        {/* ── Slide grid (center) ──────────────────────────────────────
            Fine navigator: every slide in the whole service as its own
            clickable card. GROUPED (default) shows one block per item
            with a sticky header; FLAT shows one continuous grid. Both
            sticky layers (toolbar + group headers) share GRID_TOOLBAR_H
            so they can't drift apart while scrolling. */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div
            ref={gridContainerRef}
            className="min-h-0 flex-1 overflow-y-auto scroll-hairline"
          >
            <div
              className="sticky top-0 z-[2] flex items-center justify-between border-b border-border bg-card px-4"
              style={{ height: GRID_TOOLBAR_H }}
            >
              <MonoLabel>ALL SLIDES · {grid.length}</MonoLabel>
              <div className="flex items-center gap-3">
                <span className="font-mono text-[9px] font-medium tracking-[0.08em] text-dim">
                  CLICK TO JUMP · SPACE TO ADVANCE
                </span>
                <Segmented size="sm" options={GRID_MODE_OPTIONS} value={gridMode} onChange={setGridMode} />
              </div>
            </div>

            {gridMode === 'grouped'
              ? groups.map(({ item, itemIndex, entries }) => {
                  const isActiveGroup = itemIndex === state.itemIndex
                  return (
                    <div key={item.id}>
                      <div
                        // border-b-border (not the general border-border) is
                        // deliberate: mixing an all-sides border-color utility
                        // with a side-specific border-l-* color on the same
                        // element is a genuine Tailwind cascade hazard — both
                        // compile to same-specificity rules, so whichever one
                        // Tailwind happens to emit LATER in the stylesheet
                        // wins, regardless of class order in this string.
                        // Keeping both colors side-specific (border-b-* vs
                        // border-l-*) sidesteps that entirely.
                        className={`sticky z-[1] flex items-center gap-3 border-b border-b-border border-l-2 bg-card px-4 ${
                          isActiveGroup ? 'border-l-signal' : 'border-l-transparent'
                        }`}
                        style={{ top: GRID_TOOLBAR_H, height: GRID_GROUP_HEADER_H }}
                      >
                        <span className="font-mono text-[9.5px] font-medium text-dim">
                          {itemIndex + 1}
                        </span>
                        <span className="truncate text-[12px] font-bold tracking-[-0.01em] text-foreground">
                          {item.label}
                        </span>
                        <span className="shrink-0 font-mono text-[8.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                          {item.kind} · {item.slides.length}
                        </span>
                        <span className="ml-auto shrink-0 font-mono text-[9px] font-medium tracking-[0.08em] text-dim">
                          {formatEstimatedRuntime(durationById.get(item.id))}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-3 p-4">
                        {entries.map((entry) => renderCard(entry))}
                      </div>
                    </div>
                  )
                })
              : (
                <div className="grid grid-cols-3 gap-3 p-4">
                  {grid.map((entry) => renderCard(entry))}
                </div>
              )}
          </div>
        </div>

        {/* ── Resize handle (grid | confidence monitor) ───────────────── */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize confidence monitor"
          onMouseDown={sidePanel.startResize('left')}
          className="group relative flex w-1 shrink-0 cursor-col-resize select-none items-center justify-center bg-border transition-colors hover:bg-signal/40 active:bg-signal/60"
        >
          <div className="absolute inset-y-0 -left-1.5 -right-1.5" />
        </div>

        {/* ── Confidence monitor (right) ───────────────────────────────
            Width is operator-adjustable via the resize handle to the
            left; clamped between 280 and 720 px in usePanelWidth. */}
        <aside
          style={{ width: `${sidePanel.width}px` }}
          className="flex shrink-0 flex-col border-l border-border bg-card"
        >
          <div className="flex shrink-0 items-center gap-[9px] border-b border-border px-4 py-[11px]">
            <StatusDot tone="signal" pulse="fast" />
            <MonoLabel tone="signal">ON SCREEN</MonoLabel>
            {currentItem && <MonoLabel tone="muted">· {currentItem.label}</MonoLabel>}
          </div>

          <div className="flex-none p-4">
            {/* The confidence monitor is a literal pixel mirror of the
                projector via desktopCapturer (Option C). This eliminates
                rendering drift between operator and output for ALL
                slide types — text, scripture, image, video, PDF — by
                capturing the actual output pixels rather than rendering
                an independent copy. */}
            <div
              className={`relative aspect-video overflow-hidden border bg-black ${
                mirrorCut ? 'border-signal' : 'border-border'
              }`}
            >
              <OutputMirror />
              {mirrorCut && (
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-signal/[0.06]">
                  <span className="font-mono text-[15px] tracking-[0.2em] text-signal">
                    {state.displayMode === 'black' ? 'BLACKOUT' : 'LOGO · STANDBY'}
                  </span>
                  <span className="text-[11px] text-soft">
                    The congregation sees nothing. Press again to resume.
                  </span>
                </div>
              )}
            </div>
            {currentSlide?.kind === 'text' && currentSlide.sectionLabel && (
              <div className="mt-1.5 text-[11px] text-soft">{currentSlide.sectionLabel}</div>
            )}

            {/* Video playback runway — only visible while a video slide
                is active. Pause and mute mirror the projector and the
                keyboard shortcuts (P / M). */}
            {isVideoSlide && currentSlide?.kind === 'video' && videoUpdateForCurrent && (
              <VideoRunway
                update={videoUpdateForCurrent}
                loop={currentSlide.loop ?? true}
                paused={videoControl.paused}
                muted={videoControl.muted}
                onTogglePause={togglePause}
                onToggleMute={toggleMute}
              />
            )}
          </div>

          <div className="px-4">
            <ServiceNextPanel
              items={state.items}
              itemIndex={state.itemIndex}
              slideIndex={state.slideIndex}
            />
          </div>

          {/* Live notes — editable during service, broadcast to the
              stage monitor. Always mounted so the operator can add
              notes to items that didn't have any in the song record
              (announcements, sermon timing, prayer cues). Edits are
              ephemeral: switching items resets to the song's saved
              notes. The stage monitor mirrors this in real time. */}
          <div className="mt-4 flex min-h-0 flex-1 flex-col border-t border-border">
            <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-[11px]">
              <MonoLabel>NOTES · LIVE TO STAGE</MonoLabel>
              <MonoLabel tone="dim">EPHEMERAL</MonoLabel>
            </div>
            {liveNotes !== (currentItem?.notes ?? '') && (
              <div className="flex shrink-0 justify-end border-b border-rule px-4 py-1">
                <button
                  type="button"
                  onClick={() => setLiveNotes(currentItem?.notes ?? '')}
                  className="text-[10px] text-muted-foreground hover:text-foreground"
                  title="Reset to the saved notes for this item"
                >
                  Reset to saved notes
                </button>
              </div>
            )}
            <textarea
              value={liveNotes}
              onChange={(e) => setLiveNotes(e.target.value)}
              placeholder="Type announcements, prayer cues, sermon notes…"
              className="min-h-0 flex-1 resize-none bg-background px-4 py-3.5 text-[12.5px] leading-[1.7] text-bone outline-none placeholder:text-muted-foreground"
            />
          </div>
        </aside>
      </section>

      {/* ── Lower thirds bottom strip ────────────────────────────────
          Only mounted when the lower thirds chroma-key window is
          enabled in Settings → Output. Auto-follow mode: songs
          auto-populate and auto-show; non-songs auto-hide. The
          operator can edit on the fly (typing pushes immediately)
          and can manually hide via the toggle button. Per-item
          edits are intentionally ephemeral — advancing to a new
          item re-runs the auto-follow effect. */}
      {lowerThirdsEnabled && (
        <div className="flex shrink-0 items-center gap-3 border-t border-border bg-card px-[18px] py-[11px]">
          <MonoLabel tone="signal" className="shrink-0">
            LOWER THIRDS
          </MonoLabel>
          <input
            type="text"
            value={lowerThirdsContent.title}
            onChange={(e) =>
              pushLowerThirdsManual({ ...lowerThirdsContent, title: e.target.value })
            }
            placeholder="Title (auto-fills from songs)"
            className="min-w-0 flex-1 border border-border bg-background px-3 py-[9px] text-[12.5px] font-medium text-foreground outline-none placeholder:text-muted-foreground focus:border-signal"
          />
          <input
            type="text"
            value={lowerThirdsContent.subtitle}
            onChange={(e) =>
              pushLowerThirdsManual({ ...lowerThirdsContent, subtitle: e.target.value })
            }
            placeholder="Subtitle (author, role, reference)"
            className="w-[260px] shrink-0 border border-border bg-background px-3 py-[9px] text-[12.5px] text-bone outline-none placeholder:text-muted-foreground focus:border-signal"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              pushLowerThirdsManual({ ...lowerThirdsContent, visible: !lowerThirdsContent.visible })
            }
            disabled={
              !lowerThirdsContent.visible && lowerThirdsContent.title.trim().length === 0
            }
            className={
              lowerThirdsContent.visible
                ? 'shrink-0 border-signal-deep text-signal hover:border-signal-deep hover:bg-signal-deep hover:text-white'
                : 'shrink-0'
            }
            title={
              !lowerThirdsContent.visible && lowerThirdsContent.title.trim().length === 0
                ? 'Type a title first or navigate to a song'
                : lowerThirdsContent.visible
                  ? 'Hide lower thirds'
                  : 'Show lower thirds on the OBS feed'
            }
          >
            {lowerThirdsContent.visible ? 'HIDE' : 'SHOW'}
          </Button>
          <span className="shrink-0 font-mono text-[9px] font-medium tracking-[0.08em] text-dim">
            {lowerThirdsStatusLabel}
          </span>
        </div>
      )}

      {state.showCheatSheet && <KeyCheatSheet onClose={toggleCheatSheet} />}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// usePanelWidth — local hook for resizable side panels in Service Mode
// ─────────────────────────────────────────────────────────────────────────────

interface PanelWidthOptions {
  storageKey: string
  defaultPx: number
  min: number
  max: number
}

interface PanelWidthHandle {
  /** Current width in CSS pixels — apply via inline style to the panel */
  width: number
  /**
   * mousedown handler for the resize handle. `direction` controls which
   * way drag-positive grows the panel:
   *   - 'right': drag-right grows the panel (left-anchored panel)
   *   - 'left':  drag-left grows the panel  (right-anchored panel)
   */
  startResize: (direction: 'left' | 'right') => (e: React.MouseEvent) => void
}

function usePanelWidth({
  storageKey,
  defaultPx,
  min,
  max
}: PanelWidthOptions): PanelWidthHandle {
  const [width, setWidth] = useState<number>(() => {
    if (typeof window === 'undefined') return defaultPx
    const stored = window.localStorage.getItem(storageKey)
    if (!stored) return defaultPx
    const n = Number(stored)
    if (!Number.isFinite(n)) return defaultPx
    return Math.max(min, Math.min(max, n))
  })

  // Persist on every committed change. Cheap because state only updates
  // on mouseup — see the closure-based drag below.
  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, String(width))
    } catch {
      /* ignore quota / private browsing */
    }
  }, [storageKey, width])

  const startResize = useCallback(
    (direction: 'left' | 'right') => {
      return (e: React.MouseEvent): void => {
        e.preventDefault()
        const startX = e.clientX
        const startWidth = width

        const onMove = (ev: MouseEvent): void => {
          // For a left-anchored panel (items sidebar), drag-right grows
          // it: deltaX = ev.clientX - startX. For a right-anchored
          // panel (confidence monitor), drag-left grows it: invert.
          const deltaX = ev.clientX - startX
          const delta = direction === 'right' ? deltaX : -deltaX
          const next = Math.max(min, Math.min(max, startWidth + delta))
          setWidth(next)
        }
        const onUp = (): void => {
          document.removeEventListener('mousemove', onMove)
          document.removeEventListener('mouseup', onUp)
        }
        document.addEventListener('mousemove', onMove)
        document.addEventListener('mouseup', onUp)
      }
    },
    [width, min, max]
  )

  return { width, startResize }
}

// ─────────────────────────────────────────────────────────────────────────────
// Little pieces
// ─────────────────────────────────────────────────────────────────────────────

/** 32px square toolbar button — B / L / ? in the top bar. */
function SquareIconButton({
  label,
  title,
  onClick
}: {
  label: string
  title: string
  onClick: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="flex h-8 w-8 items-center justify-center border border-border bg-transparent font-mono text-[10px] font-semibold text-soft transition-colors hover:border-white hover:text-white"
    >
      {label}
    </button>
  )
}

function ElapsedTimer({ startedAt }: { startedAt: string }): JSX.Element {
  // Force re-render every second so the clock ticks
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [])

  const elapsedMs = Date.now() - new Date(startedAt).getTime()
  const totalSec = Math.max(0, Math.floor(elapsedMs / 1000))
  const mm = Math.floor(totalSec / 60)
  const ss = totalSec % 60

  return (
    <div className="font-mono text-[20px] font-semibold tabular-nums text-bone">
      {mm}:{String(ss).padStart(2, '0')}
    </div>
  )
}
