# Live PowerPoint projection

**Status:** approved design, not yet planned
**Date:** 2026-07-26

## Goal

Let an operator add a `.pptx` file to a setlist and project its slides, without
exporting to PDF first.

Today the operator must export the deck to PDF by hand. `SetlistItem`'s `deck`
kind takes a `pdfPath`, and [types.ts](../../../src/shared/types.ts) says so
outright: "The user exports their PowerPoint/Keynote/Google Slides to PDF." That
export is one click in PowerPoint, but it is one click the volunteer forgets on
Saturday night and cannot undo at 9:05 on Sunday morning.

We render `.pptx` slides directly in the projector window, live, using
`@aiden0z/pptx-renderer`.

## Non-goals

- Editing PowerPoint files. We display them.
- Converting `.pptx` to PDF. An earlier draft of this design converted at
  add-time via `printToPDF`; we rejected it (see *Alternatives rejected*).
- Bundling LibreOffice, or detecting an installed copy. LibreOffice serves only
  as a development-time test oracle.
- Native Office automation (Windows COM, macOS AppleScript).
- Legacy binary `.ppt` files. The renderer parses Office Open XML only, so the
  file picker must not offer `.ppt` and appear to accept it. An operator with a
  `.ppt` deck saves it as `.pptx` in PowerPoint, or exports to PDF.
- `.key` and `.odp`, for the same reason.
- Animations, slide transitions, and the other features the renderer omits (see
  *Accepted costs*).

## Research findings

Measured on macOS with a synthetic 5-slide 16:9 deck containing a title slide,
coloured bullets, a 3×3 table, a clustered column chart, and 44pt styled text.

| Measurement | Result |
|---|---|
| `parseZip` + `buildPresentation`, no DOM | 64 ms |
| Full parse and render of 5 slides | 253 ms |
| Slide dimensions reported | 1279.97 × 720 |
| Table cells rendered | all 9 |
| Chart rendered | yes, to `<canvas>` via ECharts |
| Styled text rendered | yes, to `<svg>` |

Three findings shaped the design:

**Parsing needs no DOM and costs 64 ms.** `parseZip` and `buildPresentation` are
pure. The add-time slide count and the service-time render therefore share one
code path, and warming every deck in a setlist costs almost nothing.

**Each slide carries a `hidden` flag.** A fixture with 7 slide parts, the sixth
marked `show="0"`, reported `hidden: [false ×5, true, false]`. We filter on that
flag to get the 6 slides PowerPoint would actually present. Counting
`ppt/slides/slideN.xml` entries in the zip — the shortcut `adm-zip` would have
made easy — would have projected one slide off from the operator's slide numbers
for any deck containing a draft slide.

**Slides expose `nodesMaterialized`.** Lazy materialization works as documented,
so `parseZipLazyMedia` with `{ lazySlides: true }` keeps a 100-slide deck from
decompressing every image at load.

The library is version 1.2.4, Apache-2.0, ships TypeScript types, runs CI and
codecov, and diffs 452 visual-regression cases against PowerPoint output with
SSIM and IoU metrics.

Its runtime dependencies are `echarts ^6.0.0` and `jszip ^3.10.1`, which Vite
bundles. It also declares an **optional** peer dependency on
`pdfjs-dist >=5 <7`, which this app already satisfies at `^5.6.205`, so the
EMF-embedded-PDF fallback works without adding anything.

## Architecture

Nothing downstream of the slide payload changes. `slideify` fans a deck out into
slides; `SlideRenderer` picks a branch per payload kind. We add one payload kind
and one branch, mirroring what `pdf-page` and `PdfPageView` already do.

```
SetlistItem { kind:'pptx', pptxPath, slideCount }
  → slideify()  fans out N × { kind:'pptx-slide', slideOrdinal }
  → SlideRenderer → PptxSlideView → pptxLoader (cached Presentation)
```

## Data model

Add one `SetlistItem` variant to [types.ts](../../../src/shared/types.ts),
mirroring `deck` field for field:

```ts
| {
    kind: 'pptx'
    id: string
    pptxPath: string
    /** Count of VISIBLE slides — hidden slides excluded. Cached at add-time
      * exactly like deck.pageCount so slideify can fan out synchronously. */
    slideCount: number
    /** Optional display name for the operator upcoming list */
    title?: string
  }
```

Add one `SlidePayload` variant, mirroring `pdf-page`:

```ts
{ kind: 'pptx-slide'; pptxPath: string; slideOrdinal: number; slideCount: number }
```

`slideOrdinal` is 1-based and counts visible slides only.

We do **not** persist the visible-to-source index map. `PptxSlideView` holds the
parsed presentation anyway, so it resolves ordinal to source index at render
time. This keeps one persisted field instead of two, respects the warning at the
top of `types.ts` against speculative fields, and recovers on its own when
someone swaps in a revised file.

## New modules

### `src/shared/pptxSlides.ts`

Pure slide arithmetic over `PptxSlideMeta[]`, with no DOM and no filesystem
access, so it tests in the default node environment. See *Testing* for the
interface and cases.

### `src/renderer/src/lib/pptxLoader.ts`

A sibling of [pdfLoader.ts](../../../src/renderer/src/lib/pdfLoader.ts), with the
same contract and the same reasons behind it. Copy its structure.

```ts
loadPresentation(absPath: string): Promise<Presentation>
probeVisibleSlideCount(absPath: string): Promise<number>
evictPresentation(absPath: string): void
```

- A module-level `Map` caches the *promise*, not the resolved value, so
  concurrent callers share one parse. Evict on rejection so a retry re-attempts.
- Read bytes through the existing `present-media://local` protocol, the way
  `pdfLoader` builds its URL.
- Use `parseZipLazyMedia`, but **eager** `buildPresentation(files)` — *not*
  `{ lazySlides: true }`.

  Measured on `test-deck-hidden.pptx`:

  ```
  lazySlides:true  hidden = [null,null,null,null,null,null,null]   → 7 visible
  eager            hidden = [false,false,false,false,false,true,false] → 6 visible
  ```

  With `lazySlides`, `hidden` is `null` until a slide is materialized. `null` is
  falsy, so `!s.hidden` is true for every slide and the hidden draft slide gets
  projected — the exact failure this design exists to prevent, surfacing in
  front of a congregation. Media laziness is unaffected and still worth having,
  so keep `parseZipLazyMedia` and drop only `lazySlides`.
- `import()` the renderer dynamically inside this module, from the package's
  default entry (`'@aiden0z/pptx-renderer'`) so Vite resolves and bundles
  ECharts and JSZip itself. Do **not** import the `/browser` standalone build;
  that exists for bundler-free `<script type="module">` use. Loading the chunk
  only when a setlist contains a `.pptx` leaves projector startup untouched for
  churches that never use PowerPoint.
- Map `presentation.slides` onto `PptxSlideMeta[]` and delegate counting to
  `visibleSlideCount` from `@shared/pptxSlides`.

### `src/renderer/src/components/PptxSlideView.tsx`

A sibling of `PdfPageView`, taking the same props it takes at
[SlideRenderer.tsx:245](../../../src/renderer/src/components/SlideRenderer.tsx) —
`animate`, `transitionDurationMs`, `useFade` — with `pptxPath` and `slideOrdinal`
in place of `pdfPath` and `pageIndex`. Maps ordinal to source index over the
visible-slide list, then renders that one slide with the library's `renderSlide`.

Wrap the render in an error boundary. See *Failure handling*.

## Modified files

