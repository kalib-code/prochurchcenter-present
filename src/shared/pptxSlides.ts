/**
 * Pure slide arithmetic for PowerPoint decks.
 *
 * Why this is separate from pptxLoader:
 *   Parsing a .pptx needs a DOM (the renderer library uses DOMParser and
 *   querySelector), so it can only run in the renderer or under jsdom. The
 *   index math has real edge cases — hidden slides shift every ordinal after
 *   them — and deserves fast tests in the default node environment. Keeping
 *   it here buys that, and keeps the loader thin.
 *
 * Why "ordinal" vs "source index":
 *   PowerPoint skips slides marked hidden when presenting, so what the
 *   operator calls "slide 6" is not necessarily the 6th slide part in the
 *   file. `ordinal` is 1-based over VISIBLE slides — what the operator sees
 *   and what slideify fans out. `sourceIndex` is 1-based over all slide parts
 *   in the file — what the renderer needs. Conflating them projects the wrong
 *   slide for every deck containing a draft.
 */

export interface PptxSlideMeta {
  /** 1-based position among ALL slide parts in the file. */
  sourceIndex: number
  /** True when the slide is marked `show="0"` — PowerPoint skips it. */
  hidden: boolean
}

/** How many slides an operator will actually be able to project. */
export function visibleSlideCount(slides: PptxSlideMeta[]): number {
  return slides.filter((s) => !s.hidden).length
}

/**
 * Resolve a 1-based visible ordinal to the slide part it refers to.
 * Returns null when the ordinal falls outside the visible range, which
 * happens when the underlying file was replaced with a shorter one after
 * slideCount was cached.
 */
export function ordinalToSourceIndex(
  slides: PptxSlideMeta[],
  ordinal: number
): number | null {
  if (!Number.isInteger(ordinal) || ordinal < 1) return null
  const visible = slides.filter((s) => !s.hidden)
  const match = visible[ordinal - 1]
  return match ? match.sourceIndex : null
}
