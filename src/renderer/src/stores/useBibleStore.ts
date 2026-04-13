/**
 * useBibleStore — renderer cache of the helloao translation list.
 *
 * One global store rather than per-component fetch so the dropdown
 * doesn't re-call IPC every time a setlist with multiple scripture
 * items mounts. The list is small (~770 KB JSON, ~1,256 entries) and
 * only fetched once per app session — main-side bibleCache persists
 * across sessions, so the IPC call is fast on every cold start after
 * the first.
 *
 * Books / chapters / lookups are NOT cached here — they're invoked
 * directly on the `window.api.bible` surface from the consuming
 * component, since each lookup is unique and short-lived.
 */

import { create } from 'zustand'
import type { BibleTranslationMeta } from '@shared/types'

interface BibleState {
  translations: BibleTranslationMeta[]
  loading: boolean
  error: string | null

  /** Idempotent — safe to call from multiple components on mount. */
  loadTranslations: () => Promise<void>
}

export const useBibleStore = create<BibleState>((set, get) => ({
  translations: [],
  loading: false,
  error: null,

  loadTranslations: async () => {
    if (get().translations.length > 0 || get().loading) return
    set({ loading: true, error: null })
    try {
      const list = await window.api.bible.listTranslations()
      set({ translations: list, loading: false })
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to load translations'
      })
    }
  }
}))
