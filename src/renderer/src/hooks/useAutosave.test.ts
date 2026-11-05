// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useAutosave, type UseAutosaveResult } from './useAutosave'

// Same bare react-dom harness as useKeyboard.test.ts — no @testing-library.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Draft = { title: string } | null

let root: Root
let container: HTMLElement
let api: UseAutosaveResult
const onSave = vi.fn(async (_v: Draft) => {})

function Harness({ value }: { value: Draft }): null {
  api = useAutosave<Draft>({ value, onSave })
  return null
}

function render(value: Draft): void {
  act(() => root.render(createElement(Harness, { value })))
}

describe('useAutosave', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    onSave.mockClear()
    container = document.createElement('div')
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    vi.useRealTimers()
  })

  it('does not save when the draft is seeded (null → loaded)', () => {
    render(null)
    render({ title: 'Amazing Grace' })
    act(() => vi.advanceTimersByTime(1000))
    expect(onSave).not.toHaveBeenCalled()
  })

  it('does not save the seeded draft on unmount either', () => {
    render(null)
    render({ title: 'Amazing Grace' })
    act(() => root.unmount())
    root = createRoot(container) // afterEach unmounts again
    expect(onSave).not.toHaveBeenCalled()
  })

  it('still saves the first real edit after loading', async () => {
    render(null)
    render({ title: 'Amazing Grace' })
    render({ title: 'Amazing Grace!' })
    act(() => vi.advanceTimersByTime(499))
    expect(onSave).not.toHaveBeenCalled()
    await act(async () => {
      vi.advanceTimersByTime(1)
    })
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledWith({ title: 'Amazing Grace!' })
  })

  it('flush() saves a pending edit immediately, once', async () => {
    render(null)
    render({ title: 'a' })
    render({ title: 'ab' })
    await act(() => api.flush())
    expect(onSave).toHaveBeenCalledTimes(1)
    act(() => vi.advanceTimersByTime(1000))
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('cancel() drops a pending edit (no timer save, no unmount flush)', () => {
    render(null)
    render({ title: 'a' })
    render({ title: 'ab' })
    act(() => api.cancel())
    act(() => vi.advanceTimersByTime(1000))
    act(() => root.unmount())
    root = createRoot(container)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('flushes a pending edit on unmount', () => {
    render(null)
    render({ title: 'a' })
    render({ title: 'ab' })
    act(() => root.unmount())
    root = createRoot(container)
    expect(onSave).toHaveBeenCalledWith({ title: 'ab' })
  })
})
