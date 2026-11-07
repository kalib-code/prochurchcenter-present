/**
 * useSetlistStore — mirror of window.api.setlists.
 *
 * Same shape as useLibraryStore: dumb cache, every mutation awaits the
 * main process and replaces the entry with whatever came back. Sorted
 * client-side by `date` descending so the most recent service is first.
 *
 * Why by date desc: Ate Rose opens Present on Sunday morning and
 * expects "today" at the top. If there's no today, last Sunday's service
 * is what she wants to clone.
 */

import { create } from 'zustand'
import type { Setlist } from '@shared/types'
import type { CreateSetlistInput, UpdateSetlistPatch } from '@shared/ipc-contract'

interface SetlistState {
  setlists: Setlist[]
  loading: boolean
  error: string | null

  load: () => Promise<void>
  create: (input: CreateSetlistInput) => Promise<Setlist>
  update: (id: string, patch: UpdateSetlistPatch) => Promise<Setlist>
  remove: (id: string) => Promise<void>
  clone: (sourceId: string, newName: string, newDate: string) => Promise<Setlist>
  /** Upsert a setlist saved outside the renderer (an AI tool via MCP). */
  applyExternal: (setlist: Setlist) => void

  getById: (id: string) => Setlist | undefined
}

// Newest (largest YYYY-MM-DD) first; ties break by name for stability.
function sortByDateDesc(list: Setlist[]): Setlist[] {
  return [...list].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1
    return a.name.localeCompare(b.name)
  })
}

export const useSetlistStore = create<SetlistState>((set, get) => ({
  setlists: [],
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null })
    try {
      const setlists = await window.api.setlists.list()
      set({ setlists: sortByDateDesc(setlists), loading: false })
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : String(err) })
    }
  },

  create: async (input) => {
    const created = await window.api.setlists.create(input)
    set((state) => ({ setlists: sortByDateDesc([...state.setlists, created]) }))
    return created
  },

  update: async (id, patch) => {
    const updated = await window.api.setlists.update(id, patch)
    set((state) => ({
      setlists: sortByDateDesc(state.setlists.map((s) => (s.id === id ? updated : s)))
    }))
    return updated
  },

  remove: async (id) => {
    await window.api.setlists.delete(id)
    set((state) => ({ setlists: state.setlists.filter((s) => s.id !== id) }))
  },

  clone: async (sourceId, newName, newDate) => {
    const cloned = await window.api.setlists.clone(sourceId, newName, newDate)
    set((state) => ({ setlists: sortByDateDesc([...state.setlists, cloned]) }))
    return cloned
  },

  applyExternal: (setlist) => {
    set((state) => {
      const exists = state.setlists.some((s) => s.id === setlist.id)
      const next = exists
        ? state.setlists.map((s) => (s.id === setlist.id ? setlist : s))
        : [...state.setlists, setlist]
      return { setlists: sortByDateDesc(next) }
    })
  },

  getById: (id) => get().setlists.find((s) => s.id === id)
}))
