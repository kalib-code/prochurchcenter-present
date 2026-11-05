/**
 * useSettingsStore — the renderer's live copy of the global settings file.
 *
 * Pattern is the same as useLibraryStore / useSetlistStore: thin cache
 * over window.api.settings. Unlike library/setlists, there is only ONE
 * settings object, so the store just holds that one object directly.
 *
 * Components that care about settings (Service Mode, Settings page) call
 * `load()` on mount if not already loaded. Updates are optimistic — we
 * set the local state immediately, fire the IPC update, and reconcile
 * with main's reply via a ReplySequencer: only the newest reply counts
 * (so a late reply can't snap a dragged slider back), and a failure rolls
 * back to the last value main accepted. `update` never rejects — failures
 * land in `error` and the console, so `void update(...)` call sites can't
 * produce unhandled rejections.
 */

import { create } from 'zustand'
import type { Settings } from '@shared/types'
import type { UpdateSettingsPatch } from '@shared/ipc-contract'
import { createReplySequencer } from './replySequencer'

interface SettingsState {
  settings: Settings | null
  loading: boolean
  error: string | null

  load: () => Promise<void>
  /** Resolves to main's reply, or null if the save failed (never rejects). */
  update: (patch: UpdateSettingsPatch) => Promise<Settings | null>
}

const sequencer = createReplySequencer<Settings | null>()

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
    const seq = sequencer.begin(current)
    if (current) {
      set({ settings: { ...current, ...patch } as Settings })
    }
    try {
      const updated = await window.api.settings.update(patch)
      const apply = sequencer.succeed(seq, updated)
      if (apply) set({ settings: apply.value, error: null })
      return updated
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[settings] update failed, rolling back', patch, err)
      const apply = sequencer.fail(seq)
      set(apply ? { settings: apply.value, error: message } : { error: message })
      return null
    }
  }
}))
