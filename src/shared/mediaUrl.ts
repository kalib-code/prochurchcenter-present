/**
 * `present-media://` URL encoding — the ONE place both sides agree on.
 *
 * The renderer turns an absolute file path into
 * `present-media://local/<path>`; the main-process protocol handler in
 * main/index.ts turns it back into a path and streams the file.
 *
 * Why each segment goes through encodeURIComponent (not encodeURI on
 * the whole path): encodeURI leaves `#` and `?` alone, so
 * "Song #2.mp4" became a URL whose path ended at "Song " and whose
 * fragment was "2.mp4" — a 404. Encoding per segment escapes every
 * reserved character while keeping the `/` separators.
 *
 * Windows: `C:\Users\x\a.mp4` is normalized to `/C:/Users/x/a.mp4`
 * (forward slashes, drive kept as the first segment) so it becomes a
 * valid URL path; {@link fromMediaUrl} strips the leading `/` again so
 * `pathToFileURL` sees a real drive path. Backslashes are only treated
 * as separators for drive-letter and UNC paths — on POSIX a `\` is a
 * legal filename character and is percent-encoded instead.
 */

export const MEDIA_URL_PREFIX = 'present-media://local'

const WIN_DRIVE_RE = /^[A-Za-z]:([\\/]|$)/
const WIN_UNC_RE = /^\\\\[^\\]/

/** Absolute filesystem path → `present-media://local/...` URL. */
export function toMediaUrl(absPath: string): string {
  let p = absPath
  if (WIN_DRIVE_RE.test(p)) {
    p = '/' + p.replace(/\\/g, '/')
  } else if (WIN_UNC_RE.test(p)) {
    // `\\server\share\x` → `//server/share/x` (empty first segment).
    p = p.replace(/\\/g, '/')
  }
  return MEDIA_URL_PREFIX + p.split('/').map(encodeURIComponent).join('/')
}

/**
 * `present-media://...` URL → absolute filesystem path, or null if the
 * URL isn't one of ours. Also accepts the older encodeURI-built URLs,
 * since decoding is the same for every character encodeURI escaped.
 */
export function fromMediaUrl(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'present-media:') return null
  let path: string
  try {
    path = parsed.pathname.split('/').map(decodeURIComponent).join('/')
  } catch {
    return null // malformed %-escape
  }
  // `/C:/Users/...` → `C:/Users/...`; Node accepts `/` on Windows.
  if (/^\/[A-Za-z]:(\/|$)/.test(path)) path = path.slice(1)
  return path
}
