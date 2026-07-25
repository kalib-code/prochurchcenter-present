# Live PowerPoint Projection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an operator add a `.pptx` file to a setlist and project its slides live, with no manual PDF export step.

**Architecture:** Add one `SetlistItem` kind (`pptx`) and one `SlidePayload` kind (`pptx-slide`), mirroring the existing `deck` / `pdf-page` pair field for field. Slide arithmetic lives in a pure `src/shared/` module so it tests under node; `@aiden0z/pptx-renderer` is loaded lazily in the renderer and renders one slide at a time into the projector. Nothing downstream of the slide payload changes.

**Tech Stack:** Electron 34, electron-vite, React 18, TypeScript, Zustand, Vitest, `@aiden0z/pptx-renderer` 1.2.4, `jsdom` (test only).

**Spec:** [docs/superpowers/specs/2026-07-26-pptx-live-projection-design.md](../specs/2026-07-26-pptx-live-projection-design.md)

## Global Constraints

- **Accept `.pptx` only.** No `.ppt`, `.key`, or `.odp` — the renderer parses Office Open XML only. The file picker must not appear to accept a format that will fail to parse.
- **Hidden slides are excluded everywhere.** `slide.hidden === true` means PowerPoint would skip it when presenting, so we skip it too. Operator slide numbers must match the projected slide.
- **`slideCount` is the count of VISIBLE slides,** cached at add-time, mirroring `deck.pageCount`, because `slideify` fans out synchronously.
- **Never let the projector flash white.** Failure paths hold the previous slide.
- **Test environment: `jsdom`, never `happy-dom`.** happy-dom's `DOMParser` returns an empty presentation without throwing, so tests pass while asserting nothing.
- **Import the renderer's default entry,** `'@aiden0z/pptx-renderer'` — not `'@aiden0z/pptx-renderer/browser'`, which is for bundler-free use.
- Follow existing file conventions: header comment explaining *why*, not *what*; `import type` for type-only imports; `@shared/*` alias for cross-boundary imports.
- Run `pnpm typecheck` before every commit. It covers node, preload, and web configs separately.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/shared/pptxSlides.ts` | **Create.** Pure slide arithmetic over plain metadata. No DOM, no fs. |
| `src/shared/pptxSlides.test.ts` | **Create.** Node-environment tests for the arithmetic. |
| `src/shared/types.ts` | **Modify.** Add `pptx` item kind. |
| `src/shared/ipc-contract.ts` | **Modify.** Add `pptx-slide` payload, `'pptx'` to `PickFileKind`. |
| `src/main/ipc/dialog.ts` | **Modify.** `pptx` filter + dialog title. |
| `src/renderer/src/lib/pptxLoader.ts` | **Create.** Lazy library load, byte fetch, promise cache, metadata mapping. |
| `src/renderer/src/lib/pptxLoader.test.ts` | **Create.** jsdom fixture parse + node cache behaviour. |
| `src/renderer/src/lib/slideify.ts` | **Modify.** Fan `pptx` into payloads. |
| `src/renderer/src/lib/slideify.test.ts` | **Create.** Fan-out and drop cases. |
| `src/renderer/src/components/PptxSlideView.tsx` | **Create.** Renders one slide; holds previous on failure. |
| `src/renderer/src/components/SlideRenderer.tsx` | **Modify.** New branch + two list memberships. |
| `src/renderer/src/pages/SetlistEditor.tsx` | **Modify.** `addPptx` handler. |
| `src/renderer/src/components/AddItemPicker.tsx` | **Modify.** New kind card. |
| `src/renderer/src/components/ItemKindIcon.tsx` | **Modify.** Icon + label. |
| `src/renderer/src/components/SetlistItemCard.tsx` | **Modify.** Thumbnail source. |
| `src/renderer/src/pages/ServiceMode.tsx` | **Modify.** Preview source + warm-on-entry. |
| `vitest.config.ts` | **Modify.** Widen `include` to renderer tests. |
| `package.json` | **Modify.** Add renderer dep + `jsdom` devDep. |

Task order follows the dependency chain: pure math first (no dependencies), then the loader, then the data model and fan-out, then UI, then service-time behaviour.

---

### Task 1: Pure slide arithmetic

The only logic with real edge cases. Isolated in `src/shared/` so it runs in the existing node test environment with no DOM and no library.

**Files:**
- Create: `src/shared/pptxSlides.ts`
- Test: `src/shared/pptxSlides.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `PptxSlideMeta`, `visibleSlideCount(slides: PptxSlideMeta[]): number`, `ordinalToSourceIndex(slides: PptxSlideMeta[], ordinal: number): number | null`.

- [ ] **Step 1: Write the failing test**

