/**
 * serviceNextText — pure copy/formatting for ServiceNextPanel: the
 * tag/label/preview/hint strings describing what pressing SPACE will
 * do next.
 *
 * Extracted out of the component (rather than left as ServiceNextPanel
 * internals) because these three functions had no test coverage of
 * their own — serviceNext.test.ts pins `resolveNext`'s (itemIndex,
 * slideIndex, kind) traversal, but nothing pinned the SENTENCE built
 * from it. In particular the `new-item` hint interpolates two labels
 * in a specific order ("Leaves {from} and starts {to}.") — a reversal
 * of that order reads perfectly fluently and would be completely
 * wrong, and would not be caught by any test that only checks the
 * label VALUES rather than their position in the string. See
 * serviceNextText.test.ts.
 *
 * A component file under components/ is invisible to vitest's include
 * glob (`src/renderer/src/lib/**\/*.test.ts` only) — this has silently
 * skipped test coverage for the same reason three times already in
 * this project (serviceClock, serviceNext, videoRunway all live in
 * lib/ for exactly this reason). Keeping these functions here, not in
 * ServiceNextPanel.tsx, is what makes them testable at all.
 */

import type { SlidePayload } from '@shared/ipc-contract'
import type { NextResolution } from './serviceNext'

export interface NextDescription {
  tag: string
  tagTone: 'signal' | 'neutral'
  label: string
  previewText: string
  hint: string
}

/**
 * For a `text` slide, the lines joined with newlines (rendered
 * `whitespace-pre-line`). Other kinds render their kind name. A `text`
 * slide with an empty `lines` array is a real case — song intro
 * slides are deliberately blank so the congregation gets a beat on
 * the new background before lyrics appear (see slideify.ts) — so it
 * renders an explicit description rather than an empty box.
 */
export function slidePreviewText(slide: SlidePayload): string {
  switch (slide.kind) {
    case 'text':
      return slide.lines.length > 0 ? slide.lines.join('\n') : 'No lyrics — background only'
    case 'image':
      return 'Image'
    case 'video':
      return 'Video'
    case 'pdf-page':
      return `PDF page ${slide.pageIndex}`
    case 'countdown':
      return 'Countdown'
    default: {
      const _never: never = slide
      return _never
    }
  }
}

/**
 * The next slide's section label, falling back to the item's label
 * for slide kinds that don't carry one (image/video/pdf-page/
 * countdown), or a text slide with no sectionLabel set.
 */
export function sectionLabelFor(
  resolution: Extract<NextResolution, { kind: 'same-item' | 'new-item' }>
): string {
  const { slide } = resolution
  if (slide.kind === 'text' && slide.sectionLabel) return slide.sectionLabel
  return resolution.itemLabel
}

export function describeNext(resolution: NextResolution): NextDescription {
  if (resolution.kind === 'end') {
    return {
      tag: 'END OF SERVICE',
      tagTone: 'signal',
      label: 'SERVICE ENDS',
      previewText: '—',
      hint: 'Blacks out the projector and ends the service.'
    }
  }

  const label = sectionLabelFor(resolution)
  const previewText = slidePreviewText(resolution.slide)

  if (resolution.kind === 'new-item') {
    return {
      tag: 'NEW ITEM',
      tagTone: 'signal',
      label,
      previewText,
      // Order matters: FROM (the item being left) comes first, TO (the
      // item being entered) comes second. See the module doc — a
      // reversal here reads fluently and is exactly wrong.
      hint: `Leaves ${resolution.fromItemLabel} and starts ${resolution.itemLabel}.`
    }
  }

  return {
    tag: 'SAME ITEM',
    tagTone: 'neutral',
    label,
    previewText,
    hint: `Stays inside ${resolution.itemLabel}.`
  }
}
