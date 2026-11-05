/**
 * Minimal semver ordering for the manual "Check for updates" result.
 *
 * Why not a dependency: we only need ordering of the `x.y.z[-pre][+build]`
 * strings electron-builder stamps into releases, and electron-updater's own
 * `semver` copy is a transitive dep we shouldn't import directly. Kept free
 * of electron imports so it can be unit tested.
 */

interface ParsedVersion {
  core: [number, number, number]
  /** Dot-separated prerelease identifiers; empty for a release version. */
  pre: string[]
}

const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

export function parseVersion(version: string): ParsedVersion | null {
  const m = VERSION_RE.exec(version.trim())
  if (!m) return null
  return {
    core: [Number(m[1]), Number(m[2]), Number(m[3])],
    pre: m[4] ? m[4].split('.') : []
  }
}

/** Semver §11 prerelease identifier precedence. */
function compareIdentifiers(a: string, b: string): number {
  const aNum = /^\d+$/.test(a)
  const bNum = /^\d+$/.test(b)
  if (aNum && bNum) return Math.sign(Number(a) - Number(b))
  // Numeric identifiers always sort before alphanumeric ones.
  if (aNum) return -1
  if (bNum) return 1
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Compare two versions: negative if a < b, 0 if equal, positive if a > b.
 * Returns null when either side isn't a parseable x.y.z version, so the
 * caller can decide instead of guessing an order. Build metadata (`+…`)
 * is ignored, as semver requires.
 */
export function compareVersions(a: string, b: string): number | null {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  if (!pa || !pb) return null
  for (let i = 0; i < 3; i++) {
    if (pa.core[i] !== pb.core[i]) return Math.sign(pa.core[i] - pb.core[i])
  }
  // A release outranks any prerelease of the same core: 1.0.0 > 1.0.0-beta.
  if (pa.pre.length === 0 || pb.pre.length === 0) {
    return pa.pre.length === pb.pre.length ? 0 : pa.pre.length === 0 ? 1 : -1
  }
  const n = Math.min(pa.pre.length, pb.pre.length)
  for (let i = 0; i < n; i++) {
    const c = compareIdentifiers(pa.pre[i], pb.pre[i])
    if (c !== 0) return c
  }
  // All shared identifiers equal: the longer set is newer (beta < beta.1).
  return Math.sign(pa.pre.length - pb.pre.length)
}

/** True only when `candidate` is strictly newer than `current`. */
export function isNewerVersion(candidate: string, current: string): boolean {
  const c = compareVersions(candidate, current)
  return c !== null && c > 0
}
