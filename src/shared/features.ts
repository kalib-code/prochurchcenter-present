/**
 * Compile-time feature flags.
 *
 * `canva`: the Canva integration is hidden for now, not removed. With it
 * off, every Canva ENTRY POINT in the UI is gone — the "Canva" card in the
 * add-item picker, the Connections (Canva account) settings tab, the
 * "From Canva" badge / Refresh button on deck cards, and the background
 * "updated in Canva?" check. Decks already imported from Canva are plain
 * PDFs on disk, so they keep presenting as normal decks; only the
 * Canva-specific actions disappear. The main-process Canva code is left
 * untouched. Flip to `true` to bring it all back.
 */
export const FEATURES = {
  canva: false
} as const
