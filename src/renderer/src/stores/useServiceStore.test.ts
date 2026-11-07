import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RenderableItem } from '../lib/slideify'
import { END_GUARD_MS, useServiceStore } from './useServiceStore'

// The store "speaks" to the output window through window.api.output.
// Node env has no window, so stub just the calls the store makes.
function stubOutputApi(): Record<string, ReturnType<typeof vi.fn>> {
  const output = {
    setSlide: vi.fn(async () => {}),
    setBlack: vi.fn(async () => {}),
    setLogo: vi.fn(async () => {}),
    setLive: vi.fn(async () => {}),
    setItemThemeOverride: vi.fn(async () => {}),
    setLowerThirdsContent: vi.fn(async () => {})
  }
  vi.stubGlobal('window', { api: { output } })
  return output
}

const text = (s: string) => ({ kind: 'text' as const, lines: [s], sectionLabel: s })

const items: RenderableItem[] = [
  { id: 'a', kind: 'song', label: 'Song', slides: [text('v1'), text('v2')] },
  { id: 'b', kind: 'video', label: 'Outro', slides: [text('o1')] }
]

function startService(): void {
  useServiceStore.getState().start({ setlistId: 's1', setlistName: 'Sunday', items })
}

function position(): { i: number; s: number } | string {
  const st = useServiceStore.getState().state
  return st.mode === 'running' ? { i: st.itemIndex, s: st.slideIndex } : st.mode
}

describe('useServiceStore — end of service', () => {
  let output: ReturnType<typeof stubOutputApi>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-01T10:00:00Z'))
    output = stubOutputApi()
    useServiceStore.setState({ state: { mode: 'idle' } })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('a fast double-tap onto the final slide stops ON it instead of ending', () => {
    startService()
    const { nextSlide } = useServiceStore.getState()
    nextSlide() // v2
    nextSlide() // o1 — final slide
    vi.advanceTimersByTime(150)
    nextSlide() // second tap of a double-tap: must be ignored
    expect(position()).toEqual({ i: 1, s: 0 })
    expect(output.setBlack).not.toHaveBeenCalled()
  })

  it('a deliberate press on the final slide still ends the service', () => {
    startService()
    const { nextSlide } = useServiceStore.getState()
    nextSlide()
    nextSlide()
    vi.advanceTimersByTime(END_GUARD_MS)
    nextSlide()
    expect(position()).toBe('ended')
    expect(output.setBlack).toHaveBeenCalled()
  })

  it('video auto-advance moves forward mid-setlist', () => {
    startService()
    useServiceStore.getState().jumpTo(0, 1)
    vi.advanceTimersByTime(END_GUARD_MS * 5)
    useServiceStore.getState().autoAdvance()
    expect(position()).toEqual({ i: 1, s: 0 })
  })

  it('video auto-advance on the very last slide never ends the service', () => {
    startService()
    useServiceStore.getState().jumpTo(1, 0)
    vi.advanceTimersByTime(END_GUARD_MS * 5) // a whole video's worth
    useServiceStore.getState().autoAdvance()
    expect(position()).toEqual({ i: 1, s: 0 })
    expect(output.setBlack).not.toHaveBeenCalled()
  })
})

describe('useServiceStore — lower thirds cleanup', () => {
  let output: ReturnType<typeof stubOutputApi>
  const hidden = { visible: false, title: '', subtitle: '' }

  beforeEach(() => {
    output = stubOutputApi()
    useServiceStore.setState({ state: { mode: 'idle' } })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('end() hides the OBS lower third', () => {
    startService()
    useServiceStore.getState().end()
    expect(output.setLowerThirdsContent).toHaveBeenLastCalledWith(hidden)
  })

  it('exit() hides the OBS lower third', () => {
    startService()
    useServiceStore.getState().exit()
    expect(output.setLowerThirdsContent).toHaveBeenLastCalledWith(hidden)
  })
})

describe('useServiceStore — setDisplayMode', () => {
  let output: ReturnType<typeof stubOutputApi>
  beforeEach(() => {
    output = stubOutputApi()
    useServiceStore.setState({ state: { mode: 'idle' } })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sets the mode and broadcasts once; repeating is a no-op', () => {
    startService()
    const { setDisplayMode } = useServiceStore.getState()
    setDisplayMode('black')
    setDisplayMode('black')
    const st = useServiceStore.getState().state
    expect(st.mode === 'running' && st.displayMode).toBe('black')
    expect(output.setBlack).toHaveBeenCalledTimes(1)
  })

  it('is a no-op when not running', () => {
    useServiceStore.getState().setDisplayMode('black')
    expect(output.setBlack).not.toHaveBeenCalled()
  })
})
