/**
 * SlideCard — visual preview of a single slide in Service Mode's slide
 * grid, KLB-styled per design L583–591.
 *
 * Structure (all inside one `aspect-[16/9]` root so cards are uniformly
 * shaped regardless of grid column width):
 *
 *   ┌──────────────────────────┐
 *   │ Verse 1               1  │  ← header strip: mono label left,
 *   ├──────────────────────────┤    shortcut glyph right, shrink-0
 *   │  [theme bg image]        │
 *   │    lyric line 1          │  ← body, flex-1, theme bg or media
 *   │    lyric line 2          │
 *   └──────────────────────────┘
 *
 * Body rendering modes (highest priority first):
 *   1. `preview` is set    → MediaPreview thumbnail (image/video/PDF/PowerPoint)
 *   2. `theme` background  → text lines on top of the theme's
 *                            backgroundImagePath / backgroundColor
 *   3. neither             → text lines on plain black (fallback) —
 *                            `themedBodyStyle(null)` already resolves
 *                            to `#000000`, matching the design's
 *                            `bg-black` body.
 *
 * Why no background VIDEO support: a setlist with a video bg would
 * spawn N <video> elements (one per card in the grid) running
 * simultaneously, which crashes weak hardware. Video bg shows on the
 * projector + confidence monitor only; cards use the still image bg
 * if both are set, else color.
 *
 * A subtle dark scrim lifts text legibility on busy backgrounds — it's
 * 25% opacity black, just enough to read white text without obscuring
 * the image content underneath. (Kept intact per the redesign brief —
 * the Song Editor's own slide grid deliberately omits this scrim; see
 * ../lib/slideTheming.ts's doc comment for why the two must differ.)
 *
 * Real `<button>` (not `<div role="button">`): the KLB redesign
 * requires genuine keyboard-operable controls. No ARIA-div workaround is
 * needed, but a button carries TWO UA-stylesheet defaults that have to be
 * overridden, not one: `display: inline-block` AND
 * `align-items: flex-start`. Overriding only the display leaves the header
 * strip and the slide body sizing to their own content instead of
 * spanning the card — see the `items-stretch` note on the element below.
 *
 * Lyric text wraps and auto-shrinks (../hooks/useAutoFitText.ts) rather
 * than being clipped per line. On a card this small a clipped line is
 * worse than a small one: "and all who will believe" rendered as "and all
 * who will be…" reads as different words, and nothing distinguishes a
 * truncated card from a genuinely short slide.
 */

import type { Theme } from '@shared/types'
import { themedBodyStyle, themedTextStyle } from '../lib/slideTheming'
import { useAutoFitText } from '../hooks/useAutoFitText'
import { MediaPreview, type PptxThumbError } from './MediaPreview'

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
   * unstable deps) rather than an inline arrow, and why it receives
   * structured fields rather than a pre-composed message.
   */
  onPreviewError?: (error: PptxThumbError) => void
  /**
   * Active theme — when provided, text-card bodies render with the
   * theme's background image / color and the lines pick up the theme's
   * text color and font family. Without it the card falls back to a
   * plain black body (the original v1 look).
   */
  theme?: Theme | null
  /** Highlight — used when this is the currently-active slide in Service Mode */
  active?: boolean
  /** Click handler — Service Mode always supplies one (jumpTo). */
  onClick?: () => void
  /**
   * Inline style passthrough — Service Mode uses this to set
   * `scrollMarginTop` on the active card so `scrollIntoView({ block:
   * 'nearest' })` doesn't park it underneath the grid's sticky toolbar
   * (and, in GROUPED mode, the sticky per-item header on top of that).
   */
  style?: React.CSSProperties
}

