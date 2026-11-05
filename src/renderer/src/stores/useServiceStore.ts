/**
 * useServiceStore — the Service Mode state machine.
 *
 * States:
 *   idle    — no service running. Initial state and post-exit state.
 *   running — actively presenting. Holds (items, itemIndex, slideIndex, displayMode).
 *   ended   — ran past the last slide. Shows an end-of-service screen.
 *
 * Side effect: every state change that affects what the projector should
 * show also pushes a payload over IPC to the output window. The store is
 * the single place that "speaks" to window.api.output — no component reaches
 * for output IPC directly. That way unit tests can mock the store and
 * verify "pressing Space at the last slide transitions to 'ended'" without
 * mounting any React or touching Electron.
 *
 * Why put the IPC call inside the store action rather than in a React
 * effect that reacts to state changes? Because the latter doubles the
 * work during fast key repeats (you'd queue 20 effects for 20 Space
 * presses) and risks out-of-order broadcasts. Putting it in the action
 * is synchronous, ordered, and cancellable.
 */

import { create } from 'zustand'
import type { RenderableItem } from '../lib/slideify'
import type { OutputMode, SlidePayload } from '@shared/ipc-contract'

export type ServiceState =
  | { mode: 'idle' }
  | {
      mode: 'running'
      setlistId: string
      setlistName: string
      items: RenderableItem[]
      itemIndex: number
      slideIndex: number
      displayMode: OutputMode
      startedAt: string
      showCheatSheet: boolean
    }
  | { mode: 'ended'; setlistId: string; setlistName: string; startedAt: string }

interface ServiceActions {
  start: (args: {
    setlistId: string
    setlistName: string
    items: RenderableItem[]
  }) => void
  end: () => void
  exit: () => void

  nextSlide: () => void
  /**
   * nextSlide for the video-ended auto-advance: identical, except it
   * never ends the service — see the implementation for why.
   */
  autoAdvance: () => void
  prevSlide: () => void
  nextItem: () => void
  prevItem: () => void
  jumpTo: (itemIndex: number, slideIndex?: number) => void

  toggleBlack: () => void
  toggleLogo: () => void
  toggleCheatSheet: () => void
}

type Store = { state: ServiceState } & ServiceActions

/**
 * Pick the current SlidePayload for a running state, given its indices.
 * Returns null if indices are out of range (shouldn't happen in normal
 * flow, but defensive).
 */
function currentPayload(
  items: RenderableItem[],
  itemIndex: number,
  slideIndex: number
): SlidePayload | null {
  const item = items[itemIndex]
  if (!item) return null
  return item.slides[slideIndex] ?? null
}

/**
 * How long the final slide must have been on screen before nextSlide()
 * is allowed to end the service. Ending blacks the projector and has no
 * undo, so a fast double-tap from the second-to-last slide must stop ON
 * the final slide rather than blow straight through it. Well above a
 * double-tap (~100–300ms), well below a deliberate "we're done" press.
 */
export const END_GUARD_MS = 1000

/**
 * When the slide currently on screen was put there. Updated by
 * broadcastSlide — the one choke point every position change goes
 * through — and read by nextSlide's END_GUARD_MS check.
 */
let lastSlideChangeAt = 0

/**
 * Push the current slide to the output window. Called from every action
 * that changes what's being shown.
 */
function broadcastSlide(
  items: RenderableItem[],
  itemIndex: number,
  slideIndex: number
): void {
  lastSlideChangeAt = Date.now()
  const payload = currentPayload(items, itemIndex, slideIndex)
  if (payload) {
    // Fire and forget. If IPC fails (main crashed?) we still update
    // local state so the operator UI isn't stuck.
    void window.api.output.setSlide(payload)
  }
}

/**
 * Send a mode change (live/black/logo) to the output window.
 */
