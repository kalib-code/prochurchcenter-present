/**
 * useThemeStore — renderer-side cache of the active theme.
 *
 * v1.0 only ships a single theme ('default'), but the contract already
 * supports multiple, so this store reads the active theme id out of
 * settings and loads the matching Theme record. Updates are optimistic
 * (patch locally, then fire IPC), same as useSettingsStore — including
 * its ReplySequencer ordering/rollback and never-rejecting `update`.
 *
 * This store is mounted in TWO places:
 *   - Operator Settings page: drives the theme editor form + live preview
 *   - Output window: provides the Theme to SlideRenderer
 *
 * The output window ALSO subscribes to `theme.onChange` broadcasts so
 * that edits in the operator window appear on the projector instantly
 * without requiring a full reload.
 */

import { create } from 'zustand'
import type { Theme } from '@shared/types'
import type { UpdateThemePatch } from '@shared/ipc-contract'
import { createReplySequencer } from './replySequencer'

interface ThemeState {
  theme: Theme | null
  loading: boolean
  error: string | null

  /** Load the active theme. activeThemeId defaults to 'default' for v1.0. */
  load: (activeThemeId?: string) => Promise<void>
  /** Optimistic update — merges locally then persists. Resolves to main's
   * reply, or null on failure (rolled back, `error` set; never rejects). */
  update: (patch: UpdateThemePatch) => Promise<Theme | null>
  /**
   * Replace the cached theme wholesale. Used by the output window when a
   * broadcast arrives from main, so Settings edits propagate without a
   * round-trip through the operator renderer.
   */
  setFromBroadcast: (theme: Theme) => void
}

const sequencer = createReplySequencer<Theme>()

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: null,
  loading: false,
  error: null,

  load: async (activeThemeId = 'default') => {
    if (get().theme || get().loading) return
    set({ loading: true, error: null })
    try {
      const theme = await window.api.theme.get(activeThemeId)
      if (!theme) throw new Error(`Theme not found: ${activeThemeId}`)
      set({ theme, loading: false })
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : String(err) })
    }
  },

  update: async (patch) => {
    const current = get().theme
    if (!current) {
      console.error('[theme] update before the theme loaded — ignored', patch)
      return null
    }
    const seq = sequencer.begin(current)
    // Optimistic local merge so the editor feels instant even while IPC
    // is in flight. Preserve the id since patch can never touch it.
    set({ theme: { ...current, ...patch, id: current.id } })
    try {
      const updated = await window.api.theme.update(current.id, patch)
      const apply = sequencer.succeed(seq, updated)
      if (apply) set({ theme: apply.value, error: null })
      return updated
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[theme] update failed, rolling back', patch, err)
      const apply = sequencer.fail(seq)
      set(apply ? { theme: apply.value, error: message } : { error: message })
      return null
    }
  },

  setFromBroadcast: (theme) => set({ theme })
}))
