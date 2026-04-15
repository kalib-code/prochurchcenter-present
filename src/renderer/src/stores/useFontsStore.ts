/**
 * useFontsStore — manages custom (user-uploaded) and system (locally
 * installed) fonts available to the theme picker.
 *
 * Two sources:
 *   1. Custom fonts — uploaded via the operator UI, stored under
 *      userData/fonts/, listed via the fonts IPC, injected into the
 *      page via dynamic @font-face declarations on first load.
 *   2. System fonts — enumerated via the Local Font Access API
 *      (window.queryLocalFonts). Available in Chromium ≥103 — the
 *      Electron 34 we ship more than satisfies that. Requires the
 *      'local-fonts' permission, which Electron grants to packaged
 *      apps by default but the user may need to allow on first use.
 *
 * Both lists are loaded once on mount and cached for the session.
 * A `refresh` action reloads both — used after uploading a new font
 * or if the user installs a new system font without restarting.
 */

import { create } from 'zustand'
import type { CustomFontEntry } from '@shared/ipc-contract'

/**
 * The minimal shape of a FontData entry returned by
 * window.queryLocalFonts(). Typed locally because lib.dom doesn't
 * always include this experimental API depending on TS version.
 */
interface SystemFontData {
  family: string
  fullName: string
  postscriptName: string
  style: string
}

interface FontsState {
  custom: CustomFontEntry[]
  system: string[] // unique family names
  loadingSystem: boolean
  systemError: string | null

  loadCustom: () => Promise<void>
  loadSystem: () => Promise<void>
  uploadCustom: () => Promise<CustomFontEntry | null>
  deleteCustom: (family: string) => Promise<void>
  /** Refresh both lists — used after upload + by a manual button. */
  refresh: () => Promise<void>
}

/**
 * Inject @font-face declarations for every custom font into a
 * dedicated <style> element appended to the document head. Idempotent
 * — re-running it just rewrites the style sheet's contents.
 *
 * The src URL uses our present-media:// custom protocol so the fonts
 * resolve through the same code path as images and videos. URLs are
 * URI-encoded so spaces and special characters in font filenames
 * survive the round trip.
 */
const STYLE_ELEMENT_ID = 'present-custom-fonts'
function injectFontFaces(fonts: CustomFontEntry[]): void {
  let styleEl = document.getElementById(STYLE_ELEMENT_ID) as HTMLStyleElement | null
  if (!styleEl) {
    styleEl = document.createElement('style')
    styleEl.id = STYLE_ELEMENT_ID
    document.head.appendChild(styleEl)
  }
  styleEl.textContent = fonts
    .map((f) => {
      const url = `present-media://local${encodeURI(f.absolutePath)}`
      // Quote the family name to handle hyphens / special chars in
      // CSS family identifiers without escaping headaches.
      return `@font-face { font-family: "${f.family}"; src: url("${url}"); font-display: swap; }`
    })
    .join('\n')
}

export const useFontsStore = create<FontsState>((set, get) => ({
  custom: [],
  system: [],
  loadingSystem: false,
  systemError: null,

  loadCustom: async () => {
    const list = await window.api.fonts.list()
    injectFontFaces(list)
    set({ custom: list })
  },

  loadSystem: async () => {
    set({ loadingSystem: true, systemError: null })
    try {
      // queryLocalFonts is on `window`, not `navigator`. TypeScript's
      // lib.dom doesn't know about it — cast through unknown.
      const queryLocalFonts = (
        window as unknown as {
          queryLocalFonts?: () => Promise<SystemFontData[]>
        }
      ).queryLocalFonts
      if (typeof queryLocalFonts !== 'function') {
        set({
          loadingSystem: false,
          systemError: 'System font enumeration not available in this build.'
        })
        return
      }
      const all = await queryLocalFonts()
      // Dedupe by family name — Local Font API returns one entry per
      // FACE (e.g. Inter Regular, Inter Bold, Inter Italic), but the
      // theme picker only cares about families.
      const families = Array.from(
        new Set(all.map((f) => f.family).filter(Boolean))
      ).sort((a, b) => a.localeCompare(b))
      set({ system: families, loadingSystem: false })
    } catch (err) {
      set({
        loadingSystem: false,
        systemError:
          err instanceof Error
            ? err.message
            : 'Could not enumerate system fonts.'
      })
    }
  },

  uploadCustom: async () => {
    const entry = await window.api.fonts.upload()
    if (!entry) return null
    // Re-fetch the list to get the canonical state, then re-inject.
    const list = await window.api.fonts.list()
    injectFontFaces(list)
    set({ custom: list })
    return entry
  },

  deleteCustom: async (family: string) => {
    await window.api.fonts.delete(family)
    const list = await window.api.fonts.list()
    injectFontFaces(list)
    set({ custom: list })
  },

  refresh: async () => {
    await Promise.all([get().loadCustom(), get().loadSystem()])
  }
}))
