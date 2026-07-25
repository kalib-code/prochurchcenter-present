/**
 * ServiceMode — the operator view during a live service.
 *
 * Layout (pixel rough):
 *
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │ [name]          [timer]               [mode]     [? ×]       │
 *   ├──────────────────────────────┬──────────────────────────────┤
 *   │                              │                              │
 *   │  CURRENT SLIDE (big)         │  NEXT SLIDE (smaller)        │
 *   │                              │                              │
 *   ├──────────────────────────────┴──────────────────────────────┤
 *   │  Operator notes (if any)                                     │
 *   ├─────────────────────────────────────────────────────────────┤
 *   │  Upcoming item list (scrollable, click to jump)              │
 *   └─────────────────────────────────────────────────────────────┘
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
import { WarningBanner, type WarningItem } from '../components/ui/WarningBanner'
import type { PptxThumbError } from '../components/MediaPreview'
import { useKeyboard } from '../hooks/useKeyboard'
import type { Song } from '@shared/types'
import type { VideoControl, LowerThirdsContent, SlidePayload } from '@shared/ipc-contract'

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

  // If no setlist id, bail
  if (!setlistId) {
    return <div className="p-6">No setlist id.</div>
  }

  // ── LOADING ────────────────────────────────────────────────────────────
  if (state.mode === 'idle') {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-black text-white">
        <div className="text-center">
          <div className="text-lg">Preparing service…</div>
          <div className="mt-2 text-xs text-white/50">
            If this sticks, the setlist might be empty or missing songs.
          </div>
          <button
            onClick={() => navigate('/')}
            className="mt-6 text-xs underline opacity-70 hover:opacity-100"
          >
            Cancel → Home
          </button>
        </div>
      </div>
    )
  }

  // ── ENDED ──────────────────────────────────────────────────────────────
  if (state.mode === 'ended') {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center gap-6 bg-black text-white">
        <div className="text-center">
          <div className="text-sm uppercase tracking-widest text-white/50">
            Service ended
          </div>
          <div className="mt-2 text-3xl font-semibold">{state.setlistName}</div>
          <div className="mt-2 text-sm text-white/70">
            Started {new Date(state.startedAt).toLocaleTimeString()}
          </div>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => {
              exit()
              navigate('/')
            }}
            className="rounded-md bg-white px-4 py-2 text-sm font-medium text-black hover:opacity-90"
          >
            Back to Home
          </button>
        </div>
      </div>
    )
  }

  // ── RUNNING ────────────────────────────────────────────────────────────
  return <RunningView state={state} jumpTo={jumpTo} toggleBlack={toggleBlack} toggleLogo={toggleLogo} toggleCheatSheet={toggleCheatSheet} onExit={() => {
    const ok = window.confirm('Exit service mode?')
    if (!ok) return
    exit()
    navigate('/')
  }} />
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

function RunningView({
  state,
  jumpTo,
  toggleBlack,
  toggleLogo,
  toggleCheatSheet,
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
  // needs one line.
  const itemsPanel = usePanelWidth({
    storageKey: 'present:itemsPanelWidth',
    defaultPx: 176, // 11rem
    min: 140,
    max: 360
  })
  const sidePanel = usePanelWidth({
    storageKey: 'present:sidePanelWidth',
    defaultPx: 448, // 28rem
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

  // Reset + broadcast whenever the active slide changes. Fires for every
  // navigation, not just video → video transitions, so the broadcast is
  // idempotent (output window has a cached last state and will re-apply
  // the default cleanly).
  useEffect(() => {
    const fresh: VideoControl = { paused: false, muted: false }
    setVideoControl(fresh)
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
    if (currentItem?.kind === 'song' && currentSlide?.kind === 'text') {
      const lyrics = currentSlide.lines.join('\n').trim()
      if (lyrics) {
        // Lyrics-only mode: just the verse text, no song-title or
        // author subtitle. The operator can still type a subtitle
        // manually if they want one for a particular song.
        pushLowerThirds({
          visible: true,
          title: lyrics,
          subtitle: ''
        })
        return
      }
    }
    // Everything else: hide. Includes non-song items, blank/empty
    // song slides, and any slide kind we don't have a good
    // auto-population strategy for.
    pushLowerThirds({ visible: false, title: '', subtitle: '' })
  }, [currentItem, currentSlide, lowerThirdsEnabled, pushLowerThirds])

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
    const nextSlide =
      state.slideIndex + 1 < slides.length
        ? slides[state.slideIndex + 1]
        : null
    void window.api.output.setStageContext({
      currentSlide: currentSlide ?? null,
      nextSlide,
      itemLabel: currentItem?.label ?? '',
      slideIndex: state.slideIndex,
      totalSlides: slides.length,
      notes: liveNotes
    })
  }, [currentItem, currentSlide, state.slideIndex, liveNotes])
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
  // Keyed by `${pptxPath}::${reason}` rather than an array of composed
  // strings. Two mechanisms feed this: the warm-on-entry preload below
  // (one shot, whole-file) and reportPptxError (one call per failing
  // slide's PptxThumb — see MediaPreview.tsx). The grid is unvirtualized,
  // so a single broken deck can fail on all N of its slides at once;
  // without this keying, that produces N near-identical banner lines
  // (plus a 41st from preload) instead of the one line the operator
  // actually needs. Keying on (path, reason) — not just path — means a
  // deck that fails for the SAME underlying reason from both mechanisms
  // (the common case: a missing/renamed file throws the identical
  // "Could not read ... " message from loadPptxDeck whether it's caught
  // here or inside PptxSlideView) collapses to one entry regardless of
  // which mechanism reports it first; a deck failing for two genuinely
  // different reasons still gets two distinct, honest lines.
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
        const reason = err instanceof Error ? err.message : String(err)
        const fileName = path.split(/[/\\]/).pop() ?? path
        // Unconditional overwrite (not a merge) — a whole-file preload
        // failure is always the clearest framing for this key, whether
        // it arrives before or after any per-slide render failures that
        // share the same (path, reason).
        setDeckWarnings((prev) => ({
          ...prev,
          [`${path}::${reason}`]: {
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
  const reportPptxError = useCallback(({ pptxPath, slideOrdinal, reason }: PptxThumbError) => {
    setDeckWarnings((prev) => {
      const key = `${pptxPath}::${reason}`
      const existing = prev[key]
      // A whole-deck preload failure already covers every slide in this
      // file for this same reason — a per-slide render failure on top
      // of it is the same root cause, not new information.
      if (existing?.kind === 'preload') return prev
      const ordinals = new Set(existing?.ordinals)
      if (ordinals.has(slideOrdinal)) return prev
      ordinals.add(slideOrdinal)
      const fileName = pptxPath.split(/[/\\]/).pop() ?? pptxPath
      const n = ordinals.size
      return {
        ...prev,
        [key]: {
          kind: 'render',
          message: `${fileName} — ${n} slide${n === 1 ? '' : 's'} failed to render.`,
          ordinals
        }
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
  // with the output IPC) can't carry operator-only metadata.
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

  return (
    <div className="flex h-screen w-screen flex-col bg-neutral-950 text-white">
      {/* Top bar */}
      <header className="flex shrink-0 items-center gap-4 border-b border-white/10 px-5 py-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{state.setlistName}</div>
          <div className="text-xs text-white/50">
            Item {state.itemIndex + 1} of {state.items.length} ·
            Slide {state.slideIndex + 1} of {currentItem?.slides.length ?? 0}
          </div>
        </div>

        <ElapsedTimer startedAt={state.startedAt} />

        <div className="ml-auto flex items-center gap-2">
          <ModePill label="LIVE" active={state.displayMode === 'live'} />
          <ModePill label="BLACK" active={state.displayMode === 'black'} />
          <ModePill label="LOGO" active={state.displayMode === 'logo'} />
        </div>

        <div className="flex gap-1">
          <button
            onClick={toggleBlack}
            className="rounded border border-white/20 px-2 py-1 text-xs hover:bg-white/10"
            title="B"
          >
            B
          </button>
          <button
            onClick={toggleLogo}
            className="rounded border border-white/20 px-2 py-1 text-xs hover:bg-white/10"
            title="L"
          >
            L
          </button>
          <button
            onClick={toggleCheatSheet}
            className="rounded border border-white/20 px-2 py-1 text-xs hover:bg-white/10"
            title="?"
          >
            ?
          </button>
          <button
            onClick={onExit}
            className="rounded border border-red-500/60 px-2 py-1 text-xs text-red-300 hover:bg-red-500/20"
            title="Esc"
          >
            Exit
          </button>
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
            slide. Lets the operator "skip to closing song" or "jump to
            the scripture reading" without eyeballing the grid. Width
            is operator-adjustable via the resize handle to its right. */}
        <aside
          style={{ width: `${itemsPanel.width}px` }}
          className="flex shrink-0 flex-col border-r border-white/10"
        >
          <div className="px-3 pt-3 text-[10px] font-semibold uppercase tracking-widest text-white/50">
            Items · {state.items.length}
          </div>
          <ol className="flex-1 overflow-y-auto p-2">
            {state.items.map((item, idx) => {
              const isActive = idx === state.itemIndex
              return (
                <li key={item.id}>
                  <button
                    onClick={() => jumpTo(idx, 0)}
                    className={`mb-1 flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors ${
                      isActive
                        ? 'bg-amber-400/10 text-amber-200'
                        : 'text-white/70 hover:bg-white/5'
                    }`}
                  >
                    <span className="w-4 shrink-0 text-right text-[10px] text-white/40">
                      {idx + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {item.label}
                      </span>
                      <span className="block text-[9px] uppercase tracking-wide text-white/40">
                        {item.kind} · {item.slides.length}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ol>
        </aside>

        {/* ── Resize handle (items sidebar | grid) ────────────────────── */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize items sidebar"
          onMouseDown={itemsPanel.startResize('right')}
          className="group relative flex w-1 shrink-0 cursor-col-resize select-none items-center justify-center bg-white/5 transition-colors hover:bg-brand/40 active:bg-brand/60"
        >
          <div className="absolute inset-y-0 -left-1.5 -right-1.5" />
        </div>

        {/* ── Slide grid (center) ──────────────────────────────────────
            Fine navigator: every slide in the whole service as its own
            clickable card. Click to jump to that exact slide. */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="px-3 pt-3 text-[10px] font-semibold uppercase tracking-widest text-white/50">
            All Slides · {grid.length}
          </div>
          <div
            ref={gridContainerRef}
            className="flex-1 overflow-y-auto p-3"
          >
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-3 2xl:grid-cols-4">
              {grid.map((entry) => {
                const active =
                  entry.itemIndex === state.itemIndex &&
                  entry.slideIndex === state.slideIndex
                // Per-card theme: use the per-item override if THAT
                // slide's parent item has one, else the merged base
                // theme. This keeps each grid card visually faithful
                // to what its slide will actually look like on the
                // projector — songs with a per-song background show
                // their override, others share the global look.
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
                    onClick={() => jumpTo(entry.itemIndex, entry.slideIndex)}
                  />
                )
              })}
            </div>
          </div>
        </div>

        {/* ── Resize handle (grid | confidence monitor) ───────────────── */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize confidence monitor"
          onMouseDown={sidePanel.startResize('left')}
          className="group relative flex w-1 shrink-0 cursor-col-resize select-none items-center justify-center bg-white/5 transition-colors hover:bg-brand/40 active:bg-brand/60"
        >
          <div className="absolute inset-y-0 -left-1.5 -right-1.5" />
        </div>

        {/* ── Confidence monitor (right) ───────────────────────────────
            Byte-for-byte preview of what's on the projector right now.
            Width is operator-adjustable via the resize handle to the
            left; clamped between 280 and 720 px in usePanelWidth. */}
        <aside
          style={{ width: `${sidePanel.width}px` }}
          className="flex shrink-0 flex-col border-l border-white/10 p-3"
        >
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-white/50">
            On Screen{' '}
            {currentItem && (
              <span className="text-white/30">· {currentItem.label}</span>
            )}
          </div>
          {/* The confidence monitor is a literal pixel mirror of
              the projector via desktopCapturer (Option C). This
              eliminates rendering drift between operator and
              output for ALL slide types — text, scripture, image,
              video, PDF — by capturing the actual output pixels
              rather than rendering an independent copy. Same
              approach we already used for video slides, just
              hoisted up so it applies to every slide kind. */}
          <div className="aspect-video overflow-hidden rounded-md border border-white/10 bg-black">
            <OutputMirror />
          </div>
          {currentSlide?.kind === 'text' && currentSlide.sectionLabel && (
            <div className="mt-1 text-xs text-white/50">
              {currentSlide.sectionLabel}
            </div>
          )}

          {/* Video playback controls — only visible while a video slide
              is active. Pause and mute mirror the projector and the
              keyboard shortcuts (P / M). Buttons are large enough to
              hit without precision because Ate Rose may be standing. */}
          {isVideoSlide && (
            <div className="mt-3 flex items-center gap-2 rounded-md border border-white/10 bg-white/5 p-2">
              <button
                onClick={togglePause}
                className={`flex h-9 flex-1 items-center justify-center gap-2 rounded text-[11px] font-semibold uppercase tracking-wider transition-colors ${
                  videoControl.paused
                    ? 'bg-brand text-brand-foreground hover:bg-brand/90'
                    : 'border border-white/20 text-white/80 hover:border-white/40 hover:text-white'
                }`}
                title="Toggle pause (P)"
              >
                <span aria-hidden="true">
                  {videoControl.paused ? '▶' : '❚❚'}
                </span>
                {videoControl.paused ? 'Resume' : 'Pause'}
                <span className="text-[9px] opacity-60">P</span>
              </button>
              <button
                onClick={toggleMute}
                className={`flex h-9 flex-1 items-center justify-center gap-2 rounded text-[11px] font-semibold uppercase tracking-wider transition-colors ${
                  videoControl.muted
                    ? 'bg-destructive/20 text-destructive border border-destructive/40'
                    : 'border border-white/20 text-white/80 hover:border-white/40 hover:text-white'
                }`}
                title="Toggle mute (M)"
              >
                <span aria-hidden="true">
                  {videoControl.muted ? '🔇' : '🔊'}
                </span>
                {videoControl.muted ? 'Muted' : 'Sound on'}
                <span className="text-[9px] opacity-60">M</span>
              </button>
            </div>
          )}

          {/* Live notes — editable during service, broadcast to the
              stage monitor. Always mounted so the operator can add
              notes to items that didn't have any in the song record
              (announcements, sermon timing, prayer cues). Edits are
              ephemeral: switching items resets to the song's saved
              notes. The stage monitor mirrors this in real time. */}
          <div className="mt-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-white/10 bg-white/5">
            <div className="flex items-center justify-between border-b border-white/5 px-3 py-1.5">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-white/40">
                Notes (live to stage)
              </div>
              {liveNotes !== (currentItem?.notes ?? '') && (
                <button
                  type="button"
                  onClick={() => setLiveNotes(currentItem?.notes ?? '')}
                  className="text-[10px] text-white/40 hover:text-white/70"
                  title="Reset to the saved notes for this item"
                >
                  Reset
                </button>
              )}
            </div>
            <textarea
              value={liveNotes}
              onChange={(e) => setLiveNotes(e.target.value)}
              placeholder="Type announcements, prayer cues, sermon notes…"
              className="min-h-[6rem] flex-1 resize-none whitespace-pre-wrap bg-transparent p-3 text-xs leading-relaxed text-white/85 outline-none placeholder:text-white/30"
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
        <div className="flex shrink-0 items-center gap-2 border-t border-white/10 bg-neutral-900 px-4 py-2">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-white/40">
            Lower Thirds
          </span>
          <input
            type="text"
            value={lowerThirdsContent.title}
            onChange={(e) =>
              pushLowerThirds({ ...lowerThirdsContent, title: e.target.value })
            }
            placeholder="Title (auto-fills from songs)"
            className="min-w-0 flex-1 rounded border border-white/10 bg-black/40 px-2 py-1 text-xs outline-none placeholder:text-white/30 focus:border-brand"
          />
          <input
            type="text"
            value={lowerThirdsContent.subtitle}
            onChange={(e) =>
              pushLowerThirds({
                ...lowerThirdsContent,
                subtitle: e.target.value
              })
            }
            placeholder="Subtitle (author, role, reference)"
            className="min-w-0 flex-1 rounded border border-white/10 bg-black/40 px-2 py-1 text-xs outline-none placeholder:text-white/30 focus:border-brand"
          />
          <button
            type="button"
            onClick={() =>
              pushLowerThirds({
                ...lowerThirdsContent,
                visible: !lowerThirdsContent.visible
              })
            }
            disabled={
              !lowerThirdsContent.visible &&
              lowerThirdsContent.title.trim().length === 0
            }
            className={`rounded px-3 py-1 text-[11px] font-semibold uppercase tracking-wider transition-colors ${
              lowerThirdsContent.visible
                ? 'bg-destructive/20 text-destructive border border-destructive/40'
                : 'bg-brand text-brand-foreground hover:bg-brand/90 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30'
            }`}
            title={
              !lowerThirdsContent.visible &&
              lowerThirdsContent.title.trim().length === 0
                ? 'Type a title first or navigate to a song'
                : lowerThirdsContent.visible
                  ? 'Hide lower thirds'
                  : 'Show lower thirds on the OBS feed'
            }
          >
            {lowerThirdsContent.visible ? 'Hide' : 'Show'}
          </button>
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

function ModePill({ label, active }: { label: string; active: boolean }): JSX.Element {
  return (
    <span
      className={`rounded px-2 py-0.5 text-[10px] font-semibold tracking-wider ${
        active ? 'bg-white text-black' : 'text-white/30'
      }`}
    >
      {label}
    </span>
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
    <div className="text-sm tabular-nums text-white/70">
      {mm}:{String(ss).padStart(2, '0')}
    </div>
  )
}
