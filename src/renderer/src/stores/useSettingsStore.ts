/**
 * useSettingsStore — the renderer's live copy of the global settings file.
 *
 * Pattern is the same as useLibraryStore / useSetlistStore: thin cache
 * over window.api.settings. Unlike library/setlists, there is only ONE
 * settings object, so the store just holds that one object directly.
 *
 * Components that care about settings (Service Mode, Settings page) call
 * `load()` on mount if not already loaded. Updates are optimistic — we
 * set the local state immediately, fire the IPC update, and on success
 * replace with whatever main returns (which will match, but is the
 * canonical shape).
 */

import { create } from 'zustand'
import type { Settings } from '@shared/types'
import type { UpdateSettingsPatch } from '@shared/ipc-contract'

interface SettingsState {
  settings: Settings | null
  loading: boolean
  error: string | null

  load: () => Promise<void>
  update: (patch: UpdateSettingsPatch) => Promise<Settings>
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: null,
  loading: false,
  error: null,

  load: async () => {
    if (get().settings || get().loading) return
    set({ loading: true, error: null })
    try {
      const settings = await window.api.settings.get()
      set({ settings, loading: false })
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : String(err) })
    }
  },

  update: async (patch) => {
    // Optimistic: merge locally first so UI feels instant
    const current = get().settings
    if (current) {
      set({ settings: { ...current, ...patch } as Settings })
    }
    const updated = await window.api.settings.update(patch)
    set({ settings: updated })
    return updated
  }
}))