Create `src/shared/pptxSlides.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  visibleSlideCount,
  ordinalToSourceIndex,
  type PptxSlideMeta
} from './pptxSlides'

/** Mirrors test-deck.pptx: 5 slides, none hidden. */
const PLAIN: PptxSlideMeta[] = [1, 2, 3, 4, 5].map((sourceIndex) => ({
  sourceIndex,
  hidden: false
}))

/**
 * Mirrors test-deck-hidden.pptx: 7 parts, the 6th hidden. The hidden slide
 * sits in the MIDDLE on purpose — every slide after it shifts, so an
 * off-by-one implementation fails loudly instead of only breaking the last.
 */
const WITH_HIDDEN: PptxSlideMeta[] = [1, 2, 3, 4, 5, 6, 7].map((sourceIndex) => ({
  sourceIndex,
  hidden: sourceIndex === 6
}))

describe('visibleSlideCount', () => {
  it('counts every slide when none are hidden', () => {
    expect(visibleSlideCount(PLAIN)).toBe(5)
  })

  it('excludes hidden slides', () => {
    expect(visibleSlideCount(WITH_HIDDEN)).toBe(6)
  })

  it('returns 0 for an empty deck', () => {
    expect(visibleSlideCount([])).toBe(0)
  })

  it('returns 0 when every slide is hidden', () => {
    expect(visibleSlideCount([{ sourceIndex: 1, hidden: true }])).toBe(0)
  })
})

describe('ordinalToSourceIndex', () => {
  it('maps ordinals straight through when nothing is hidden', () => {
    expect(ordinalToSourceIndex(PLAIN, 1)).toBe(1)
    expect(ordinalToSourceIndex(PLAIN, 5)).toBe(5)
  })

  it('skips the hidden slide', () => {
    expect(ordinalToSourceIndex(WITH_HIDDEN, 5)).toBe(5)
    // ordinal 6 is the slide AFTER the hidden one — source index 7, not 6
    expect(ordinalToSourceIndex(WITH_HIDDEN, 6)).toBe(7)
  })

  it('returns null for ordinals outside the visible range', () => {
    expect(ordinalToSourceIndex(WITH_HIDDEN, 0)).toBeNull()
    expect(ordinalToSourceIndex(WITH_HIDDEN, 7)).toBeNull()
    expect(ordinalToSourceIndex(WITH_HIDDEN, -1)).toBeNull()
  })

  it('returns null for a non-integer ordinal', () => {
    expect(ordinalToSourceIndex(PLAIN, 1.5)).toBeNull()
  })

  it('returns null for an empty deck', () => {
    expect(ordinalToSourceIndex([], 1)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run src/shared/pptxSlides.test.ts
```

Expected: FAIL — `Failed to resolve import "./pptxSlides"`.

- [ ] **Step 3: Write minimal implementation**

Create `src/shared/pptxSlides.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm vitest run src/shared/pptxSlides.test.ts
```

Expected: PASS, 10 tests.

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm typecheck
git add src/shared/pptxSlides.ts src/shared/pptxSlides.test.ts
git commit -m "feat: pure slide arithmetic for pptx decks

Hidden slides shift every ordinal after them, so ordinal-to-source-index
mapping gets its own module with node-environment tests rather than living
inside the DOM-dependent loader."
```

---

### Task 2: Data model and IPC contract

Type-only change. The `never` exhaustiveness check in `slideify` will now fail to compile, which is intended — Task 4 fixes it. Commit this task with `slideify` temporarily handling `pptx` by returning `null`, so the tree always compiles.

**Files:**
- Modify: `src/shared/types.ts` (after the `deck` variant, ~line 124)
- Modify: `src/shared/ipc-contract.ts:231` (`PickFileKind`) and the `SlidePayload` union
- Modify: `src/renderer/src/lib/slideify.ts:269` (temporary stub)

**Interfaces:**
- Consumes: nothing.
- Produces: `SetlistItem` variant `{ kind: 'pptx'; id: string; pptxPath: string; slideCount: number; title?: string }`; `SlidePayload` variant `{ kind: 'pptx-slide'; pptxPath: string; slideOrdinal: number; slideCount: number }`; `PickFileKind` gains `'pptx'`.

- [ ] **Step 1: Add the SetlistItem variant**

In `src/shared/types.ts`, immediately after the `deck` variant, add:

```ts
  /**
   * PowerPoint deck rendered live — no PDF export step. The operator picks a
   * .pptx and we render each slide in the projector via @aiden0z/pptx-renderer.
   *
   * slideCount counts VISIBLE slides only (PowerPoint skips slides marked
   * hidden when presenting, so we do too). It is cached at add-time for the
   * same reason deck.pageCount is: slideify expands items synchronously.
   *
   * Only .pptx is supported — the renderer parses Office Open XML, so legacy
   * binary .ppt, .key, and .odp are not accepted by the file picker.
   */
  | {
      kind: 'pptx'
      id: string
      pptxPath: string
      slideCount: number
      /** Optional display name shown in the operator upcoming list */
      title?: string
    }
```

- [ ] **Step 2: Add the SlidePayload variant and PickFileKind value**

In `src/shared/ipc-contract.ts`, find the `SlidePayload` union (it contains `{ kind: 'pdf-page'; ... }`) and add alongside it:

```ts
  /**
   * One slide of a live-rendered PowerPoint deck.
   *
   * slideOrdinal is 1-based over VISIBLE slides — see @shared/pptxSlides for
   * why that differs from the slide's position in the file.
   */
  | {
      kind: 'pptx-slide'
      pptxPath: string
      slideOrdinal: number
      slideCount: number
    }
