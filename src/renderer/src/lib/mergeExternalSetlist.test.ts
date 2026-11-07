import { describe, expect, it } from 'vitest'
import type { SetlistItem } from '@shared/types'
import { mergeExternalSetlist, sameSetlistFields, type SetlistFields } from './mergeExternalSetlist'

const div = (id: string, label = id): SetlistItem => ({ kind: 'section-divider', id, label })
const deck = (id: string): SetlistItem => ({
  kind: 'pptx',
  id,
  pptxPath: `/m/${id}.pptx`,
  slideCount: 10,
  title: 'Sermon'
})

function s(items: SetlistItem[], extra: Partial<SetlistFields> = {}): SetlistFields {
  return { name: 'Sunday', date: '2026-11-08', items, ...extra }
}

const ids = (f: SetlistFields): string[] => f.items.map((i) => i.id)

describe('mergeExternalSetlist', () => {
  it('takes the remote version when there are no local edits', () => {
    const base = s([div('a'), div('b')])
    const remote = s([div('a'), div('b'), deck('x')], { startTime: '09:30' })
    expect(mergeExternalSetlist(base, base, remote)).toEqual(remote)
  })

  it('keeps an unsaved local edit AND the AI-added deck', () => {
    const base = s([div('a'), div('b')])
    const local = s([div('a', 'Worship!'), div('b')], { name: 'Sunday AM' })
    const remote = s([div('a'), div('b'), deck('x')])
    const merged = mergeExternalSetlist(base, local, remote)
    expect(ids(merged)).toEqual(['a', 'b', 'x'])
    expect(merged.items[0]).toEqual(div('a', 'Worship!'))
    expect(merged.name).toBe('Sunday AM')
  })

  it('places a remote insertion after its remote predecessor, even after a local reorder', () => {
    const base = s([div('a'), div('b'), div('c')])
    const local = s([div('c'), div('a'), div('b')])
    // AI inserted x right after a.
    const remote = s([div('a'), deck('x'), div('b'), div('c')])
    expect(ids(mergeExternalSetlist(base, local, remote))).toEqual(['c', 'a', 'x', 'b'])
  })

  it('puts a remote item inserted at the top at the top', () => {
    const base = s([div('a')])
    const local = s([div('a'), div('new-local')])
    const remote = s([deck('x'), div('a')])
    expect(ids(mergeExternalSetlist(base, local, remote))).toEqual(['x', 'a', 'new-local'])
  })

  it('does not resurrect an item the operator deleted locally', () => {
    const base = s([div('a'), div('b')])
    const local = s([div('a')])
    const remote = s([div('a'), div('b'), deck('x')])
    expect(ids(mergeExternalSetlist(base, local, remote))).toEqual(['a', 'x'])
  })

  it('drops items deleted remotely unless edited locally', () => {
    const base = s([div('a'), div('b')])
    expect(ids(mergeExternalSetlist(base, base, s([div('a')])))).toEqual(['a'])
    const edited = s([div('a'), div('b', 'kept')])
    expect(ids(mergeExternalSetlist(base, edited, s([div('a')])))).toEqual(['a', 'b'])
  })

  it('is idempotent', () => {
    const base = s([div('a')])
    const local = s([div('a', 'edit')])
    const remote = s([div('a'), deck('x')])
    const once = mergeExternalSetlist(base, local, remote)
    expect(mergeExternalSetlist(remote, once, remote)).toEqual(once)
  })
})

describe('sameSetlistFields', () => {
  it('treats a missing start time and undefined as equal', () => {
    expect(sameSetlistFields(s([div('a')]), s([div('a')], { startTime: undefined }))).toBe(true)
    expect(sameSetlistFields(s([div('a')]), s([div('b')]))).toBe(false)
    expect(sameSetlistFields(null, null)).toBe(true)
  })
})
