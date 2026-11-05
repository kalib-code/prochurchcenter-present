/**
 * Max-lines-per-slide bounds and the commit-time parser for its Settings
 * input. The input keeps a local string while typing and only parses on
 * blur/Enter — clamping every keystroke turned the "1" of "12" into 2
 * and saved it, so typing a two-digit value was nearly impossible.
 */

export const MAX_LINES_MIN = 2
export const MAX_LINES_MAX = 20

/** Parse + clamp a typed value. Null means "not a number — revert". */
export function parseMaxLinesInput(raw: string): number | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  const n = Number(trimmed)
  if (!Number.isFinite(n)) return null
  return Math.max(MAX_LINES_MIN, Math.min(MAX_LINES_MAX, Math.floor(n)))
}