```

Then change line 231:

```ts
export type PickFileKind = 'image' | 'video' | 'media' | 'pdf' | 'pptx' | 'font'
```

- [ ] **Step 3: Stub the slideify branch so the tree compiles**

In `src/renderer/src/lib/slideify.ts`, immediately before the `const _never: never = item` line, add:

```ts
  // Filled in by the fan-out task. Returning null keeps the exhaustiveness
  // check satisfied and the tree compiling in the meantime.
  if (item.kind === 'pptx') return null
```

- [ ] **Step 4: Verify the tree compiles**

```bash
pnpm typecheck
```

Expected: PASS. If it reports a non-exhaustive switch anywhere, add a `pptx` case there — search for `item.kind ===` and `case 'deck'` to find every site.

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts src/shared/ipc-contract.ts src/renderer/src/lib/slideify.ts
git commit -m "feat: pptx item kind and pptx-slide payload

Types only. slideify stubs the branch to keep the tree compiling until the
fan-out lands."
```

---

### Task 3: Test environment for renderer tests

`vitest.config.ts` currently matches only `src/shared/**/*.test.ts` under `environment: 'node'`. The loader tests need both a wider glob and, for the one file that parses a real deck, a DOM.

Measured: node alone throws `DOMParser is not defined`; `@xmldom/xmldom` throws `e.querySelector is not a function`; `happy-dom` returns **0 slides without throwing**; `jsdom` parses correctly. Use `jsdom`.

**Files:**
- Modify: `vitest.config.ts`
- Modify: `package.json` (devDependencies)

**Interfaces:**
- Consumes: nothing.
- Produces: renderer `*.test.ts` files are collected; per-file `// @vitest-environment jsdom` works.

- [ ] **Step 1: Install jsdom and the renderer library**

```bash
pnpm add @aiden0z/pptx-renderer
pnpm add -D jsdom
```

`@aiden0z/pptx-renderer` pulls `echarts ^6.0.0` and `jszip ^3.10.1`. Its optional peer `pdfjs-dist >=5 <7` is already satisfied by this app's `^5.6.205` — do not add it again.

- [ ] **Step 2: Widen the test glob**

Replace the `test` block in `vitest.config.ts`:

```ts
  test: {
    include: ['src/shared/**/*.test.ts', 'src/renderer/**/*.test.ts'],
    // Default stays node — it is faster and catches accidental DOM
    // dependencies in shared code. The one test that parses a real .pptx
    // opts into jsdom with a `// @vitest-environment jsdom` docblock.
    //
    // Do NOT switch that file to happy-dom: its DOMParser rejects the OOXML
    // declaration and returns an empty presentation WITHOUT throwing, so the
    // test passes while asserting nothing.
    environment: 'node'
  },
```

- [ ] **Step 3: Verify existing tests still run**

```bash
pnpm test
```

Expected: PASS — the existing `src/shared/parser.test.ts`, `src/shared/bibleReference.test.ts`, and `src/shared/pptxSlides.test.ts` all collected and green.

- [ ] **Step 4: Commit**

```bash
git add vitest.config.ts package.json pnpm-lock.yaml
git commit -m "test: collect renderer tests, add jsdom

happy-dom silently returns an empty presentation for OOXML, so jsdom is the
only viable DOM for parsing .pptx in tests."
```

---

### Task 4: pptxLoader

Mirrors [pdfLoader.ts](../../../src/renderer/src/lib/pdfLoader.ts) — same promise-caching contract, same eviction-on-rejection, same `present-media://` byte fetch. Read that file first; this one should look like its sibling.

**Files:**
- Create: `src/renderer/src/lib/pptxLoader.ts`
- Test: `src/renderer/src/lib/pptxLoader.test.ts`

**Interfaces:**
- Consumes: `PptxSlideMeta`, `visibleSlideCount` from Task 1.
- Produces: `PptxDeck` (`{ slides: PptxSlideMeta[]; width: number; height: number; presentation: unknown }`), `loadPptxDeck(absPath: string): Promise<PptxDeck>`, `probeVisibleSlideCount(absPath: string): Promise<number>`, `evictPptxDeck(absPath: string): void`, `parsePptxBuffer(buf: ArrayBuffer): Promise<PptxDeck>`.

- [ ] **Step 1: Write the failing test**

Create `src/renderer/src/lib/pptxLoader.test.ts`:

```ts
// @vitest-environment jsdom
//
// jsdom, not happy-dom: happy-dom's DOMParser rejects the OOXML declaration
// and returns an empty presentation without throwing, so every assertion
// below would pass against nothing.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parsePptxBuffer } from './pptxLoader'

function fixture(name: string): ArrayBuffer {
  const buf = readFileSync(
    resolve(__dirname, '../../../shared/__fixtures__', name)
  )
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

describe('parsePptxBuffer', () => {
  it('reads 5 visible slides from test-deck.pptx', async () => {
    const deck = await parsePptxBuffer(fixture('test-deck.pptx'))
    expect(deck.slides).toHaveLength(5)
    expect(deck.slides.every((s) => !s.hidden)).toBe(true)
    expect(deck.slides.map((s) => s.sourceIndex)).toEqual([1, 2, 3, 4, 5])
  })

  it('reports 16:9 dimensions', async () => {
    const deck = await parsePptxBuffer(fixture('test-deck.pptx'))
    expect(Math.round(deck.width)).toBe(1280)
    expect(Math.round(deck.height)).toBe(720)
  })

  it('flags only the hidden slide in test-deck-hidden.pptx', async () => {
    const deck = await parsePptxBuffer(fixture('test-deck-hidden.pptx'))
    expect(deck.slides).toHaveLength(7)
    expect(deck.slides.map((s) => s.hidden)).toEqual([
      false, false, false, false, false, true, false
    ])
  })

  it('rejects a file that is not a pptx', async () => {
    await expect(
      parsePptxBuffer(new TextEncoder().encode('not a zip').buffer)
    ).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run src/renderer/src/lib/pptxLoader.test.ts
```

