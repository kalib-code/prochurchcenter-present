/**
 * Custom font storage — manages user-uploaded fonts.
 *
 * Fonts are stored under userData/fonts/, with a small index.json
 * alongside them mapping a CSS family name to the on-disk filename.
 * The family name is what gets persisted into themes (font-family CSS
 * value); the filename is what the renderer uses to construct the
 * @font-face src URL.
 *
 * We persist the file path rather than embedding the bytes in
 * settings.json because (a) settings stays small and (b) the renderer
 * loads the font via the present-media:// custom protocol the same
 * way it loads images and videos — no special font streaming code.
 */

import { copyFileSync, readFileSync, writeFileSync, unlinkSync, existsSync } from 'fs'
import { basename, extname, join } from 'path'
import { getFontsDir, getFontsIndexPath } from './paths'

export interface CustomFont {
  /** CSS-safe family name shown in pickers and persisted in themes. */
  family: string
  /** Filename only (no path) — joined with getFontsDir() when needed. */
  filename: string
}

interface FontsIndex {
  fonts: CustomFont[]
}

function readIndex(): FontsIndex {
  const path = getFontsIndexPath()
  if (!existsSync(path)) return { fonts: [] }
  try {
    const raw = readFileSync(path, 'utf8')
    const parsed = JSON.parse(raw) as Partial<FontsIndex>
    return { fonts: Array.isArray(parsed.fonts) ? parsed.fonts : [] }
  } catch {
    return { fonts: [] }
  }
}

function writeIndex(index: FontsIndex): void {
  writeFileSync(getFontsIndexPath(), JSON.stringify(index, null, 2), 'utf8')
}

/**
 * Derive a CSS family name from a font filename. We strip the
 * extension and use the basename — most fonts are named after their
 * family already (e.g., "InterTight-Bold.ttf" → "InterTight-Bold").
 *
 * Not extracting the actual `name` table from the TTF/OTF header
 * because (a) it adds parser complexity and a dependency, (b) the
 * filename is what the user already recognizes, and (c) volunteers
 * can rename the file before uploading if they want a cleaner name.
 */
function deriveFamily(filename: string): string {
  return basename(filename, extname(filename))
}

export function listCustomFonts(): CustomFont[] {
  return readIndex().fonts
}

/**
 * Copy a user-picked font file into our fonts directory and add it to
 * the index. Returns the persisted CustomFont entry. Throws if the
 * file extension isn't a recognized font format — the dialog filter
 * should already have caught this, but we double-check at the storage
 * boundary.
 */
export function uploadCustomFont(sourcePath: string): CustomFont {
  const ext = extname(sourcePath).toLowerCase()
  if (!['.ttf', '.otf', '.woff', '.woff2'].includes(ext)) {
    throw new Error(`Unsupported font format: ${ext}`)
  }

  const filename = basename(sourcePath)
  const dest = join(getFontsDir(), filename)
  copyFileSync(sourcePath, dest)

  const family = deriveFamily(filename)
  const index = readIndex()
  // Replace any existing entry with the same family — re-uploading
  // the same font name is treated as an update, not a duplicate.
  const next = {
    fonts: [...index.fonts.filter((f) => f.family !== family), { family, filename }]
  }
  writeIndex(next)
  return { family, filename }
}

export function deleteCustomFont(family: string): void {
  const index = readIndex()
  const target = index.fonts.find((f) => f.family === family)
  if (!target) return
  const path = join(getFontsDir(), target.filename)
  if (existsSync(path)) {
    try {
      unlinkSync(path)
    } catch {
      // File might be locked by the renderer that's currently using
      // it — that's fine, deleting from the index is enough to hide
      // it from future use. The orphaned file gets cleaned up on the
      // next app restart when nobody's holding it.
    }
  }
  writeIndex({ fonts: index.fonts.filter((f) => f.family !== family) })
}

/**
 * Return the absolute path to a custom font file. Used by the
 * present-media:// protocol handler indirectly — the renderer
 * constructs URLs like `present-media://local{absolutePath}`.
 */
export function getCustomFontPath(filename: string): string {
  return join(getFontsDir(), filename)
}
