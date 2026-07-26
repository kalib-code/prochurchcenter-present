/**
 * useAutoFitText — shrink a text block's font-size until it fits its
 * container, for the small slide-preview cards.
 *
 * Why this exists: a grid card is ~190x105px, but a lyric line is a full
 * sentence ("And all who've gone before us, and all who will believe").
 * The card's job is to tell the operator what is about to project, so text
 * that is cut off is worse than text that is small — a half-line reads as a
 * DIFFERENT lyric, and the operator can't tell truncation from the real
 * slide content. Shrinking to fit keeps the card honest.
 *
 * Relationship to SlideRenderer's AutoFitController: same algorithm shape
 * (ratio-scale once, then fine-tune, retry on resize), deliberately NOT the
 * same code. AutoFitController is coupled to a `Theme` + `SlidePayload` and
 * sizes from a percentage of the container so the projector fills the
 * screen; a card instead starts from a fixed design size and only ever
 * shrinks, so that short slides all render at the same size and the grid
 * still reads as a uniform set of cards rather than a wall of
 * randomly-sized type.
 *
 * The measurement lessons below are inherited from that component, where
 * they were each a real bug:
 *
 *   - Read refs INSIDE fit(), never from effect-start closure. The content
 *     node is remounted whenever the text changes, and a captured
 *     reference would style a detached node while the visible one keeps
 *     its inherited size.
 *   - Bail (don't guess) when the container reports zero size — a card
 *     scrolled far off-screen, or measured before layout flushes, would
 *     otherwise be permanently sized from a bogus measurement. The
 *     ResizeObserver re-fires once it has a real box.
 *   - Fine-tune after the ratio pass: shrinking can re-flow a wrapped line
 *     into fewer lines, which changes the height non-linearly, so one
 *     division is not always enough.
 */

import { useLayoutEffect, useRef } from 'react'

/**
 * Never shrink past this. Below ~6px lyrics stop being readable at a
 * glance, and a card that shows an unreadable smudge is no more useful
 * than one that clipped — but it IS more misleading, because nothing
 * signals that anything is wrong. At the floor the block simply clips,
 * which at least looks clipped.
 */
const MIN_PX = 6
/** Leaves a hair of breathing room so text never kisses the card border. */
const SAFETY = 0.97
/** Ratio-scaling can overshoot when a line re-wraps; a few passes settle it. */
const MAX_TUNE_PASSES = 6

export interface AutoFitRefs {
  /** Attach to the box the text must fit inside (the card body). */
  containerRef: React.RefObject<HTMLDivElement>
  /** Attach to the text block itself — this is what gets font-size written. */
  contentRef: React.RefObject<HTMLDivElement>
}

/**
 * Fit `contentRef`'s text inside `containerRef`, re-running whenever the
 * text changes or the container is resized (both panel drags and window
 * resizes change a card's width mid-service).
 *
 * `deps` should identify the rendered text — pass the joined lines, not the
 * array, so a re-render with an equal-but-new array doesn't re-measure.
 */
export function useAutoFitText(deps: string): AutoFitRefs {
  const containerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const fit = (): void => {
      const container = containerRef.current
      const content = contentRef.current
      if (!container || !content) return

      // Always restart from the design size rather than from wherever the
      // previous pass left off — otherwise a card that once shrank for a
      // long lyric would stay small after the operator widened the panel.
      //
      // Clearing the INLINE size (rather than writing a constant) hands the
      // base size back to the caller's CSS, which is what makes the
      // measurement failure below safe: a card that never gets measured
      // keeps its designed Tailwind size instead of falling back to the
      // browser default of 16px, which is far too big for these cards.
      content.style.fontSize = ''
      const basePx = parseFloat(getComputedStyle(content).fontSize)
      if (!Number.isFinite(basePx) || basePx <= 0) return

      const availableW = container.clientWidth
      const availableH = container.clientHeight
      // Not laid out yet (or inside a window that is not being composited,
      // e.g. the operator window while the projector covers it on a
      // single-display setup). Leaving the CSS size in place is the whole
      // point of clearing rather than overwriting it above — the card stays
      // correct, just un-shrunk, and the ResizeObserver re-runs this the
      // moment the box has real dimensions.
      if (availableW === 0 || availableH === 0) return

      const contentH = content.scrollHeight
      const contentW = content.scrollWidth
      if (contentH === 0 || contentW === 0) return

      // `Math.min(..., 1)` is what makes this shrink-only: a short lyric
      // that already fits keeps BASE_PX instead of being blown up to fill
      // the card, so cards stay visually consistent with each other.
      const ratio = Math.min(availableH / contentH, availableW / contentW)
      // Already fits at the design size — leave the CSS size alone rather
      // than pinning an inline size a hair below it, so short slides across
      // the grid all render at exactly the same size. This is also what
      // makes the hook shrink-only: a two-word slide is never blown up to
      // fill its card.
      if (ratio >= 1) return

      let size = Math.max(basePx * ratio * SAFETY, MIN_PX)
      content.style.fontSize = `${size}px`

      for (let i = 0; i < MAX_TUNE_PASSES; i++) {
        if (
          content.scrollHeight <= container.clientHeight &&
          content.scrollWidth <= container.clientWidth
        ) {
          break
        }
        if (size <= MIN_PX) break
        size = Math.max(size * SAFETY, MIN_PX)
        content.style.fontSize = `${size}px`
      }
    }

    fit()

    const container = containerRef.current
    let ro: ResizeObserver | null = null
    if (container) {
      ro = new ResizeObserver(() => fit())
      ro.observe(container)
    }
    return () => ro?.disconnect()
  }, [deps])

  return { containerRef, contentRef }
}
