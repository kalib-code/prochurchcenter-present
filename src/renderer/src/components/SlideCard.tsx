/**
 * SlideCard — visual preview of a single slide in Service Mode's slide
 * grid.
 *
 * Structure: a rounded 16:9 thumbnail with a caption row underneath
 * (section label left, shortcut glyph right), Figma-Slides style.
 *
 *   ╭──────────────────────────╮
 *   │    lyric line 1          │
 *   │    lyric line 2          │
 *   ╰──────────────────────────╯
 *    Verse 1         [Live] V1    ← caption + status chip: Live (red,
 *                                   on air), Current (neutral, cursor
 *                                   while the output is cut to
 *                                   black/logo) or Next
 *
 * Ring colour carries the state: red ring = on the projector right now,
 * accent ring = current slide while the output is cut, subtle accent
 * ring = next slide. Red is used for nothing else.
 *
 * Body rendering modes (highest priority first):
 *   1. `preview` is set    → MediaPreview thumbnail (image/video/PDF/PowerPoint)
 *   2. `theme` background  → text lines on top of the theme's
 *                            backgroundImagePath / backgroundColor
 *   3. neither             → text lines on plain black (fallback) —
 *                            `themedBodyStyle(null)` already resolves
 *                            to `#000000`.
 *
 * Why no background VIDEO support: a setlist with a video bg would
 * spawn N <video> elements (one per card in the grid) running
 * simultaneously, which crashes weak hardware. Video bg shows on the
 * projector + confidence monitor only; cards use the still image bg
 * if both are set, else color.
 *
 * A subtle dark scrim lifts text legibility on busy backgrounds — it's
 * 25% opacity black, just enough to read white text without obscuring
 * the image content underneath. (The Song Editor's own slide grid
 * deliberately omits this scrim; see ../lib/slideTheming.ts's doc
 * comment for why the two must differ.)
 *
 * Real `<button>` (not `<div role="button">`) so every card is keyboard
 * operable. Chromium's UA stylesheet gives a button
 * `align-items: flex-start`; the root resets it with `items-stretch` so
 * the thumbnail and caption span the card's full width.
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
import { cn } from '../lib/utils'
import { MediaPreview, type PptxThumbError } from './MediaPreview'
import { NextBadge, OnAirBadge, QuietBadge } from './service/StatusBadges'

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
  /**
   * The active slide is actually on the projector (output mode is Live,
   * not Black/Logo). Only meaningful together with `active`; draws the
   * red ring + "Live" chip. When `active` is set without it, the card
   * shows the neutral "Current" state instead.
   */
  onAir?: boolean
  /** The slide Space will advance to — subtle accent ring + "Next" chip. */
  next?: boolean
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
  onAir = false,
  next = false,
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

  const live = active && onAir
  const ring = live
    ? 'ring-2 ring-live'
    : active
      ? 'ring-2 ring-accent'
      : next
        ? 'ring-1 ring-accent/60'
        : 'ring-1 ring-white/[0.07] group-hover:ring-border'

  return (
    <button
      type="button"
      onClick={onClick}
      data-active={active ? 'true' : undefined}
      style={style}
      className="group flex w-full flex-col items-stretch gap-1.5 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-4 focus-visible:ring-offset-panel"
    >
      <div
        className={cn(
          'relative aspect-[16/9] w-full overflow-hidden rounded-lg bg-black transition-shadow',
          ring
        )}
      >
        {/* Slide body — fills the thumbnail. If a media preview is
            provided, it renders edge-to-edge. Otherwise the body's inline
            style applies the theme background (image + color) and the
            text lines render on top with the theme's text color. */}
        <div
          ref={containerRef}
          className="relative flex h-full w-full items-center justify-center overflow-hidden"
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
              className="h-full w-full rounded-none"
              onError={onPreviewError}
            />
          ) : lines.length === 0 ? (
            <span className="relative text-[12px] text-muted-foreground">Blank slide</span>
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

      </div>

      {/* Caption — section label left; status chip + shortcut glyph
          right. The chip lives here, not on the thumbnail, so it never
          covers the lyrics the operator is checking. */}
      <div className="flex h-5 items-center gap-2 px-0.5">
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-[12px] font-medium',
            active ? 'text-foreground' : 'text-soft'
          )}
        >
          {sectionLabel || '—'}
        </span>
        {live ? (
          <OnAirBadge className="shrink-0" />
        ) : active ? (
          <QuietBadge className="shrink-0">Current</QuietBadge>
        ) : next ? (
          <NextBadge className="shrink-0" />
        ) : null}
        {shortcut && (
          <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">
            {shortcut}
          </span>
        )}
      </div>
    </button>
  )
}
