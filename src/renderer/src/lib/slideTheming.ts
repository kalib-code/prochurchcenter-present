/**
 * slideTheming — shared pure calculation for rendering a themed slide
 * card's background + text CSS from a `Theme`.
 *
 * Used by BOTH `../components/SlideCard.tsx` (Service Mode's slide grid,
 * and this app's confidence-monitor cards) and
 * `../pages/SongEditor.tsx`'s `SlidePreviewCard` (the Song Editor's own
 * slide-layout grid). Before this extraction the same calculation
 * existed as two independent copies; if either drifted — a new theme
 * field, a different render-priority rule when both media types are
 * set, a URL-scheme change — the two grids could silently start showing
 * different colors/fonts for the same song, with no type error and no
 * failing test to catch it. One shared implementation makes that
 * impossible by construction.
 *
 * Deliberately excludes:
 *   - Background VIDEO. Neither caller mounts a `<video>` element for
 *     these small grid cards — only the full `SlideRenderer` (the
 *     output window / confidence monitor's main view) does. See
 *     `SlideCard.tsx`'s own doc comment for why: N simultaneous videos
 *     across a grid of cards is a real "crashes weak hardware" risk.
 *   - `SlideCard`'s dark scrim overlay (`bg-black/25` on top of a themed
 *     image). That is a `SlideCard`-specific presentation choice layered
 *     ON TOP of the shared body style, not part of the shared
 *     calculation — `SlideCard.tsx` still applies it itself. The Song
 *     Editor's grid deliberately does NOT add an equivalent: its whole
 *     purpose is to let the operator catch lyrics going unreadable over
 *     a busy background, and a scrim would artificially lift legibility
 *     in exactly the preview meant to reveal that problem. `SlideRenderer`
 *     (what the projector actually renders) has no scrim either, so the
 *     scrim-less card is the one that tells the truth.
 */

import type { CSSProperties } from 'react'
import type { Theme } from '@shared/types'
import { toMediaUrl } from '@shared/mediaUrl'

/**
 * Build a `present-media://` URL for a local file path that lives
 * outside the app bundle (a user-picked background image, logo, etc).
 * Electron blocks plain `file://` loads across origins from the dev
 * renderer (which runs on `http://localhost`), so every local media
 * reference in the app goes through this custom scheme — registered in
 * `main/index.ts`, resolved to a real file read on the main process side.
 */
export function fileUrl(path: string): string {
  // Shared encoder: encodeURI left `#`/`?` raw, breaking "Song #2.jpg".
  return toMediaUrl(path)
}

/**
 * Body background style for a themed slide card: background color
 * always (black if no theme is available yet), background image layered
 * on top when `showImage` is true and the theme has one.
 *
 * `showImage` lets a caller that's displaying something else instead of
 * the theme background — `SlideCard`'s media-preview thumbnail for
 * image/video/pdf items — skip the image layer without losing the color
 * fallback underneath it. Callers with no such concept (the Song Editor
 * grid, which only ever shows lyric text) just omit the argument.
 */
export function themedBodyStyle(
  theme: Theme | null | undefined,
  showImage = true
): CSSProperties {
  const style: CSSProperties = {
    backgroundColor: theme?.backgroundColor ?? '#000000'
  }
  if (showImage && theme?.backgroundImagePath) {
    style.backgroundImage = `url(${fileUrl(theme.backgroundImagePath)})`
    style.backgroundSize = 'cover'
    style.backgroundPosition = 'center'
  }
  return style
}

/**
 * Text style for a themed slide card: the theme's text color and font
 * family, plus a small fixed text-shadow when a background image is
 * actually showing (matches `showImage` above), so lyric text stays
 * legible over a photo without needing the theme's own `textEffect` to
 * be configured. Returns `{}` when there's no theme yet, so text falls
 * through to whatever color it inherits from its container.
 */
export function themedTextStyle(
  theme: Theme | null | undefined,
  showImage = true
): CSSProperties {
  if (!theme) return {}
  return {
    color: theme.textColor,
    fontFamily: theme.fontFamily,
    textShadow: showImage && theme.backgroundImagePath ? '0 1px 2px rgba(0,0,0,0.85)' : undefined
  }
}