function broadcastMode(mode: OutputMode): void {
  if (mode === 'black') void window.api.output.setBlack()
  else if (mode === 'logo') void window.api.output.setLogo()
  else void window.api.output.setLive()
}

/**
 * Push the current item's theme override (or null) to the output
 * window. Called whenever the itemIndex changes so the projector can
 * merge it on top of the active global theme. Passing null clears any
 * prior override, which is what we want when the service ends or when
 * the operator lands on a non-song item.
 */
function broadcastItemOverride(
  items: RenderableItem[],
  itemIndex: number
): void {
  const item = items[itemIndex]
  // item.themeOverride might be undefined (non-song) or null (song with
  // no override) — both collapse to null on the wire.
  const override = item?.themeOverride ?? null
  void window.api.output.setItemThemeOverride(override)
}

/**
 * Hide the OBS lower-thirds overlay. Main caches the last payload and
 * replays it to any (re)opened lower-thirds window, and RunningView's
 * auto-follow only ever pushes while a service is running — so without
 * an explicit hide on end/exit the last lyric stays on the stream.
 */
function hideLowerThirds(): void {
  void window.api.output.setLowerThirdsContent({
    visible: false,
    title: '',
    subtitle: ''
  })
}

export const useServiceStore = create<Store>((set, get) => ({
  state: { mode: 'idle' },

  start: ({ setlistId, setlistName, items }) => {
    if (items.length === 0) return // nothing to present
    set({
      state: {
        mode: 'running',
        setlistId,
        setlistName,
        items,
        itemIndex: 0,
        slideIndex: 0,
        displayMode: 'live',
        startedAt: new Date().toISOString(),
        showCheatSheet: false
      }
    })
    broadcastMode('live')
    // Order matters: push the theme override BEFORE the slide so the
    // output window has the correct per-song theme applied by the time
    // it receives and renders the first slide. Otherwise a cross-theme
    // song-to-song transition would flash the old theme for one frame.
    broadcastItemOverride(items, 0)
    broadcastSlide(items, 0, 0)
  },

  end: () => {
    const s = get().state
    if (s.mode !== 'running') return
    set({
      state: {
        mode: 'ended',
        setlistId: s.setlistId,
        setlistName: s.setlistName,
        startedAt: s.startedAt
      }
    })
    // Return to black when service ends — congregation shouldn't see
    // "The End" or stale content on the projector.
    broadcastMode('black')
    // Clear any lingering per-song override so the next service starts
    // from a clean slate (plus whatever global theme is active).
    void window.api.output.setItemThemeOverride(null)
    hideLowerThirds()
  },

  exit: () => {
    set({ state: { mode: 'idle' } })
    broadcastMode('black')
    void window.api.output.setItemThemeOverride(null)
    hideLowerThirds()
  },

  nextSlide: () => {
    const s = get().state
    if (s.mode !== 'running') return
    const item = s.items[s.itemIndex]
    if (!item) return

    // Advance within the current item — same item, no theme change
    if (s.slideIndex + 1 < item.slides.length) {
      const nextSlideIndex = s.slideIndex + 1
      set({ state: { ...s, slideIndex: nextSlideIndex } })
      broadcastSlide(s.items, s.itemIndex, nextSlideIndex)
      return
    }

    // Roll to next item — push the new item's override before the slide
    if (s.itemIndex + 1 < s.items.length) {
      const nextItemIndex = s.itemIndex + 1
      set({ state: { ...s, itemIndex: nextItemIndex, slideIndex: 0 } })
      broadcastItemOverride(s.items, nextItemIndex)
      broadcastSlide(s.items, nextItemIndex, 0)
      return
    }

    // Past the last slide of the last item. Ignore the press if the
    // final slide only just arrived (see END_GUARD_MS) — a double-tap
    // should never black out the room and end the service.
    if (Date.now() - lastSlideChangeAt < END_GUARD_MS) return
    get().end()
  },

  autoAdvance: () => {
    const s = get().state
    if (s.mode !== 'running') return
    const item = s.items[s.itemIndex]
    if (!item) return
    // A closing video finishing on its own must not end the service:
    // ending blacks the projector and flips the operator to SERVICE
    // ENDED with no way back, which nobody asked for. Stay put (the
    // video holds its last frame) and let the operator end it
    // deliberately with SPACE or EXIT.
    const isVeryLast =
      s.slideIndex + 1 >= item.slides.length &&
      s.itemIndex + 1 >= s.items.length
    if (isVeryLast) return
    get().nextSlide()
  },

  prevSlide: () => {
    const s = get().state
    if (s.mode !== 'running') return

    // Back within the current item — same item, no theme change
    if (s.slideIndex > 0) {
      const prev = s.slideIndex - 1
      set({ state: { ...s, slideIndex: prev } })
      broadcastSlide(s.items, s.itemIndex, prev)
      return
    }

    // Back to the previous item (land on its LAST slide — standard
    // "rewind" behavior in every slideshow tool)
    if (s.itemIndex > 0) {
      const prevItem = s.itemIndex - 1
      const lastSlideOfPrev = s.items[prevItem].slides.length - 1
      set({
        state: { ...s, itemIndex: prevItem, slideIndex: lastSlideOfPrev }
      })
      broadcastItemOverride(s.items, prevItem)
      broadcastSlide(s.items, prevItem, lastSlideOfPrev)
      return
    }

    // Already at the very beginning — no-op
  },

  nextItem: () => {
    const s = get().state
    if (s.mode !== 'running') return
    if (s.itemIndex + 1 >= s.items.length) return
    const next = s.itemIndex + 1
    set({ state: { ...s, itemIndex: next, slideIndex: 0 } })
    broadcastItemOverride(s.items, next)
    broadcastSlide(s.items, next, 0)
  },

  prevItem: () => {
    const s = get().state
    if (s.mode !== 'running') return
    // If we're not on the first slide of the current item, go to the
    // first slide of the current item (standard "prev chapter" behavior).
    // Item is unchanged, so no override broadcast is needed.
    if (s.slideIndex > 0) {
      set({ state: { ...s, slideIndex: 0 } })
      broadcastSlide(s.items, s.itemIndex, 0)
      return
    }
    if (s.itemIndex > 0) {
      const prev = s.itemIndex - 1
      set({ state: { ...s, itemIndex: prev, slideIndex: 0 } })
      broadcastItemOverride(s.items, prev)
      broadcastSlide(s.items, prev, 0)
    }
  },

  jumpTo: (itemIndex, slideIndex = 0) => {
    const s = get().state
    if (s.mode !== 'running') return
    if (itemIndex < 0 || itemIndex >= s.items.length) return
    const item = s.items[itemIndex]
    if (!item) return
    const safeSlide = Math.max(0, Math.min(slideIndex, item.slides.length - 1))
    const isItemChange = itemIndex !== s.itemIndex
    set({ state: { ...s, itemIndex, slideIndex: safeSlide } })
    if (isItemChange) broadcastItemOverride(s.items, itemIndex)
    broadcastSlide(s.items, itemIndex, safeSlide)
  },

  toggleBlack: () => {
    const s = get().state
    if (s.mode !== 'running') return
    const next: OutputMode = s.displayMode === 'black' ? 'live' : 'black'
    set({ state: { ...s, displayMode: next } })
    broadcastMode(next)
  },

  toggleLogo: () => {
    const s = get().state
    if (s.mode !== 'running') return
    const next: OutputMode = s.displayMode === 'logo' ? 'live' : 'logo'
    set({ state: { ...s, displayMode: next } })
    broadcastMode(next)
  },

  toggleCheatSheet: () => {
    const s = get().state
    if (s.mode !== 'running') return
    set({ state: { ...s, showCheatSheet: !s.showCheatSheet } })
  }
}))
