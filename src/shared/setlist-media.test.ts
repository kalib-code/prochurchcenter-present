import { describe, expect, it } from 'vitest'
import type { PickFileKind } from './ipc-contract'
import type { SetlistItem } from './types'
import { mediaPathOf, relinkKindOf } from './setlist-media'

type Kind = SetlistItem['kind']

interface CaseFor<K extends Kind> {
  item: Extract<SetlistItem, { kind: K }>
  expectedPath: string | null
  expectedRelinkKind: PickFileKind | null
}

/**
 * One entry per SetlistItem kind, keyed by a mapped type over `Kind`
 * (`SetlistItem['kind']`) rather than a plain object literal.
 *
 * This is the exhaustiveness guard: `{ [K in Kind]: CaseFor<K> }` requires
 * an entry for every key the union declares, and rejects any key that
 * isn't one of them. If a future kind is added to the SetlistItem union in
 * ./types.ts (say, an 8th kind carrying an audioPath), this object literal
 * stops satisfying its own type — `pnpm typecheck` fails right here with
 * "Property '<newKind>' is missing" — before anyone has to notice that
 * mediaPathOf silently returns null for it. A test that just looped over
 * `['song', 'scripture', ...]` as a hand-written array would keep passing
 * forever in that scenario, which is exactly the failure mode this avoids.
 *
 * Verified by temporarily adding a fake 8th kind (e.g.
 * `{ kind: 'audio-clip'; id: string; audioPath: string }`) to the
 * SetlistItem union and running `pnpm typecheck` — it fails on this file
 * with the missing-property error described above. Reverted after
 * confirming the failure; the union here is the real, unmodified one.
 */
const CASES: { [K in Kind]: CaseFor<K> } = {
  song: {
    item: { kind: 'song', id: 'item-1', songId: 'song-1' },
    expectedPath: null,
    expectedRelinkKind: null
  },
  scripture: {
    item: {
      kind: 'scripture',
      id: 'item-2',
      reference: 'John 3:16',
      text: 'For God so loved the world...',
      translation: 'ENGWEBP'
    },
    expectedPath: null,
    expectedRelinkKind: null
  },
  'section-divider': {
    item: { kind: 'section-divider', id: 'item-3', label: 'Worship' },
    expectedPath: null,
    expectedRelinkKind: null
  },
  image: {
    item: { kind: 'image', id: 'item-4', imagePath: '/media/slide.png' },
    expectedPath: '/media/slide.png',
    expectedRelinkKind: 'image'
  },
  countdown: {
    item: {
      kind: 'countdown',
      id: 'item-5',
      label: 'Starting soon',
      targetTime: '2026-07-25T10:00:00.000Z'
    },
    expectedPath: null,
    expectedRelinkKind: null
  },
  video: {
    item: { kind: 'video', id: 'item-6', videoPath: '/media/intro.mp4' },
    expectedPath: '/media/intro.mp4',
    expectedRelinkKind: 'video'
  },
  deck: {
    item: { kind: 'deck', id: 'item-7', pdfPath: '/media/slides.pdf', pageCount: 12 },
    expectedPath: '/media/slides.pdf',
    expectedRelinkKind: 'pdf'
  },
  // Added because the mapped type below refused to compile without it when
  // live PowerPoint projection merged in — which is the whole point of the
  // guard. A pptx carries a real path, so a moved .pptx must surface in
  // pre-flight and offer RELINK exactly like a moved .pdf does.
  pptx: {
    item: { kind: 'pptx', id: 'item-8', pptxPath: '/media/sermon.pptx', slideCount: 9 },
    expectedPath: '/media/sermon.pptx',
    expectedRelinkKind: 'pptx'
  }
}

const ALL_KINDS = Object.keys(CASES) as Kind[]

describe('mediaPathOf', () => {
  it.each(ALL_KINDS)('%s: returns the expected path (or null)', (kind) => {
    const { item, expectedPath } = CASES[kind]
    expect(mediaPathOf(item)).toBe(expectedPath)
  })

  it('covers exactly the eight kinds declared on SetlistItem', () => {
    // Belt-and-suspenders runtime check alongside the compile-time guard
    // above: if CASES and the union ever disagree, at least one of the
    // two enforcement mechanisms catches it.
    //
    // Both fired when live PowerPoint projection merged in — the mapped
    // type refused to compile, and this list refused to match. Keep the
    // literals spelled out rather than derived from the union: deriving
    // them would make this assert nothing.
    expect(ALL_KINDS.sort()).toEqual(
      [
        'countdown',
        'deck',
        'image',
        'pptx',
        'scripture',
        'section-divider',
        'song',
        'video'
      ].sort()
    )
  })

  it('treats an empty imagePath as no path, not an empty string', () => {
    expect(mediaPathOf({ kind: 'image', id: 'i', imagePath: '' })).toBeNull()
  })

  it('treats an empty videoPath as no path, not an empty string', () => {
    expect(mediaPathOf({ kind: 'video', id: 'i', videoPath: '' })).toBeNull()
  })

  it('treats an empty pdfPath as no path, not an empty string', () => {
    expect(mediaPathOf({ kind: 'deck', id: 'i', pdfPath: '', pageCount: 0 })).toBeNull()
  })
})

describe('relinkKindOf', () => {
  it.each(ALL_KINDS)('%s: returns the expected PickFileKind (or null)', (kind) => {
    const { item, expectedRelinkKind } = CASES[kind]
    expect(relinkKindOf(item)).toBe(expectedRelinkKind)
  })
})
