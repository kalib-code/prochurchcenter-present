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
import { SlideRenderer } from '../components/SlideRenderer'
import { SlideCard } from '../components/SlideCard'
import { KeyCheatSheet } from '../components/KeyCheatSheet'
import { useKeyboard } from '../hooks/useKeyboard'
import type { Song } from '@shared/types'
import type { VideoControl } from '@shared/ipc-contract'

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
      maxLinesPerSlide: settings.maxLinesPerSlide
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
   * Optional media thumbnail preview source. Populated for image,
   * video, and pdf-page slides so the grid shows visual content
   * instead of "(image)" placeholder text.
   */
  preview?:
    | { kind: 'image'; path: string }
    | { kind: 'video'; path: string }
    | { kind: 'deck'; pdfPath: string; pageIndex: number }
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
  // Pulled directly from the store rather than prop-drilled — the parent
  // already ensures the theme is loaded, so by the time RunningView renders
  // it's either in the store or briefly null (SlideRenderer handles null).
  const baseTheme = useThemeStore((s) => s.theme)
  // Merge the current item's override (if any) on top of the global
  // theme so the confidence monitor is byte-for-byte identical to
  // whatever the projector is showing right now. mergeThemeOverride
  // filters null/undefined fields in the override so they inherit
  // instead of clobbering — without this fix, a song with an override
  // that has cleared its background image would force the global
  // background to disappear during that song's slides.
  const theme = useMemo(() => {
    if (!baseTheme) return null
    return mergeThemeOverride(baseTheme, currentItem?.themeOverride ?? null)
  }, [baseTheme, currentItem])

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
          <div className="aspect-video overflow-hidden rounded-md border border-white/10 bg-black">
            <SlideRenderer
              payload={currentSlide}
              mode={state.displayMode}
              theme={theme}
              animate={false}
              videoControl={videoControl}
            />
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

          {/* Operator notes — only shown if the current item has any */}
          {currentItem?.notes && (
            <div className="mt-3 overflow-y-auto rounded-md border border-white/10 bg-white/5 p-3">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-white/40">
                Notes
              </div>
              <div className="whitespace-pre-wrap text-xs text-white/80">
                {currentItem.notes}
              </div>
            </div>
          )}
        </aside>
      </section>

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
