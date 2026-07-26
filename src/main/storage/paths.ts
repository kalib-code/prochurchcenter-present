/**
 * Filesystem path helpers for Present's storage layer.
 *
 * Every persistent file lives under Electron's `userData` directory:
 *
 *   <userData>/
 *   ├── library/
 *   │   ├── songs/        {uuid}.json
 *   │   └── setlists/     {uuid}.json
 *   ├── themes/           {id}.json (default.json is seeded on first run)
 *   ├── media/            (user images/videos — v1.1+)
 *   ├── settings.json
 *   ├── license.json      (Phase 8)
 *   └── device.json       (Phase 8)
 */

import { app } from 'electron'
import { mkdirSync, existsSync } from 'fs'
import { join } from 'path'

function root(): string {
  return app.getPath('userData')
}

export function getLibraryDir(): string {
  return join(root(), 'library')
}

export function getSongsDir(): string {
  return join(getLibraryDir(), 'songs')
}

export function getSetlistsDir(): string {
  return join(getLibraryDir(), 'setlists')
}

export function getThemesDir(): string {
  return join(root(), 'themes')
}

export function getMediaDir(): string {
  return join(root(), 'media')
}

/**
 * Custom font storage. Uploaded fonts are copied here by the
 * dialog/upload flow so they have stable, persistent absolute paths
 * (the user's original file might be on a removable drive or in
 * Downloads they later clean up). Each file keeps its original name;
 * the family name is derived once and stored in the index file.
 */
export function getFontsDir(): string {
  return join(root(), 'fonts')
}

/**
 * Index file mapping installed custom-font families to their on-disk
 * filenames. Lives alongside the font files so the main process can
 * enumerate without re-reading every TTF header on every list call.
 */
export function getFontsIndexPath(): string {
  return join(getFontsDir(), 'index.json')
}

/**
 * Canva-imported PDFs. A subdirectory of media/ rather than a sibling so
 * `addDirToZip` picks it up in backups with no changes to backup.ts —
 * it already recurses, and restore already handles nested paths.
 */
export function getCanvaMediaDir(): string {
  return join(getMediaDir(), 'canva')
}

/**
 * Encrypted Canva OAuth tokens. Not in settings.json: a refresh token is
 * a standing grant to an entire Canva account, so it is written through
 * Electron's safeStorage rather than the plain-JSON pattern used by
 * every other file in this directory.
 */
export function getCanvaTokensPath(): string {
  return join(root(), 'canva-tokens.enc')
}

/**
 * Bible cache root — one subdirectory per translation, files keyed by
 * `{book}-{chapter}.json`. Translation/book metadata caches live next
 * to the per-chapter files in their respective translation dirs (or in
 * the root for the global available_translations.json cache).
 */
export function getBibleCacheDir(): string {
  return join(root(), 'bible-cache')
}

export function getSettingsPath(): string {
  return join(root(), 'settings.json')
}

export function getLicensePath(): string {
  return join(root(), 'license.json')
}

export function getDevicePath(): string {
  return join(root(), 'device.json')
}

/**
 * Ensure every directory Present writes to exists.
 * Called once at app startup before any storage reads/writes.
 */
export function ensureDirectories(): void {
  const dirs = [
    getLibraryDir(),
    getSongsDir(),
    getSetlistsDir(),
    getThemesDir(),
    getMediaDir(),
    getCanvaMediaDir(),
    getBibleCacheDir(),
    getFontsDir()
  ]
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
  }
}
