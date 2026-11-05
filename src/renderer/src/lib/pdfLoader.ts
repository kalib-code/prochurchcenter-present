/**
 * Shared pdfjs-dist loader + document cache.
 *
 * Why a shared module:
 *   - GlobalWorkerOptions.workerPort must be set exactly once per window;
 *     doing it in a module top-level keeps every caller consistent.
 *   - Loading a PDFDocumentProxy is non-trivial (parse + font discovery),
 *     so we cache one promise per absolute path. SlideRenderer, the deck
 *     add flow, and any future previewer all share the same Promise.
 *
 * Why disableRange + disableStream:
 *   pdf.js by default issues HTTP Range requests to fetch only the parts
 *   of the file it needs. Our custom `present-media://` protocol hands
 *   back the whole file via `net.fetch(file://...)` which doesn't
 *   advertise range support. Forcing full-file fetch is the simplest way
 *   to avoid "range request failed" errors. Church PDFs (sermon notes,
 *   slide decks) are small enough (~5 MB) that loading the whole file
 *   once is a rounding error.
 *
 * Why disableAutoFetch:
 *   Prevents pdf.js from prefetching unused pages in the background. We
 *   render pages on demand from the service navigation, so background
 *   prefetch just wastes CPU during a live service.
 */

// Side-effect polyfills — MUST come before pdfjs-dist. Electron 34
// ships Chromium 132 which is missing several TC39 proposal methods
// that pdf.js 5.6 calls (Uint8Array.toHex, Map.getOrInsertComputed,
// etc). Once Electron bumps past Chromium 135 this import becomes a
// no-op automatically.
import './jsProposalsPolyfill'
import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
// Our wrapper worker entry — installs the Uint8Array polyfill in the
// worker scope FIRST, then loads the pdf.js worker code. Vite bundles
// this as a standalone Worker module via `?worker`.
import PdfWorker from './pdfWorkerEntry?worker'
import { toMediaUrl } from '@shared/mediaUrl'

let workerInitialized = false

function ensureWorker(): void {
  if (workerInitialized) return
  pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker()
  workerInitialized = true
}

// Module-level cache of document-loading promises keyed by absolute path.
// We store the PROMISE (not the resolved proxy) so concurrent callers
// asking for the same path share one load.
const docCache = new Map<string, Promise<PDFDocumentProxy>>()

function mediaUrl(absPath: string): string {
  // Shared encoder: encodeURI left `#`/`?` raw and broke Windows paths.
  return toMediaUrl(absPath)
}

/**
 * Load (or return cached) PDFDocumentProxy for the given absolute file path.
 * Callers should NOT close the returned proxy — the cache owns lifetime.
 */
export function loadPdfDocument(absPath: string): Promise<PDFDocumentProxy> {
  ensureWorker()
  const cached = docCache.get(absPath)
  if (cached) return cached

  const promise = pdfjs
    .getDocument({
      url: mediaUrl(absPath),
      disableRange: true,
      disableStream: true,
      disableAutoFetch: true
    })
    .promise
    .catch((err) => {
      // On failure, evict so a retry can reattempt instead of returning
      // the same rejected promise forever.
      docCache.delete(absPath)
      throw err
    })

  docCache.set(absPath, promise)
  return promise
}

/**
 * Open a PDF just long enough to read its page count, then release it.
 * Used by the SetlistEditor "add deck" flow to stamp pageCount onto the
 * SetlistItem at creation time so slideify can expand synchronously.
 */
export async function probePdfPageCount(absPath: string): Promise<number> {
  const doc = await loadPdfDocument(absPath)
  return doc.numPages
}

/** Drop a path from the cache (e.g., when its item is deleted). */
export function evictPdfDocument(absPath: string): void {
  const cached = docCache.get(absPath)
  docCache.delete(absPath)
  // Fire-and-forget destroy to release worker resources.
  void cached?.then((doc) => doc.destroy()).catch(() => {})
}
