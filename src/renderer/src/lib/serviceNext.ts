/**
 * serviceNext — what pressing SPACE will actually do.
 *
 * The traversal here MIRRORS useServiceStore.nextSlide exactly. If the two
 * ever diverge, the NEXT panel starts lying to the operator mid-service
 * about where they are about to land — which is the worst possible failure
 * for this feature. serviceNext.test.ts pins them together by walking every
 * reachable position and asserting they agree.
 *
 * Kept separate from the store rather than derived from it because the
 * panel needs to know about the transition WITHOUT performing it.
 */

import type { SlidePayload } from '@shared/ipc-contract'
import type { RenderableItem } from './slideify'

export type NextResolution =
  | {
      kind: 'same-item'
      slide: SlidePayload
      itemLabel: string
      itemIndex: number
      slideIndex: number
    }
  | {
      kind: 'new-item'
      slide: SlidePayload
      itemLabel: string
      /** The item being left — used for "Leaves X and starts Y." */
      fromItemLabel: string
      itemIndex: number
      slideIndex: number
    }
  | { kind: 'end' }

export function resolveNext(
  items: RenderableItem[],
  itemIndex: number,
  slideIndex: number
): NextResolution {
  const item = items[itemIndex]
  if (!item) return { kind: 'end' }

  // Advance within the current item.
  if (slideIndex + 1 < item.slides.length) {
    return {
      kind: 'same-item',
      slide: item.slides[slideIndex + 1],
      itemLabel: item.label,
      itemIndex,
      slideIndex: slideIndex + 1
    }
  }

  // Roll into the next item at its first slide.
  const next = items[itemIndex + 1]
  if (next && next.slides.length > 0) {
    return {
      kind: 'new-item',
      slide: next.slides[0],
      itemLabel: next.label,
      fromItemLabel: item.label,
      itemIndex: itemIndex + 1,
      slideIndex: 0
    }
  }

  return { kind: 'end' }
}
