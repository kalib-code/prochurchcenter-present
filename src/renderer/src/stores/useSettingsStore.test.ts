import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Settings } from '@shared/types'

// Deferred IPC replies so tests control the order main "answers" in.
interface Pending {
  patch: Partial<Settings>
  resolve: (s: Settings) => void
  reject: (e: Error) => void
}

const base = { maxLinesPerSlide: 4, lowerThirdsFontSize: 36 } as Settings

async function setup(): Promise<{
  pending: Pending[]
  store: typeof import('./useSettingsStore').useSettingsStore
}> {
  const pending: Pending[] = []
  vi.stubGlobal('window', {
    api: {
      settings: {
        get: vi.fn(async () => base),
        update: vi.fn(
          (patch: Partial<Settings>) =>
            new Promise<Settings>((resolve, reject) => pending.push({ patch, resolve, reject }))
        )
      }
    }
  })
  // Fresh module per test: the sequencer is module state.
  vi.resetModules()
  const { useSettingsStore } = await import('./useSettingsStore')
  await useSettingsStore.getState().load()
  return { pending, store: useSettingsStore }
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))
const fontSize = (store: Awaited<ReturnType<typeof setup>>['store']): number | undefined =>
  store.getState().settings?.lowerThirdsFontSize

describe('useSettingsStore.update ordering', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('does not snap back when an older reply lands after a newer one (slider drag)', async () => {
    const { pending, store } = await setup()
    const p1 = store.getState().update({ lowerThirdsFontSize: 40 })
    const p2 = store.getState().update({ lowerThirdsFontSize: 44 })
    const p3 = store.getState().update({ lowerThirdsFontSize: 48 })
    expect(fontSize(store)).toBe(48)

    pending[2].resolve({ ...base, lowerThirdsFontSize: 48 })
    await flush()
    expect(fontSize(store)).toBe(48)
    pending[0].resolve({ ...base, lowerThirdsFontSize: 40 })
    await flush()
    expect(fontSize(store)).toBe(48) // stale reply ignored
    pending[1].resolve({ ...base, lowerThirdsFontSize: 44 })
    await Promise.all([p1, p2, p3])
    expect(fontSize(store)).toBe(48)
    expect(store.getState().error).toBeNull()
  })

  it('rolls back to the last confirmed value on failure, sets error, and never rejects', async () => {
    const { pending, store } = await setup()
    const ok = store.getState().update({ lowerThirdsFontSize: 40 })
    pending[0].resolve({ ...base, lowerThirdsFontSize: 40 })
    await ok

    const bad = store.getState().update({ lowerThirdsFontSize: 60 })
    expect(fontSize(store)).toBe(60)
    pending[1].reject(new Error('disk full'))
    await expect(bad).resolves.toBeNull()
    expect(fontSize(store)).toBe(40)
    expect(store.getState().error).toBe('disk full')
    expect(console.error).toHaveBeenCalled()
  })

  it('a failed latest request falls back to an older success that lands later', async () => {
    const { pending, store } = await setup()
    const p1 = store.getState().update({ lowerThirdsFontSize: 40 })
    const p2 = store.getState().update({ lowerThirdsFontSize: 44 })
    pending[1].reject(new Error('nope'))
    await flush()
    expect(fontSize(store)).toBe(44) // older request still in flight — hold
    pending[0].resolve({ ...base, lowerThirdsFontSize: 40 })
    await Promise.all([p1, p2])
    expect(fontSize(store)).toBe(40)
  })
})
