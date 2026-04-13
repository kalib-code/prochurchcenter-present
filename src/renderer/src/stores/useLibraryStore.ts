/**
 * useLibraryStore — the renderer's cached view of the song library.
 *
 * Zustand wraps `window.api.songs` so UI components never touch IPC directly.
 * The store is deliberately dumb: it mirrors what main says, it doesn't
 * re-parse songs locally (main re-parses on every update), and it doesn't
 * try to keep optimistic state — each CRUD call awaits the main response
 * and replaces the list entry with whatever came back.
 *
 * Why: Phase 2's only job is to prove the IPC round-trip works end-to-end.
 * Optimistic UI and undo/redo live at the editor level, not at the store.
 */

import { create } from 'zustand'
import type { Song } from '@shared/types'
import type { CreateSongInput, UpdateSongPatch } from '@shared/ipc-contract'

interface LibraryState {
  songs: Song[]
  loading: boolean
  error: string | null

  load: () => Promise<void>
  create: (input: CreateSongInput) => Promise<Song>
  update: (id: string, patch: UpdateSongPatch) => Promise<Song>
  remove: (id: string) => Promise<void>

  /** Pure selector — by-id lookup from the cached list (no IPC) */
  getById: (id: string) => Song | undefined
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  songs: [],
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null })
    try {
      const songs = await window.api.songs.list()
      // Sort client-side by title so the list is stable regardless of fs order
      songs.sort((a, b) => a.title.localeCompare(b.title))
      set({ songs, loading: false })
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : String(err) })
    }
  },

  create: async (input) => {
    const created = await window.api.songs.create(input)
    set((state) => ({
      songs: [...state.songs, created].sort((a, b) => a.title.localeCompare(b.title))
    }))
    return created
  },

  update: async (id, patch) => {
    const updated = await window.api.songs.update(id, patch)
    set((state) => ({
      songs: state.songs
        .map((s) => (s.id === id ? updated : s))
        .sort((a, b) => a.title.localeCompare(b.title))
    }))
    return updated
  },

  remove: async (id) => {
    await window.api.songs.delete(id)
    set((state) => ({ songs: state.songs.filter((s) => s.id !== id) }))
  },

  getById: (id) => get().songs.find((s) => s.id === id)
}))
