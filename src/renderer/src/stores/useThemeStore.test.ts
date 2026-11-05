import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Theme } from '@shared/types'

const base = { id: 'default', fontSizePercent: 64 } as unknown as Theme

describe('useThemeStore.update', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('ignores stale replies and rolls back on failure without rejecting', async () => {
    const pending: { resolve: (t: Theme) => void; reject: (e: Error) => void }[] = []
    vi.stubGlobal('window', {
      api: {
        theme: {
          get: vi.fn(async () => base),
          update: vi.fn(
            () => new Promise<Theme>((resolve, reject) => pending.push({ resolve, reject }))
          )
        }
      }
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.resetModules()
    const { useThemeStore } = await import('./useThemeStore')
    await useThemeStore.getState().load()
    const size = (): unknown => useThemeStore.getState().theme?.fontSizePercent

    const p1 = useThemeStore.getState().update({ fontSizePercent: 70 })
    const p2 = useThemeStore.getState().update({ fontSizePercent: 80 })
    pending[1].resolve({ ...base, fontSizePercent: 80 } as unknown as Theme)
    pending[0].resolve({ ...base, fontSizePercent: 70 } as unknown as Theme)
    await Promise.all([p1, p2])
    expect(size()).toBe(80)

    const p3 = useThemeStore.getState().update({ fontSizePercent: 90 })
    pending[2].reject(new Error('write failed'))
    await expect(p3).resolves.toBeNull()
    expect(size()).toBe(80)
    expect(useThemeStore.getState().error).toBe('write failed')
  })

  it('resolves null instead of throwing when the theme is not loaded yet', async () => {
    vi.stubGlobal('window', { api: { theme: { update: vi.fn() } } })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.resetModules()
    const { useThemeStore } = await import('./useThemeStore')
    await expect(useThemeStore.getState().update({} as Partial<Theme>)).resolves.toBeNull()
  })
})
