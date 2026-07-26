import { describe, it, expect } from 'vitest'
import { slideifySetlist } from './slideify'
import type { Setlist } from '@shared/types'

function setlistWith(items: Setlist['items']): Setlist {
  return {
    id: 's1',
    name: 'Test',
    date: '2026-07-26',
    items,
    createdAt: '2026-07-26T00:00:00.000Z',
    updatedAt: '2026-07-26T00:00:00.000Z'
  }
}

describe('slideifySetlist with pptx items', () => {
  it('fans a pptx item into one payload per visible slide', () => {
    const result = slideifySetlist(
      setlistWith([
        {
          kind: 'pptx',
          id: 'i1',
          pptxPath: '/decks/announcements.pptx',
          slideCount: 6,
          title: 'announcements'
        }
      ]),
      new Map()
    )

    expect(result).toHaveLength(1)
    expect(result[0].kind).toBe('pptx')
    expect(result[0].label).toBe('announcements')
    expect(result[0].slides).toHaveLength(6)
    expect(result[0].slides.map((s) => s.kind)).toEqual(
      Array(6).fill('pptx-slide')
    )
  })

  it('numbers ordinals 1..N so operator slide numbers match', () => {
    const result = slideifySetlist(
      setlistWith([
        {
          kind: 'pptx',
          id: 'i1',
          pptxPath: '/decks/d.pptx',
          slideCount: 3
        }
      ]),
      new Map()
    )

    const ordinals = result[0].slides.map((s) =>
      s.kind === 'pptx-slide' ? s.slideOrdinal : null
    )
    expect(ordinals).toEqual([1, 2, 3])
  })

  it('falls back to a generic label when title is absent', () => {
    const result = slideifySetlist(
      setlistWith([
        { kind: 'pptx', id: 'i1', pptxPath: '/d.pptx', slideCount: 1 }
      ]),
      new Map()
    )
    expect(result[0].label).toBe('PowerPoint')
  })

  it('drops a deck with no visible slides, matching deck behaviour', () => {
    const result = slideifySetlist(
      setlistWith([
        { kind: 'pptx', id: 'i1', pptxPath: '/d.pptx', slideCount: 0 }
      ]),
      new Map()
    )
    expect(result).toHaveLength(0)
  })

  it('drops a deck with an empty path', () => {
    const result = slideifySetlist(
      setlistWith([{ kind: 'pptx', id: 'i1', pptxPath: '', slideCount: 4 }]),
      new Map()
    )
    expect(result).toHaveLength(0)
  })
})
