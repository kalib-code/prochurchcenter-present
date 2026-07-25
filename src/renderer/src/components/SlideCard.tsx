/**
 * SlideCard — visual preview of a single slide, FreeShow-style.
 *
 * Structure (all inside one `aspect-[16/9]` root so cards are uniformly
 * shaped regardless of grid column width):
 *
 *   ┌──────────────────────────┐
 *   │ Verse 1                  │  ← header strip, shrink-0
 *   ├──────────────────────────┤
 *   │  [theme bg image]        │
 *   │    lyric line 1          │  ← body, flex-1, theme bg or media
 *   │    lyric line 2          │
 *   │                       1  │  ← shortcut, absolute bottom-right
 *   └──────────────────────────┘
 *
 * Body rendering modes (highest priority first):
 *   1. `preview` is set    → MediaPreview thumbnail (image/video/PDF)
 *   2. `theme` background  → text lines on top of the theme's
 *                            backgroundImagePath / backgroundColor
 *   3. neither             → text lines on plain black (fallback)
 *
 * Why no background VIDEO support: a setlist with a video bg would
 * spawn N <video> elements (one per card in the grid) running
 * simultaneously, which crashes weak hardware. Video bg shows on the
 * projector + confidence monitor only; cards use the still image bg
 * if both are set, else color.
 *
 * A subtle dark scrim lifts text legibility on busy backgrounds — it's
 * 25% opacity black, just enough to read white text without obscuring
 * the image content underneath.
 *
 * Why the card-level aspect ratio: an earlier version put `aspect-[16/9]`
 * on the INNER body div inside a `flex-col` card. That confuses browsers
 * because the body didn't have an explicit width reference, so the
 * aspect-ratio calc produced inconsistent heights — the black rectangle
 * randomly ended up smaller than expected and text overflowed onto the
 * card's dark-grey background. Lifting aspect-ratio to the root fixes it:
 * the card gets its width from the grid column, height follows 9/16 of
 * that, and the header+body split fills the fixed total.
 *
 * Why a <div role="button"> instead of <button>: native button elements
 * have browser-default styles (alignment, min-width, inline-block) that
 * fight with flex + aspect-ratio in subtle ways. Using a div with ARIA
 * keyboard support is cleaner and visually reliable.
 */

import type { CSSProperties } from 'react'
import type { Theme } from '@shared/types'
import { MediaPreview } from './MediaPreview'

/**
 * Optional visual preview source rendered INSIDE the slide body,
 * replacing the text lines. Used by Service Mode to show thumbnails
 * for image / video / pdf-page slides so the operator can see at a
 * glance what's coming up next.
 */
export type SlideCardPreview =
  | { kind: 'image'; path: string }
  | { kind: 'video'; path: string }
  | { kind: 'deck'; pdfPath: string; pageIndex: number }
  | { kind: 'pptx'; pptxPath: string; slideOrdinal: number }

interface SlideCardProps {
  sectionLabel: string
  shortcut: string
  lines: string[]
  /** When set, renders a media thumbnail in place of the text lines. */
  preview?: SlideCardPreview
  /**
   * Forwarded to MediaPreview's `onError` — only fires for a `pptx`
   * preview whose PptxSlideView render fails. See MediaPreview.tsx for
   * why this must stay a stable reference (a `useCallback` with no
   * unstable deps) rather than an inline arrow.
   */
  onPreviewError?: (message: string) => void
  /**
   * Active theme — when provided, text-card bodies render with the
   * theme's background image / color and the lines pick up the theme's
   * text color and font family. Without it the card falls back to a
   * plain black body (the original v1 look).
   */
  theme?: Theme | null
  /** Highlight ring — used when this is the currently-active slide in Service Mode */
  active?: boolean
  /** Click handler — if provided, the card is clickable */
  onClick?: () => void
}

/**
 * Build a present-media:// URL the same way SlideRenderer does.
 * Inlined here to keep SlideCard free of imports from SlideRenderer.
 */
function fileUrl(path: string): string {
  return `present-media://local${encodeURI(path)}`
}

export function SlideCard({
  sectionLabel,
  shortcut,
  lines,
  preview,
  onPreviewError,
  theme,
  active = false,
  onClick
}: SlideCardProps): JSX.Element {
  // Build the body style. Three layers, applied conditionally:
  //   1. backgroundColor (always — black if no theme)
  //   2. backgroundImage (if theme has one AND there's no media preview)
  //   3. text color / fontFamily (if theme is set)
  const usingThemeBg = theme && !preview
  const bodyStyle: CSSProperties = {
    backgroundColor: theme?.backgroundColor ?? '#000000'
  }
  if (usingThemeBg && theme?.backgroundImagePath) {
    bodyStyle.backgroundImage = `url(${fileUrl(theme.backgroundImagePath)})`
    bodyStyle.backgroundSize = 'cover'
    bodyStyle.backgroundPosition = 'center'
  }

  const textStyle: CSSProperties = theme
    ? {
        color: theme.textColor,
        fontFamily: theme.fontFamily,
        // Tiny shadow keeps text legible on busy backgrounds even
        // without an explicit textEffect — operator preview only,
        // doesn't affect projector output.
        textShadow: usingThemeBg && theme.backgroundImagePath
          ? '0 1px 2px rgba(0,0,0,0.85)'
          : undefined
      }
    : {}

  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? -1 : undefined}
      data-active={active ? 'true' : undefined}
      className={`relative flex aspect-[16/9] flex-col overflow-hidden rounded-md border text-left transition-colors ${
        onClick ? 'cursor-pointer' : ''
      } ${
        active
          ? 'border-amber-400 ring-2 ring-amber-400/40'
          : 'border-white/10 hover:border-white/30'
      }`}
    >
      {/* Header strip — fixed height, lighter background than the slide body */}
      <div className="flex shrink-0 items-center border-b border-white/5 bg-neutral-800/80 px-2.5 py-1">
        <span className="truncate text-[10px] font-semibold uppercase tracking-wide text-white/70">
          {sectionLabel || '—'}
        </span>
      </div>

      {/* Slide body — fills remaining space. If a media preview is
          provided, it renders edge-to-edge. Otherwise the body's
          inline style applies the theme background (image + color) and
          the text lines render on top with the theme's text color. */}
      <div
        className="relative flex flex-1 items-center justify-center overflow-hidden"
        style={bodyStyle}
      >
        {/* Subtle dark scrim — only when a real background image is
            in play. Keeps text readable on busy photos without
            destroying the visual reference. */}
        {usingThemeBg && theme?.backgroundImagePath && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-black/25"
          />
        )}

        {preview ? (
          <MediaPreview
            source={preview}
            className="h-full w-full rounded-none border-0"
            onError={onPreviewError}
          />
        ) : lines.length === 0 ? (
          <span className="relative text-[9px] italic text-white/30">(empty)</span>
        ) : (
          <div
            className="relative overflow-hidden p-2 text-center text-[10px] font-semibold leading-snug"
            style={textStyle}
          >
            {lines.map((line, i) => (
              <div key={i} className="truncate">
                {line}
              </div>
            ))}
          </div>
        )}

        {shortcut && (
          <div className="pointer-events-none absolute bottom-0.5 right-1.5 rounded bg-black/50 px-1 text-base font-light leading-tight text-white/70">
            {shortcut}
          </div>
        )}
      </div>
    </div>
  )
}
