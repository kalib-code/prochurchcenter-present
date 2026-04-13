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
    getBibleCacheDir()
  ]
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
  }
}
