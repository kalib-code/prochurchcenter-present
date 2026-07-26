import { describe, expect, it } from 'vitest'
import type { RenderableItem } from './slideify'
import { resolveNext } from './serviceNext'

const text = (s: string) => ({ kind: 'text' as const, lines: [s], sectionLabel: s })

const items: RenderableItem[] = [
  { id: 'a', kind: 'video', label: 'Welcome', slides: [text('w1')] },
  { id: 'b', kind: 'song', label: 'Holy Forever', slides: [text('v1'), text('v2'), text('c1')] },
  { id: 'c', kind: 'deck', label: 'Sermon', slides: [text('p1'), text('p2')] }
]

describe('resolveNext', () => {
  it('stays inside the item when more slides remain', () => {
    const r = resolveNext(items, 1, 0)
    expect(r.kind).toBe('same-item')
    if (r.kind === 'same-item') {
      expect(r.itemLabel).toBe('Holy Forever')
      expect(r.slideIndex).toBe(1)
    }
  })

  it('crosses into the next item on the last slide', () => {
    const r = resolveNext(items, 1, 2)
    expect(r.kind).toBe('new-item')
    if (r.kind === 'new-item') {
      expect(r.fromItemLabel).toBe('Holy Forever')
      expect(r.itemLabel).toBe('Sermon')
      expect(r.itemIndex).toBe(2)
      expect(r.slideIndex).toBe(0)
    }
  })

  it('crosses out of a single-slide item', () => {
    const r = resolveNext(items, 0, 0)
    expect(r.kind).toBe('new-item')
    if (r.kind === 'new-item') expect(r.itemLabel).toBe('Holy Forever')
  })

  it('reports the end on the last slide of the last item', () => {
    expect(resolveNext(items, 2, 1).kind).toBe('end')
  })

  it('reports the end for an empty item list', () => {
    expect(resolveNext([], 0, 0).kind).toBe('end')
  })

  it('reports the end for an out-of-range index', () => {
    expect(resolveNext(items, 99, 0).kind).toBe('end')
  })
})

// The panel and the state machine must never disagree about what SPACE
// does. This walks every reachable position and asserts they match.
describe('resolveNext agrees with the store traversal', () => {
  /** Mirrors useServiceStore.nextSlide's traversal. */
  function storeNext(
    its: RenderableItem[],
    i: number,
    s: number
  ): { i: number; s: number } | 'end' {
    const item = its[i]
    if (!item) return 'end'
    if (s + 1 < item.slides.length) return { i, s: s + 1 }
    if (i + 1 < its.length) return { i: i + 1, s: 0 }
    return 'end'
  }

  it('matches both landing position and item-boundary classification at every position', () => {
    for (let i = 0; i < items.length; i++) {
      for (let s = 0; s < items[i].slides.length; s++) {
        const store = storeNext(items, i, s)
        const panel = resolveNext(items, i, s)
        if (store === 'end') {
          expect(panel.kind).toBe('end')
        } else {
          // Derive the expected kind from the STORE's own traversal, not
          // from resolveNext — otherwise a bug that got the indices right
          // but the kind wrong (e.g. always 'same-item') would sail
          // through undetected.
          const expectedKind = store.i === i ? 'same-item' : 'new-item'
          expect(panel.kind).toBe(expectedKind)
          if (panel.kind !== 'end') {
            expect({ i: panel.itemIndex, s: panel.slideIndex }).toEqual(store)
          }
          if (panel.kind === 'new-item') {
            expect(panel.fromItemLabel).toBe(items[i].label)
            expect(panel.itemLabel).toBe(items[store.i].label)
          }
        }
      }
    }
  })
})