export function SlideCard({
  sectionLabel,
  shortcut,
  lines,
  preview,
  onPreviewError,
  theme,
  active = false,
  onClick,
  style
}: SlideCardProps): JSX.Element {
  // Body/text style calculation lives in ../lib/slideTheming.ts, shared
  // with SongEditor.tsx's SlidePreviewCard so both grids can never
  // silently drift on how a theme's colors/fonts translate to CSS. Only
  // apply the theme's background image (and its accompanying legibility
  // shadow) when there's no media preview overriding it — a media
  // preview thumbnail already fills the body edge-to-edge.
  const usingThemeBg = Boolean(theme) && !preview
  const bodyStyle = themedBodyStyle(theme, usingThemeBg)
  const textStyle = themedTextStyle(theme, usingThemeBg)

  // Lyrics wrap and shrink to fit rather than being clipped per line. A
  // clipped line is actively misleading here — "and all who will believe"
  // rendered as "and all who will be…" reads as different words, and the
  // operator has no way to tell a truncated card from a genuinely short
  // slide. See ../hooks/useAutoFitText.ts.
  const { containerRef, contentRef } = useAutoFitText(lines.join('\n'))

  return (
    <button
      type="button"
      onClick={onClick}
      data-active={active ? 'true' : undefined}
      style={style}
      // `items-stretch` is load-bearing, not decoration: Chromium's UA
      // stylesheet gives `button` `align-items: flex-start`, which in a
      // `flex-col` card means the header strip and the slide body size
      // themselves to their CONTENT instead of spanning the card. The
      // visible symptom is a header that renders as a short chip in the
      // top-left and a body that shrink-wraps around the lyrics, so a
      // media thumbnail has almost no box to render into. Overriding
      // `display` alone is not enough — `align-items` has to be reset too.
      className={`relative flex aspect-[16/9] w-full flex-col items-stretch overflow-hidden border text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-signal ${
        active ? 'border-signal' : 'border-border hover:border-dim'
      }`}
    >
      {/* Header bar — mono section label left, shortcut glyph right */}
      <div
        className={`flex shrink-0 items-center justify-between gap-1.5 border-b border-border px-[9px] py-[6px] ${
          active ? 'bg-signal text-white' : 'bg-panel-hi text-soft'
        }`}
      >
        <span className="truncate font-mono text-[8.5px] font-semibold uppercase tracking-[0.12em]">
          {sectionLabel || '—'}
        </span>
        {shortcut && (
          <span className="shrink-0 pl-1.5 font-mono text-[9px] font-medium">{shortcut}</span>
        )}
      </div>

      {/* Slide body — fills remaining space. If a media preview is
          provided, it renders edge-to-edge. Otherwise the body's inline
          style applies the theme background (image + color) and the
          text lines render on top with the theme's text color. */}
      <div
        ref={containerRef}
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden"
        style={bodyStyle}
      >
        {/* Subtle dark scrim — only when a real background image is
            in play. Keeps text readable on busy photos without
            destroying the visual reference. */}
        {usingThemeBg && theme?.backgroundImagePath && (
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-black/25" />
        )}

        {preview ? (
          <MediaPreview
            source={preview}
            className="h-full w-full border-0"
            onError={onPreviewError}
          />
        ) : lines.length === 0 ? (
          <span className="relative text-[9px] italic text-dim">(empty)</span>
        ) : (
          <div
            ref={contentRef}
            // `text-[11.5px]` is the DESIGN size and stays here on purpose:
            // useAutoFitText only ever shrinks below it, and only once it
            // has really measured the card, so a card that can't be measured
            // still renders at the intended size instead of the browser's
            // 16px default. `max-w-full` + `break-words` keep a single long
            // word (a URL, a run-on lyric) inside the card rather than
            // forcing the block wider than its container, which would defeat
            // the width half of the fit measurement.
            className={`relative max-w-full overflow-hidden break-words p-2 text-center text-[11.5px] font-bold leading-[1.35] ${
              active ? 'text-white' : 'text-quiet'
            }`}
            style={textStyle}
          >
            {lines.map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
        )}
      </div>
    </button>
  )
}
