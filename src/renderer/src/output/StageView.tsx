/**
 * StageView — the speaker-facing stage display.
 *
 * ProPresenter-style layout (decision update from the user):
 *   ┌───────────────────────────────────────────────────────────┐
 *   │  10:23 AM                          VERSE 2 / 4            │  top bar
 *   ├──────────────────────────────────────────┬────────────────┤
 *   │                                          │                │
 *   │            CURRENT SLIDE                 │   NEXT SLIDE   │  main row
 *   │              (large)                     │    (small)     │
 *   │                                          │                │
 *   ├──────────────────────────────────────────┴────────────────┤
 *   │  Notes: Welcome guests, transition into prayer            │  notes strip
 *   └───────────────────────────────────────────────────────────┘
 *
 * Receives a structured `StageContext` from the operator over IPC
 * (current slide, next slide, slide progress, item notes). The
 * stage monitor doesn't read the operator's setlist or library
 * stores — everything it needs arrives pre-packaged in the context
 * payload, and the operator broadcasts a fresh one on every slide
 * change.
 *
 * Theme handling stays the same as the main output: load the active
 * theme once, subscribe to `theme.onChange` for live edits, merge
 * any per-item override on top of the global. Both current and
 * next-slide thumbnails use the same merged theme so the speaker
 * sees a faithful preview of how the upcoming slide will look.
 */

import { useEffect, useMemo, useState } from 'react'
import type { OutputMode, StageContext } from '@shared/ipc-contract'
import type { Theme, ThemeOverride } from '@shared/types'
import { SlideRenderer } from '../components/SlideRenderer'
import { useThemeStore } from '../stores/useThemeStore'
import { mergeThemeOverride } from '../lib/themeOverride'
import { loadPptxDeck } from '../lib/pptxLoader'

export function StageView(): JSX.Element {
  const [context, setContext] = useState<StageContext>({
    currentSlide: null,
    nextSlide: null,
    itemLabel: '',
    slideIndex: 0,
    totalSlides: 0,
    notes: ''
  })
  const [mode, setMode] = useState<OutputMode>('live')
  const [itemOverride, setItemOverride] = useState<ThemeOverride | null>(null)
  const { theme, load, setFromBroadcast } = useThemeStore()

  // Subscribe to the rich stage context (current + next + notes +
  // progress). This is the primary content channel for the stage
  // view; we don't need to subscribe to onSlide separately because
  // the stage context already carries the current slide.
  useEffect(() => {
    const offContext = window.api.output.onStageContext((c) => setContext(c))
    const offMode = window.api.output.onMode((m) => setMode(m))
    const offOverride = window.api.output.onItemThemeOverride((o) =>
      setItemOverride(o)
    )
    return () => {
      offContext()
      offMode()
      offOverride()
    }
  }, [])

  useEffect(() => {
    load()
    const off = window.api.theme.onChange((next) => setFromBroadcast(next))
    return off
  }, [load, setFromBroadcast])

  // Warm PowerPoint decks ahead of time. Same rationale as OutputView's
  // matching effect: this is a SEPARATE BrowserWindow with its own
  // pptxLoader cache, invisible to whatever ServiceMode warmed in the
  // operator window. `context.nextSlide` gives one slide of lookahead —
  // including across setlist item boundaries (see ServiceMode.tsx) — so
  // a deck's parse can be in flight before the operator actually
  // advances onto its first slide, instead of racing it live in the
  // "Up Next" panel and the main "Live" panel at the same moment.
  // loadPptxDeck dedupes by absolute path, so this is a cheap no-op once
  // a slide has actually rendered.
  useEffect(() => {
    for (const s of [context.currentSlide, context.nextSlide]) {
      if (s?.kind === 'pptx-slide') {
        void loadPptxDeck(s.pptxPath).catch((err) => {
          console.error('[StageView] deck warm failed', s.pptxPath, err)
        })
      }
    }
  }, [context])

  // Stage monitor never plays the theme's background video. Motion
  // behind the lyrics is distracting for the speaker, who needs to
  // focus on what they're singing/reading next, not on a moving
  // image. Background IMAGE (static) is still allowed — it gives
  // the stage view a coherent look matching the projector without
  // pulling the speaker's eye around.
  const effectiveTheme = useMemo<Theme | null>(() => {
    if (!theme) return null
    const merged = mergeThemeOverride(theme, itemOverride)
    return { ...merged, backgroundVideoPath: null }
  }, [theme, itemOverride])

  // Live clock — updates every second. Local to the stage monitor;
  // no IPC needed because every renderer has its own Date.now().
  // 12-hour format because that's how Filipino service schedules
  // are typically printed (10:30 AM, not 10:30).
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  const clockText = now.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  })

  return (
    <div className="flex h-screen w-screen flex-col bg-black text-white">
      {/* ── Top bar: clock + slide progress ────────────────────────── */}
      <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-6 py-3">
        <div className="font-mono text-3xl tabular-nums tracking-tight">
          {clockText}
        </div>
        <div className="text-right">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-white/40">
            {context.itemLabel || 'Stage Monitor'}
          </div>
          {context.totalSlides > 0 && (
            <div className="text-sm text-white/70">
              Slide {context.slideIndex + 1} of {context.totalSlides}
            </div>
          )}
        </div>
      </div>

      {/* ── Main row: current slide (60%) + next slide (40%) ───────── */}
      <div className="flex min-h-0 flex-1 gap-4 p-4">
        <div className="flex min-w-0 flex-[3] flex-col">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-white/40">
            Live
          </div>
          <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-white/10 bg-black">
            <SlideRenderer
              payload={context.currentSlide}
              mode={mode}
              theme={effectiveTheme}
              animate={false}
              audio={false}
            />
          </div>
        </div>

        <div className="flex min-w-0 flex-[2] flex-col">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-white/40">
            Up Next
          </div>
          <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-white/10 bg-black">
            {context.nextSlide ? (
              <SlideRenderer
                payload={context.nextSlide}
                mode="live"
                theme={effectiveTheme}
                animate={false}
                audio={false}
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-sm text-white/40">
                End of section
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Bottom strip: item notes / announcements ──────────────── */}
      <div className="shrink-0 border-t border-white/10 bg-neutral-950/80 px-6 py-3">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-white/40">
          Notes
        </div>
        <div className="max-h-32 overflow-y-auto whitespace-pre-wrap text-base leading-relaxed text-white/85">
          {context.notes || (
            <span className="text-white/30">No notes for this item.</span>
          )}
        </div>
      </div>
    </div>
  )
}