Expected: FAIL — `Failed to resolve import "./pptxLoader"`.

- [ ] **Step 3: Write the implementation**

Create `src/renderer/src/lib/pptxLoader.ts`:

```ts
/**
 * Shared @aiden0z/pptx-renderer loader + presentation cache.
 *
 * Deliberately parallel to pdfLoader.ts — same promise-caching contract, same
 * eviction-on-rejection, same present-media:// byte fetch. If you change one,
 * consider whether the other needs the same change.
 *
 * Why the library is imported dynamically:
 *   The package pulls in ECharts and JSZip. A church that never projects a
 *   PowerPoint should not pay that download in the projector window, so the
 *   chunk loads on first use rather than at module evaluation.
 *
 * Why the DEFAULT entry and not '/browser':
 *   The '/browser' build exists for bundler-free <script type="module"> use and
 *   inlines its dependencies. Under Vite we want the normal entry so Vite
 *   resolves and dedupes ECharts and JSZip itself.
 *
 * Why lazy media + lazy slides:
 *   parseZipLazyMedia and { lazySlides: true } defer image decompression and
 *   slide node parsing until a slide is actually rendered. A 100-slide deck
 *   with photos on every slide would otherwise decompress all of them to
 *   answer "how many slides is this".
 */

import type { PptxSlideMeta } from '@shared/pptxSlides'
import { visibleSlideCount } from '@shared/pptxSlides'

export interface PptxDeck {
  /** Every slide part in the file, in file order, with its hidden flag. */
  slides: PptxSlideMeta[]
  /** Slide width in points, e.g. 1280 for a 16:9 deck. */
  width: number
  /** Slide height in points, e.g. 720 for a 16:9 deck. */
  height: number
  /**
   * The library's own presentation object, passed straight back to
   * renderSlide. Typed as unknown so this module stays the only place that
   * knows the library's shape.
   */
  presentation: unknown
}

type RendererModule = typeof import('@aiden0z/pptx-renderer')

let modulePromise: Promise<RendererModule> | null = null

function loadRenderer(): Promise<RendererModule> {
  modulePromise ??= import('@aiden0z/pptx-renderer')
  return modulePromise
}

/**
 * Parse raw .pptx bytes into a PptxDeck. Exported separately from
 * loadPptxDeck so tests can feed fixture bytes without a present-media://
 * protocol handler.
 */
export async function parsePptxBuffer(buf: ArrayBuffer): Promise<PptxDeck> {
  const { parseZipLazyMedia, buildPresentation, RECOMMENDED_ZIP_LIMITS } =
    await loadRenderer()

  const files = await parseZipLazyMedia(buf, RECOMMENDED_ZIP_LIMITS)
  const presentation = buildPresentation(files, { lazySlides: true })

  const slides: PptxSlideMeta[] = presentation.slides.map((slide, i) => ({
    sourceIndex: i + 1,
    hidden: slide.hidden === true
  }))

  if (slides.length === 0) {
    throw new Error('No slides found — is this a valid .pptx file?')
  }

  return {
    slides,
    width: presentation.width,
    height: presentation.height,
    presentation
  }
}

function mediaUrl(absPath: string): string {
  return `present-media://local${encodeURI(absPath)}`
}

// Module-level cache of parse promises keyed by absolute path. We store the
// PROMISE (not the resolved deck) so concurrent callers share one parse.
const deckCache = new Map<string, Promise<PptxDeck>>()

/**
 * Load (or return cached) PptxDeck for the given absolute file path.
 * Callers must NOT mutate the returned deck — the cache owns it.
 */
export function loadPptxDeck(absPath: string): Promise<PptxDeck> {
  const cached = deckCache.get(absPath)
  if (cached) return cached

  const promise = (async () => {
    const res = await fetch(mediaUrl(absPath))
    if (!res.ok) throw new Error(`Could not read ${absPath} (${res.status})`)
    return parsePptxBuffer(await res.arrayBuffer())
  })().catch((err) => {
    // Evict on failure so a retry re-attempts instead of returning the same
    // rejected promise forever.
    deckCache.delete(absPath)
    throw err
  })

  deckCache.set(absPath, promise)
  return promise
}

/**
 * Open a deck just long enough to count its visible slides. Used by the
 * SetlistEditor add flow to stamp slideCount onto the SetlistItem so slideify
 * can expand synchronously.
 */
export async function probeVisibleSlideCount(absPath: string): Promise<number> {
  const deck = await loadPptxDeck(absPath)
  return visibleSlideCount(deck.slides)
}

