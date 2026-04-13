/**
 * Custom pdf.js worker entry.
 *
 * Why not import `pdfjs-dist/build/pdf.worker.min.mjs` directly?
 *   Because the worker runs in its own JS global scope. Any polyfills
 *   installed in the renderer's Uint8Array.prototype are invisible to
 *   the worker. pdf.js 5.6.205 calls `Uint8Array.prototype.toHex()`
 *   from BOTH main-thread code and worker code, so we need the
 *   polyfill installed in both places.
 *
 * This file is imported via vite's `?worker` suffix. Vite bundles it
 * as a standalone worker module: the polyfill runs first in the worker
 * scope, THEN pdf.js's worker module loads and sets up the standard
 * message handler on `self`. Once the polyfill is in place, any
 * downstream `toHex()` call inside the worker finds the shim.
 */

import './jsProposalsPolyfill'
import 'pdfjs-dist/build/pdf.worker.min.mjs'