| File | Change |
|---|---|
| [types.ts](../../../src/shared/types.ts) | add `pptx` item kind and `pptx-slide` payload |
| [slideify.ts:269](../../../src/renderer/src/lib/slideify.ts) | fan `pptx` out into `slideCount` payloads, beside the `deck` branch |
| [SlideRenderer.tsx:243](../../../src/renderer/src/components/SlideRenderer.tsx) | render `PptxSlideView` beside the `pdf-page` branch |
| [SlideRenderer.tsx:144](../../../src/renderer/src/components/SlideRenderer.tsx) | add `pptx-slide` to `isFullBleedMedia` |
| [SlideRenderer.tsx:294](../../../src/renderer/src/components/SlideRenderer.tsx) | add `pptx-slide` to the auto-fit exclusion list |
| [ipc-contract.ts:231](../../../src/shared/ipc-contract.ts) | add `'pptx'` to `PickFileKind` |
| [dialog.ts:21](../../../src/main/ipc/dialog.ts) | filter `pptx` only; title "Choose a PowerPoint file" |
| [AddItemPicker.tsx:77](../../../src/renderer/src/components/AddItemPicker.tsx) | add a `pptx` card, hint "Import PowerPoint" |
| [SetlistEditor.tsx:205](../../../src/renderer/src/pages/SetlistEditor.tsx) | add `addPptx`, mirroring `addDeck` |
| [ItemKindIcon.tsx:73](../../../src/renderer/src/components/ItemKindIcon.tsx) | icon and label for `pptx` |
| [SetlistItemCard.tsx:143](../../../src/renderer/src/components/SetlistItemCard.tsx) | thumbnail source for `pptx` |
| [ServiceMode.tsx:188](../../../src/renderer/src/pages/ServiceMode.tsx) | preview source for `pptx-slide`; warm decks on entry |

`slideify`'s exhaustiveness check (`const _never: never = item`) forces the new
branch, so TypeScript catches anything missed.

## Add-time flow

`addPptx` mirrors [addDeck](../../../src/renderer/src/pages/SetlistEditor.tsx):

1. `window.api.dialog.pickFile('pptx')`
2. `probeVisibleSlideCount(picked)`
3. Insert `{ kind:'pptx', pptxPath, slideCount, title }`, deriving `title` from
   the filename with the extension stripped.

A parse failure refuses the item and explains why. Reuse the wording pattern
`addDeck` already uses, which points the operator at PowerPoint's own PDF export
as a fallback. Never create an item that cannot render.

The 64 ms parse needs no progress UI.

## Service-time flow

On entering Service Mode, call `loadPresentation` for every `pptx` item in the
setlist. This surfaces a missing or corrupt file before the service starts
rather than on slide 12, and removes any stall on first advance.

## Failure handling

Live rendering puts a third-party library on the critical path during a service,
so containment is part of the feature, not a refinement.

**A slide that fails to render holds the previous slide.** The projector shows no
glitch; the operator strip shows the warning and the operator decides whether to
skip. We chose this over going black because a visible dead beat in front of the
congregation costs more than a confused operator, and the operator has a warning
explaining why the screen did not change. Revisit if operators report pressing a
key and believing it did not register.

**The projector never flashes white.** The error boundary falls back to the
previous slide's content, and `isFullBleedMedia` already paints black behind
full-bleed media.

**A missing file is caught on Service Mode entry** and reported in the operator
UI, not mid-service.

## Accepted costs

**Two render paths, maintained permanently.** `PdfPageView` and `PptxSlideView`
both exist from here on. Converting to PDF at add-time would have kept one path;
we chose live rendering to keep anything new off the critical path at 9 am and to
avoid the resolution risk in `printToPDF` rasterising ECharts canvases.

**A runtime dependency during a live service,** covered by the error boundary
above.

**Features the renderer omits:** animations, slide transitions, 3D, OMML
equations, EMF and WMF vectors, shadow, reflection, glow, embedded OLE objects,
audio and video playback, and slide notes. Church decks use drop-shadowed text
often, so expect shadow to be the gap operators hit first.

**The PDF path stays as the universal escape hatch,** at no code cost. Any deck
the renderer handles badly can still be exported to PDF and added as a `deck`
item, which works today.

## Testing

Commit both fixtures generated during research, 38 KB each:

- `test-deck.pptx` — 5 visible slides, with a table and a chart
- `test-deck-hidden.pptx` — 7 slide parts, the sixth hidden, so 6 visible

### Test environment

The current [vitest.config.ts](../../../vitest.config.ts) runs
`src/shared/**/*.test.ts` under `environment: 'node'`. Neither setting suits this
feature, and we measured why:

| Environment | Result parsing `test-deck-hidden.pptx` |
|---|---|
| node, as configured | `ReferenceError: DOMParser is not defined` |
| node + `@xmldom/xmldom` | `TypeError: e.querySelector is not a function` |
| node + `happy-dom` | **0 slides, no error** — silent false pass |
| node + `jsdom` | 7 parts, 6 visible, flags correct, 1280×720 |

`happy-dom` is the trap: its `DOMParser` rejects the OOXML declaration, logs to
stderr, and returns an empty presentation. A test written against it passes while
asserting nothing. Use `jsdom`.

Required changes:

- add `jsdom` to `devDependencies`
- widen `include` to `['src/shared/**/*.test.ts', 'src/renderer/**/*.test.ts']`,
  keeping `environment: 'node'` as the default
- the one test file that parses a real deck opts in per-file with
  `// @vitest-environment jsdom`

### Splitting pure logic from browser logic

To keep index arithmetic testable in the default node environment, the slide-math
lives in `src/shared/` as pure functions over plain data, separate from anything
that touches a DOM or the filesystem:

```ts
// src/shared/pptxSlides.ts — pure, node-testable
export interface PptxSlideMeta { sourceIndex: number; hidden: boolean }
export function visibleSlideCount(slides: PptxSlideMeta[]): number
export function ordinalToSourceIndex(slides: PptxSlideMeta[], ordinal: number): number | null
```

`pptxLoader` maps the library's presentation onto `PptxSlideMeta[]` and delegates
the arithmetic. Two test layers result: pure math in node, and one jsdom test
proving the real fixtures produce the metadata the math expects.

### Cases

Pure, node environment:

- `visibleSlideCount` returns 6 for the hidden-slide metadata, 5 for the plain deck
- `ordinalToSourceIndex` skips the hidden slide: ordinal 6 resolves to source
  index 7, ordinals 1–5 map to 1–5
- `ordinalToSourceIndex` returns `null` for ordinal 0, 7, and negatives
- `slideify` fans a `pptx` item into `slideCount` payloads with ordinals 1..N
- `slideify` drops a `pptx` item with `slideCount <= 0`, matching `deck`

jsdom environment, real fixtures:

- parsing `test-deck.pptx` yields 5 slide metas, none hidden
- parsing `test-deck-hidden.pptx` yields 7 metas with only index 6 hidden
- `probeVisibleSlideCount` returns 5 and 6 respectively

Cache behaviour, node environment with a stubbed parse:

- `loadPresentation` shares one promise across concurrent callers
- a rejected parse is evicted so a retry re-attempts

Development-time visual regression: convert a fixture with
`soffice --headless --convert-to pdf` and diff the renderer's output against
those pages. LibreOffice is a dev dependency for this comparison only, never
shipped, never detected at runtime.

## Phase 2: Google Slides

Live rendering makes Google Slides a download rather than a conversion.

1. Operator pastes a Google Slides URL; extract the presentation ID.
2. Fetch `https://docs.google.com/presentation/d/{id}/export/pptx`.
3. Save under `userData/media/decks/`, then follow the `pptx` path above.

`media/` already rides along in backup and restore —
[backup.ts:182](../../../src/main/storage/backup.ts) zips it recursively and
[backup.ts:303](../../../src/main/storage/backup.ts) restores it — so downloaded
decks inherit backup at no cost. Cache the file by presentation ID so a service
runs offline once the deck has been fetched.

The export endpoint returned 404 for an unknown ID rather than redirecting to
`accounts.google.com`, so it serves anonymous requests and gates on permission
alone. **Confirm against a real link-shared deck before building this phase**;
if link-sharing proves insufficient and publishing to the web is required, the
operator-facing instructions change, though the code path does not.

## Open items

- Whether Google Slides link-sharing suffices, or publishing to the web is
  required. Resolve at the start of phase 2.
- Whether holding the previous slide on a render failure confuses operators.
  Resolve from operator feedback, not in advance.