/** Drop a path from the cache (e.g., when its item is deleted). */
export function evictPptxDeck(absPath: string): void {
  deckCache.delete(absPath)
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm vitest run src/renderer/src/lib/pptxLoader.test.ts
```

Expected: PASS, 4 tests. If `presentation.slides` is undefined, the library's shape changed — re-check against `node_modules/@aiden0z/pptx-renderer/dist/types/index.d.ts` before adjusting.

- [ ] **Step 5: Add cache-behaviour tests**

Append to `src/renderer/src/lib/pptxLoader.test.ts`:

```ts
describe('loadPptxDeck caching', () => {
  it('shares one promise across concurrent callers', async () => {
    let fetches = 0
    const original = globalThis.fetch
    globalThis.fetch = (async () => {
      fetches++
      const buf = fixture('test-deck.pptx')
      return new Response(buf, { status: 200 })
    }) as typeof fetch

    try {
      const { loadPptxDeck, evictPptxDeck } = await import('./pptxLoader')
      evictPptxDeck('/tmp/concurrent.pptx')
      const [a, b] = await Promise.all([
        loadPptxDeck('/tmp/concurrent.pptx'),
        loadPptxDeck('/tmp/concurrent.pptx')
      ])
      expect(a).toBe(b)
      expect(fetches).toBe(1)
    } finally {
      globalThis.fetch = original
    }
  })

  it('evicts a rejected parse so a retry re-attempts', async () => {
    let fetches = 0
    const original = globalThis.fetch
    globalThis.fetch = (async () => {
      fetches++
      return new Response(null, { status: 404 })
    }) as typeof fetch

    try {
      const { loadPptxDeck } = await import('./pptxLoader')
      await expect(loadPptxDeck('/tmp/missing.pptx')).rejects.toThrow()
      await expect(loadPptxDeck('/tmp/missing.pptx')).rejects.toThrow()
      expect(fetches).toBe(2)
    } finally {
      globalThis.fetch = original
    }
  })
})
```

- [ ] **Step 6: Run the full file**

```bash
pnpm vitest run src/renderer/src/lib/pptxLoader.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 7: Typecheck and commit**

```bash
pnpm typecheck
git add src/renderer/src/lib/pptxLoader.ts src/renderer/src/lib/pptxLoader.test.ts
git commit -m "feat: pptxLoader with presentation cache

Mirrors pdfLoader's promise-caching contract. Library loads lazily so
churches that never project PowerPoint do not pay for ECharts and JSZip."
```

---

### Task 5: slideify fan-out

Replace the Task 2 stub with the real fan-out, beside the `deck` branch.

**Files:**
- Modify: `src/renderer/src/lib/slideify.ts` (replace the `if (item.kind === 'pptx') return null` stub)
- Test: `src/renderer/src/lib/slideify.test.ts`

**Interfaces:**
- Consumes: `SetlistItem` `pptx` variant and `SlidePayload` `pptx-slide` variant from Task 2.
- Produces: `slideifySetlist` emits a `RenderableItem` with `kind: 'pptx'` and `slideCount` payloads.

- [ ] **Step 1: Write the failing test**

Create `src/renderer/src/lib/slideify.test.ts`:

```ts
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
      []
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
      []
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
      []
    )
    expect(result[0].label).toBe('PowerPoint')
  })

  it('drops a deck with no visible slides, matching deck behaviour', () => {
    const result = slideifySetlist(
      setlistWith([
        { kind: 'pptx', id: 'i1', pptxPath: '/d.pptx', slideCount: 0 }
      ]),
      []
    )
    expect(result).toHaveLength(0)
  })

  it('drops a deck with an empty path', () => {
    const result = slideifySetlist(
      setlistWith([{ kind: 'pptx', id: 'i1', pptxPath: '', slideCount: 4 }]),
      []
    )
    expect(result).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run src/renderer/src/lib/slideify.test.ts
```

Expected: FAIL — first test gets `[]` because the stub returns `null`.

- [ ] **Step 3: Replace the stub**

In `src/renderer/src/lib/slideify.ts`, replace `if (item.kind === 'pptx') return null` with:

```ts
  if (item.kind === 'pptx') {
    // Expand into N pptx-slide payloads, one per VISIBLE slide. slideCount was
    // recorded at add-time (via probeVisibleSlideCount) so this stays a pure
    // synchronous fan-out, exactly like the deck branch above. A deck with 0
    // slides (unreadable / all-hidden) is dropped rather than shown broken.
    if (!item.pptxPath || item.slideCount <= 0) return null
    const slides: SlidePayload[] = []
    for (let i = 1; i <= item.slideCount; i++) {
      slides.push({
        kind: 'pptx-slide',
        pptxPath: item.pptxPath,
        slideOrdinal: i,
        slideCount: item.slideCount
      })
    }
    return {
      id: item.id,
      kind: 'pptx',
      label: item.title?.trim() || 'PowerPoint',
      slides
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm vitest run src/renderer/src/lib/slideify.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm typecheck
git add src/renderer/src/lib/slideify.ts src/renderer/src/lib/slideify.test.ts
git commit -m "feat: fan pptx items into per-slide payloads"
```

---

### Task 6: PptxSlideView

Renders exactly one slide. On failure it renders nothing, which leaves the previously painted slide on screen — the spec's chosen failure behaviour.

**Files:**
- Create: `src/renderer/src/components/PptxSlideView.tsx`

**Interfaces:**
- Consumes: `loadPptxDeck` from Task 4, `ordinalToSourceIndex` from Task 1.
- Produces: default-exported `PptxSlideView` taking `{ pptxPath: string; slideOrdinal: number; animate: boolean; transitionDurationMs: number; useFade: boolean; onError?: (message: string) => void }`.

- [ ] **Step 1: Read the component being mirrored**

Read `PdfPageView` inside `src/renderer/src/components/SlideRenderer.tsx` and match its prop names, its fade/transition handling, and its sizing approach. `PptxSlideView` should be recognisably its sibling.

- [ ] **Step 2: Write the component**

Create `src/renderer/src/components/PptxSlideView.tsx`:

```tsx
/**
 * Renders one slide of a live PowerPoint deck into the projector.
 *
 * Why we render into a detached container and then swap it in:
 *   The library writes DOM imperatively. Letting it write directly into a
 *   React-managed node fights reconciliation. We give it a container we own,
 *   then attach that container once it is fully populated — so the projector
 *   never shows a half-drawn slide.
 *
 * Why a failure renders nothing:
 *   Leaving the DOM untouched leaves the PREVIOUS slide on screen. The
 *   congregation sees no glitch; the operator gets the message via onError and
 *   decides whether to skip. Going black would be unambiguous but costs a
 *   visible dead beat in the middle of a service. See the failure-handling
 *   section of the design spec.
 */

import { useEffect, useRef, useState } from 'react'
import { ordinalToSourceIndex } from '@shared/pptxSlides'
import { loadPptxDeck } from '../lib/pptxLoader'

interface Props {
  pptxPath: string
  /** 1-based over visible slides. */
  slideOrdinal: number
  animate: boolean
  transitionDurationMs: number
  useFade: boolean
  /** Called with a human-readable reason when this slide cannot render. */
  onError?: (message: string) => void
}

export default function PptxSlideView({
  pptxPath,
  slideOrdinal,
  animate,
  transitionDurationMs,
  useFade,
  onError
}: Props): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [visible, setVisible] = useState(!animate)

  useEffect(() => {
    let cancelled = false
    setVisible(!animate)

    void (async () => {
      try {
        const deck = await loadPptxDeck(pptxPath)
        if (cancelled) return

        const sourceIndex = ordinalToSourceIndex(deck.slides, slideOrdinal)
        if (sourceIndex === null) {
          throw new Error(
            `Slide ${slideOrdinal} is missing — the file may have been replaced with a shorter one.`
          )
        }

        const { renderSlide } = await import('@aiden0z/pptx-renderer')
        if (cancelled) return

        // Populate a detached container, then swap it in atomically.
        const staged = document.createElement('div')
        staged.style.width = `${deck.width}px`
        staged.style.height = `${deck.height}px`
        await renderSlide(
          deck.presentation as Parameters<typeof renderSlide>[0],
          sourceIndex - 1,
          staged
        )
        if (cancelled) return

        const host = hostRef.current
        if (!host) return
        host.replaceChildren(staged)
        setVisible(true)
      } catch (err) {
        if (cancelled) return
        const message =
          err instanceof Error ? err.message : 'Could not render this slide.'
        console.error('[PptxSlideView]', pptxPath, slideOrdinal, err)
        // Deliberately leave the DOM alone — the previous slide stays up.
        onError?.(message)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [pptxPath, slideOrdinal, animate, onError])

  return (
    <div
      ref={hostRef}
      className="flex h-full w-full items-center justify-center"
      style={{
        opacity: visible ? 1 : 0,
        transition: useFade ? `opacity ${transitionDurationMs}ms ease` : 'none'
      }}
    />
  )
}
```

- [ ] **Step 3: Verify it compiles**

```bash
pnpm typecheck
```

Expected: PASS. If `renderSlide`'s signature differs, check `node_modules/@aiden0z/pptx-renderer/dist/types/index.d.ts` and adjust the call — the argument order is `(presentation, zeroBasedIndex, container)`.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/PptxSlideView.tsx
git commit -m "feat: PptxSlideView renders one live pptx slide

A render failure leaves the DOM untouched so the previous slide stays on
screen; the operator is notified via onError."
```

---

### Task 7: Wire into SlideRenderer

Three edits, all mirroring how `pdf-page` is already handled.

**Files:**
- Modify: `src/renderer/src/components/SlideRenderer.tsx` at lines 144, 243, 294

**Interfaces:**
- Consumes: `PptxSlideView` from Task 6, `pptx-slide` payload from Task 2.
- Produces: the projector renders `pptx-slide` payloads full-bleed on black.

- [ ] **Step 1: Add to the full-bleed media test (line 144)**

```ts
    showLive &&
    (payload.kind === 'pdf-page' ||
      payload.kind === 'pptx-slide' ||
      payload.kind === 'video')
```

This makes the background paint black rather than the theme colour, which matters because a 4:3 deck on a 16:9 projector will letterbox.

- [ ] **Step 2: Add the render branch (after the `pdf-page` block ending ~line 253)**

```tsx
      {!isBlackout && showLive && payload.kind === 'pptx-slide' && (
        <div className="absolute inset-0 flex items-center justify-center">
          <PptxSlideView
            pptxPath={payload.pptxPath}
            slideOrdinal={payload.slideOrdinal}
            animate={animate}
            transitionDurationMs={t.transitionDurationMs}
            useFade={t.transition === 'fade'}
          />
        </div>
      )}
```

Add the import at the top: `import PptxSlideView from './PptxSlideView'`.

- [ ] **Step 3: Exclude from auto-fit (line 294)**

```ts
        payload.kind !== 'pdf-page' &&
        payload.kind !== 'pptx-slide' &&
        payload.kind !== 'image' &&
        payload.kind !== 'video' && (
```

Auto-fit scales text slides to fill the screen. A pptx slide is already laid out, so running it through auto-fit would double-scale it.

- [ ] **Step 4: Typecheck and commit**

```bash
pnpm typecheck
git add src/renderer/src/components/SlideRenderer.tsx
git commit -m "feat: render pptx-slide payloads in the projector"
```

---

### Task 8: Add-time flow

**Files:**
- Modify: `src/main/ipc/dialog.ts:21` and its `dialogTitle` switch
- Modify: `src/renderer/src/pages/SetlistEditor.tsx` (after `addDeck`, ~line 228)
- Modify: `src/renderer/src/components/AddItemPicker.tsx:66,77,144`
- Modify: `src/renderer/src/components/ItemKindIcon.tsx:73,120`

**Interfaces:**
- Consumes: `probeVisibleSlideCount` from Task 4, `'pptx'` `PickFileKind` from Task 2.
- Produces: `AddItemPicker` gains an `onAddPptx` prop; `SetlistEditor` passes `addPptx`.

- [ ] **Step 1: Add the dialog filter**

In `src/main/ipc/dialog.ts`, add to `FILTERS`:

```ts
  pptx: [{ name: 'PowerPoint files', extensions: ['pptx'] }],
```

Only `pptx`. Legacy `.ppt` is binary, not Office Open XML, and the renderer cannot parse it — offering it would accept a file that then fails.

Add to `dialogTitle`:

```ts
    case 'pptx':
      return 'Choose a PowerPoint file'
```

- [ ] **Step 2: Add the SetlistEditor handler**

After `addDeck` in `src/renderer/src/pages/SetlistEditor.tsx`:

```ts
  const addPptx = async (): Promise<void> => {
    const picked = await window.api.dialog.pickFile('pptx')
    if (!picked) {
      closePicker()
      return
    }
    try {
      const slideCount = await probeVisibleSlideCount(picked)
      const title =
        picked.split(/[/\\]/).pop()?.replace(/\.pptx$/i, '') ?? 'PowerPoint'
      insertItem({
        kind: 'pptx',
        id: genItemId(),
        pptxPath: picked,
        slideCount,
        title
      })
    } catch (err) {
      console.error('[SetlistEditor] failed to open pptx', picked, err)
      window.alert(
        'Could not open that PowerPoint file. Make sure it is a .pptx (not an older .ppt), or export it to PDF from PowerPoint (File → Export → Create PDF/XPS) and add it as a PDF deck instead.'
      )
      closePicker()
    }
  }
```

Add the import: `import { probeVisibleSlideCount } from '../lib/pptxLoader'`.

Note the error copy names the PDF escape hatch. That path already works, so a deck this renderer cannot handle is never a dead end.

- [ ] **Step 3: Add the picker card**

In `src/renderer/src/components/AddItemPicker.tsx`, add `'pptx'` to the `KindCardSpec` kind union, add to `KIND_CARDS` after the `deck` entry:

```ts
  { kind: 'pptx', hint: 'Import PowerPoint' },
```

Change the `deck` hint to `'Import a PDF'` → keep as is; the two now read as a pair. Add the dispatch case:

```ts
      case 'pptx':
        onAddPptx()
        return
```

Add `onAddPptx: () => void` to the component's props interface, and pass `onAddPptx={addPptx}` from `SetlistEditor`.

- [ ] **Step 4: Add the icon and label**

In `src/renderer/src/components/ItemKindIcon.tsx`, add a `case 'pptx':` to both switches (line ~73 for the icon, ~120 for the label). Reuse the `deck` icon; label it `'PowerPoint'`.

- [ ] **Step 5: Verify by hand**

```bash
pnpm dev
```

Create a setlist, click Add → PowerPoint, choose `src/shared/__fixtures__/test-deck-hidden.pptx`. Confirm the item appears with **6** slides, not 7. Then start Service Mode and advance through all six, confirming slide 6 shows "Closing — Go in peace" and the hidden draft slide never appears.

- [ ] **Step 6: Typecheck and commit**

```bash
pnpm typecheck && pnpm test
git add src/main/ipc/dialog.ts src/renderer/src/pages/SetlistEditor.tsx src/renderer/src/components/AddItemPicker.tsx src/renderer/src/components/ItemKindIcon.tsx
git commit -m "feat: add PowerPoint files to a setlist

Picker accepts .pptx only; the failure path points at the PDF export route,
which already works."
```

---

### Task 9: Operator previews and warm-on-entry

**Files:**
- Modify: `src/renderer/src/components/SetlistItemCard.tsx:143,150,280`
- Modify: `src/renderer/src/pages/ServiceMode.tsx:188,497`
- Modify: `src/renderer/src/components/MediaPreview.tsx:44,64`
- Modify: `src/renderer/src/components/SlideCard.tsx:60`

**Interfaces:**
- Consumes: `loadPptxDeck` from Task 4, `pptx-slide` payload from Task 2.
- Produces: operator-side thumbnails for pptx slides; decks parsed before the service starts.

- [ ] **Step 1: Extend the preview source unions**

In `MediaPreview.tsx`, `SlideCard.tsx`, `SetlistItemCard.tsx`, and `ServiceMode.tsx`, add a `pptx` variant alongside each existing `{ kind: 'deck'; pdfPath: string; pageIndex: number }` union member:

```ts
  | { kind: 'pptx'; pptxPath: string; slideOrdinal: number }
```

Render it with `PptxSlideView` scaled into the thumbnail box, mirroring how the `deck` variant renders a PDF page.

- [ ] **Step 2: Populate the preview in ServiceMode**

In the payload-to-preview mapping (~line 497), beside the `pdf-page` case:

```ts
        } else if (slide.kind === 'pptx-slide') {
          out.push({
            itemIndex: itemIdx,
            slideIndex: slideIdx,
            sectionLabel: item.label,
            shortcut: `${slide.slideOrdinal}`,
            lines: [],
            preview: {
              kind: 'pptx',
              pptxPath: slide.pptxPath,
              slideOrdinal: slide.slideOrdinal
            }
          })
```

- [ ] **Step 3: Warm every deck on Service Mode entry**

Add an effect that runs once when Service Mode mounts:

```ts
  // Parse every PowerPoint deck up front. Two reasons: it removes any stall on
  // the first advance, and it surfaces a missing or corrupt file NOW — while
  // the operator can still fix it — instead of on slide 12 mid-service.
  useEffect(() => {
    const paths = [
      ...new Set(
        setlist.items
          .filter((i): i is Extract<SetlistItem, { kind: 'pptx' }> =>
            i.kind === 'pptx'
          )
          .map((i) => i.pptxPath)
      )
    ]
    for (const path of paths) {
      void loadPptxDeck(path).catch((err) => {
        console.error('[ServiceMode] deck failed to preload', path, err)
        setDeckWarnings((prev) => [
          ...prev,
          `${path.split(/[/\\]/).pop()} could not be opened. Its slides will not project.`
        ])
      })
    }
  }, [setlist.items])
```

Render `deckWarnings` in the operator UI only — never on the projector. Follow whatever warning affordance the operator strip already uses; if there is none, a plain amber banner above the upcoming list is sufficient.

- [ ] **Step 4: Verify by hand**

```bash
pnpm dev
```

Add `test-deck-hidden.pptx`, then rename the file on disk before entering Service Mode. Confirm a warning appears at entry naming the file, that Service Mode still starts, and that advancing onto that deck leaves the previous slide up rather than flashing white.

- [ ] **Step 5: Typecheck, test, commit**

```bash
pnpm typecheck && pnpm test
git add src/renderer/src/components src/renderer/src/pages/ServiceMode.tsx
git commit -m "feat: pptx thumbnails and warm decks on Service Mode entry

A missing deck is reported before the service starts, not on slide 12."
```

---

### Task 10: Documentation

**Files:**
- Modify: `README.md` (Stack section)
- Modify: `src/shared/__fixtures__/make_test_deck.py` (already committed; verify it still reproduces)

- [ ] **Step 1: Verify the fixtures still reproduce**

```bash
cd src/shared/__fixtures__ && python3 make_test_deck.py && cd -
```

Expected output:

```
test-deck.pptx — visible slides: 5
test-deck-hidden.pptx — 7 parts, 6 visible
```

```bash
git diff --stat src/shared/__fixtures__
```

Expected: no change, or byte-level churn only. If slide counts differ, stop — the fixture generator and the tests have diverged.

- [ ] **Step 2: Note the capability in README**

Add to the Stack line: `@aiden0z/pptx-renderer (live .pptx projection)`. Add one line under it:

```markdown
PowerPoint decks project directly — pick a `.pptx` when adding a setlist item.
Only `.pptx` is supported; for `.ppt`, `.key`, or Google Slides, export to PDF
and add it as a PDF deck.
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: note live PowerPoint projection"
```

---

## Deferred to phase 2

Google Slides, per the spec's phase 2 section: fetch `/export/pptx`, cache under `userData/media/decks/`, then reuse everything above. Its first step is confirming whether link-sharing suffices or publishing to the web is required — resolve that before planning it.

## Self-review notes

Checked against the spec:

- Data model, both new modules, all 12 modified files, add-time flow, service-time flow, failure handling, and both test layers have tasks.
- The spec's test-environment findings (node / xmldom / happy-dom / jsdom) are carried into Task 3 including the happy-dom warning, because a future contributor will otherwise reach for the faster option.
- Naming is consistent across tasks: `PptxSlideMeta`, `visibleSlideCount`, `ordinalToSourceIndex`, `PptxDeck`, `loadPptxDeck`, `probeVisibleSlideCount`, `evictPptxDeck`, `parsePptxBuffer`, `slideOrdinal`, `sourceIndex`.
- `evictPptxDeck` is exported in Task 4 and used in the Task 4 concurrency test, but no production call site exists yet. `pdfLoader.evictPdfDocument` has the same status, so this matches the existing pattern rather than adding dead code unique to this feature.
- Task 2 deliberately leaves a stub that Task 5 replaces, so every commit compiles.
