/**
 * OutputView — the projector-facing view.
 *
 * Contract: this window is a DUMB renderer. It subscribes to
 * window.api.output.onSlide, .onMode, .onItemThemeOverride, and
 * .theme.onChange, holds those in local state (via stores + local
 * useState), and passes everything merged to SlideRenderer. It never
 * reads from setlists, never parses. Everything arrives pre-cooked.
 *
 * Theme composition (Phase 5.5):
 *   effective = { ...baseTheme, ...itemThemeOverride }
 *
 * Where baseTheme is the active global theme (from the theme store +
 * theme:event:change broadcasts), and itemThemeOverride is the current
 * service item's override pushed by useServiceStore on item changes.
 * Either side can update independently without stomping the other —
 * that's why we keep them in two pieces of state instead of merging
 * on the sender side.
 */

import { useEffect, useMemo, useState } from 'react'
import type {
  OutputMode,
  SlidePayload,
  VideoControl
} from '@shared/ipc-contract'
import type { Theme, ThemeOverride } from '@shared/types'
import { SlideRenderer } from '../components/SlideRenderer'
import { useThemeStore } from '../stores/useThemeStore'
import { mergeThemeOverride } from '../lib/themeOverride'

export function OutputView(): JSX.Element {
  const [slide, setSlide] = useState<SlidePayload | null>(null)
  const [mode, setMode] = useState<OutputMode>('live')
  const [itemOverride, setItemOverride] = useState<ThemeOverride | null>(null)
  const [videoControl, setVideoControl] = useState<VideoControl>({
    paused: false,
    muted: false
  })
  const { theme, load, setFromBroadcast } = useThemeStore()

  // Slide + mode + override + video-control subscriptions
  useEffect(() => {
    const offSlide = window.api.output.onSlide((payload) => setSlide(payload))
    const offMode = window.api.output.onMode((m) => setMode(m))
    const offOverride = window.api.output.onItemThemeOverride((o) =>
      setItemOverride(o)
    )
    const offVideoControl = window.api.output.onVideoControl((c) =>
      setVideoControl(c)
    )
    return () => {
      offSlide()
      offMode()
      offOverride()
      offVideoControl()
    }
  }, [])

  // Theme: load once, then subscribe for live updates from the operator
  // window's Settings editor. `setFromBroadcast` replaces the cached
  // theme atomically — no IPC round-trip needed.
  useEffect(() => {
    load()
    const off = window.api.theme.onChange((next) => setFromBroadcast(next))
    return off
  }, [load, setFromBroadcast])

  // Merge: base theme + item override. mergeThemeOverride filters out
  // null/undefined fields in the override so they inherit from the
  // base instead of clobbering it (key bug fix — without this, an
  // override that has cleared its own backgroundImagePath would force
  // the global background to disappear). Memo prevents rebuilding the
  // object unless either side actually changed, which keeps
  // SlideRenderer's auto-fit key stable across unrelated re-renders.
  const effectiveTheme = useMemo<Theme | null>(() => {
    if (!theme) return null
    return mergeThemeOverride(theme, itemOverride)
  }, [theme, itemOverride])

  // Don't render slides until the theme has loaded. Rendering with a
  // null/fallback theme first and then swapping to the real theme is
  // what caused the packaged-app "text stays tiny until you double-
  // click" bug: slides that arrived BEFORE theme.load() resolved would
  // render via FALLBACK_THEME, and by the time the real theme arrived
  // the autofit measurements were already baked into a detached DOM
  // element. A black hold-frame while loading is both correct (the
  // operator hasn't actually "gone live" yet from a projector POV —
  // the hero preview in main renderer is what they're looking at) and
  // much simpler than trying to recover from a mid-flight theme swap.
  if (!effectiveTheme) {
    return <div className="h-screen w-screen bg-black" />
  }

  return (
    <div className="h-screen w-screen">
      <SlideRenderer
        payload={slide}
        mode={mode}
        theme={effectiveTheme}
        animate
        // Output window is the only place that plays video audio.
        // ServiceMode's confidence monitor renders the same payloads
        // muted so the operator doesn't hear duplicate streams.
        audio
        videoControl={videoControl}
      />
    </div>
  )
}
