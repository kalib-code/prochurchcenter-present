/**
 * Path-safety guards for the storage layer.
 *
 * Kept free of `electron` imports on purpose so the helpers can be unit
 * tested under vitest without an Electron runtime.
 */

import { resolve, sep } from 'path'

/**
 * Resolve `rel` against `baseDir` and return the absolute path only if it
 * lands strictly INSIDE `baseDir`; otherwise null.
 *
 * Why: backup zips are user-supplied (a file picked in "Restore from
 * file…"), and a zip entry name is just a string — `library/songs/../../x`
 * or an absolute path would otherwise be written outside the app's data
 * folder (classic "zip-slip"). `resolve` normalizes `..` segments and
 * both `/` and `\` on Windows before the prefix check, so neither form can
 * sneak past it. The `+ sep` stops `/data/songs-evil` from matching
 * `/data/songs`.
 */
export function resolveInside(baseDir: string, rel: string): string | null {
  const base = resolve(baseDir)
  const target = resolve(base, rel)
  const prefix = base.endsWith(sep) ? base : base + sep
  return target.startsWith(prefix) ? target : null
}

/**
 * Every id that becomes a filename: songs and setlists are `randomUUID()`
 * (hex + dashes), themes are slugs like `default`.
 */
const SAFE_ID = /^[A-Za-z0-9_-]+$/

/**
 * Throw unless `id` is safe to use as a bare filename stem.
 *
 * Why: song/setlist/theme ids arrive over IPC from the renderer and are
 * joined straight into a path (`<dir>/<id>.json`). Without this, an id of
 * `../../settings` would read or overwrite settings.json — or any other
 * `.json` file the user can write.
 */
export function assertSafeId(id: unknown): string {
  if (typeof id !== 'string' || !SAFE_ID.test(id)) {
    throw new Error(`Invalid id: ${JSON.stringify(id)}`)
  }
  return id
}
