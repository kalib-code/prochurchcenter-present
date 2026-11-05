// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { RenderableItem } from '../lib/slideify'
import { useServiceStore } from '../stores/useServiceStore'
import { useKeyboard } from './useKeyboard'

// No @testing-library here — mount a bare component with react-dom and
// drive it with real KeyboardEvents on document, which is exactly what
// useKeyboard listens to.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const text = (s: string) => ({ kind: 'text' as const, lines: [s], sectionLabel: s })
const items: RenderableItem[] = [
  { id: 'a', kind: 'song', label: 'Song', slides: [text('v1'), text('v2'), text('v3')] }
]

function press(key: string, init: KeyboardEventInit = {}): void {
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }))
  })
}

function slideIndex(): number {
  const st = useServiceStore.getState().state
  return st.mode === 'running' ? st.slideIndex : -1
}

function cheatSheetOpen(): boolean {
  const st = useServiceStore.getState().state
  return st.mode === 'running' && st.showCheatSheet
}

describe('useKeyboard', () => {
  let root: Root
  let container: HTMLDivElement
  let onExit: ReturnType<typeof vi.fn>

  beforeEach(() => {
    ;(window as unknown as { api: unknown }).api = {
      output: {
        setSlide: vi.fn(async () => {}),
        setBlack: vi.fn(async () => {}),
        setLogo: vi.fn(async () => {}),
        setLive: vi.fn(async () => {}),
        setItemThemeOverride: vi.fn(async () => {}),
        setLowerThirdsContent: vi.fn(async () => {})
      }
    }
    useServiceStore.setState({ state: { mode: 'idle' } })
    useServiceStore.getState().start({ setlistId: 's1', setlistName: 'Sunday', items })

    onExit = vi.fn()
    const Harness = (): null => {
      useKeyboard({ enabled: true, onExit })
      return null
    }
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root.render(createElement(Harness)))
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('Esc goes through onExit (the confirm + exit + navigate path), not bare exit()', () => {
    press('Escape')
    expect(onExit).toHaveBeenCalledTimes(1)
    // The store is untouched — leaving is onExit's job, so ServiceMode
    // can never be left mounted in 'idle' and restart the service.
    expect(useServiceStore.getState().state.mode).toBe('running')
  })

  it('ignores OS auto-repeat for navigation keys', () => {
    press(' ')
    expect(slideIndex()).toBe(1)
    press(' ', { repeat: true })
    press('ArrowRight', { repeat: true })
    expect(slideIndex()).toBe(1)
    press('ArrowRight')
    expect(slideIndex()).toBe(2)
  })

  it('while the cheat sheet is open, Esc closes it instead of exiting', () => {
    press('?')
    expect(cheatSheetOpen()).toBe(true)
    press('Escape')
    expect(cheatSheetOpen()).toBe(false)
    expect(onExit).not.toHaveBeenCalled()
  })

  it('while the cheat sheet is open, navigation and display keys are ignored', () => {
    press('?')
    press(' ')
    press('ArrowRight')
    press('b')
    expect(slideIndex()).toBe(0)
    const st = useServiceStore.getState().state
    expect(st.mode === 'running' && st.displayMode).toBe('live')
    press('?')
    expect(cheatSheetOpen()).toBe(false)
    press(' ')
    expect(slideIndex()).toBe(1)
  })
})
