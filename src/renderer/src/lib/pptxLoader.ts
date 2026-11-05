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
 * Why lazy MEDIA but plain (non-lazy) slide parsing:
 *   parseZipLazyMedia defers image decompression until a slide is actually
 *   rendered — a real win, since a church that never projects a photo-heavy
 *   deck shouldn't pay to decode every embedded image just to count slides.
 *   buildPresentation's `{ lazySlides: true }` looked like the matching win
 *   for slide *node* parsing, but measured behaviour says otherwise: a
 *   lazily-built slide's `hidden` flag comes back `undefined` until that
 *   slide is materialized — the library only computes `hidden` as a side
 *   effect of parsing the full node tree, there is no cheap "just tell me if
 *   it's hidden" path. We need every slide's hidden flag up front to build
 *   PptxSlideMeta, so lazySlides buys nothing here: we'd end up
 *   materializing every slide anyway, just via an extra round trip through
 *   an unmaterialized placeholder. Calling buildPresentation(files) plain
 *   parses `hidden` correctly for every slide immediately.
 */

import type { PptxSlideMeta } from '@shared/pptxSlides'
import { visibleSlideCount } from '@shared/pptxSlides'
import { toMediaUrl } from '@shared/mediaUrl'

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
  // No { lazySlides: true } here — see the module doc comment above.
  const presentation = buildPresentation(files)

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
  // Shared encoder: encodeURI left `#`/`?` raw, breaking "Deck #2.pptx".
  return toMediaUrl(absPath)
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

/**
 * Drop a path from the cache (e.g., when its item is deleted, or before
 * re-probing a freshly re-picked file at the same path — see
 * SetlistEditor.tsx's addPptx and SetlistItemCard.tsx's re-pick handler).
 * Without this, re-importing an edited .pptx at an unchanged path would
 * silently keep serving the pre-edit parse forever: this feature's whole
 * premise is "point at the file, no export step", which makes editing the
 * source and re-picking it the expected workflow.
 *
 * Unlike pdfLoader's evictPdfDocument, this does not call any dispose/
 * destroy method on the evicted entry — PresentationData (the parsed
 * object @aiden0z/pptx-renderer hands back from buildPresentation) has no
 * such API. It's a plain parsed object with no chart instances or blob
 * URLs of its own; those only get created per-slide inside renderSlide(),
 * and are owned/freed by that slide's SlideHandle, not by PresentationData.
 * So dropping the cache entry is enough — nothing here needs disposing.
 *
 * Scope limitation: this only clears the CALLING window's cache (each
 * BrowserWindow — operator, output, stage — has its own JS heap and thus
 * its own module-level deckCache; see the module doc comment above). The
 * projector windows' independent caches are not reachable from here and
 * are only ever repopulated on next service start, so an operator who
 * fixes a typo mid-service and re-picks the file will see the correction
 * in their own preview immediately, but the projector keeps showing the
 * stale version until the app restarts (or the service is re-started).
 */
export function evictPptxDeck(absPath: string): void {
  deckCache.delete(absPath)
}
