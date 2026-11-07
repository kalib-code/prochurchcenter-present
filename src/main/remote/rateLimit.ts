/**
 * Per-sender token bucket for OSC cues. OSC is unauthenticated UDP, so a
 * misbehaving or hostile sender could otherwise flood the operator window
 * with cues. Excess cues are dropped silently (one console warning per
 * sender at most every 10 s). HTTP is token-gated and MIDI is local
 * hardware, so only OSC goes through this.
 *
 * Pure apart from the injected clock and warn sink, so it is unit-testable.
 */

export interface SenderRateLimiterOptions {
  /** Burst size: cues a quiet sender may send at once. */
  capacity?: number
  /** Sustained cues per second. */
  refillPerSec?: number
  /** Senders not seen for longer than this are forgotten when room is needed. */
  idleMs?: number
  /** Hard cap on remembered senders. */
  maxSenders?: number
  warnEveryMs?: number
  now?: () => number
  warn?: (msg: string) => void
}

interface Bucket {
  tokens: number
  last: number
  lastWarn: number
}

export function createSenderRateLimiter(opts: SenderRateLimiterOptions = {}): {
  /** True if this sender's cue may run; false drops it. */
  allow(sender: string): boolean
  /** Number of senders currently remembered (for tests). */
  size(): number
} {
  const capacity = opts.capacity ?? 16
  const refillPerMs = (opts.refillPerSec ?? 10) / 1000
  const idleMs = opts.idleMs ?? 60_000
  const maxSenders = opts.maxSenders ?? 256
  const warnEveryMs = opts.warnEveryMs ?? 10_000
  const now = opts.now ?? Date.now
  const warn = opts.warn ?? ((msg: string) => console.warn(msg))
  // Insertion order doubles as least-recently-seen order: each hit re-inserts.
  const buckets = new Map<string, Bucket>()

  function makeRoom(t: number): void {
    for (const [k, b] of buckets) {
      if (t - b.last > idleMs) buckets.delete(k)
    }
    while (buckets.size >= maxSenders) {
      const oldest = buckets.keys().next().value
      if (oldest === undefined) break
      buckets.delete(oldest)
    }
  }

  return {
    allow(sender) {
      const key = sender.replace(/^::ffff:/i, '')
      const t = now()
      let b = buckets.get(key)
      if (b) {
        buckets.delete(key)
        b.tokens = Math.min(capacity, b.tokens + (t - b.last) * refillPerMs)
        b.last = t
      } else {
        if (buckets.size >= maxSenders) makeRoom(t)
        b = { tokens: capacity, last: t, lastWarn: -Infinity }
      }
      buckets.set(key, b)
      if (b.tokens >= 1) {
        b.tokens -= 1
        return true
      }
      if (t - b.lastWarn >= warnEveryMs) {
        b.lastWarn = t
        warn(`[remote] OSC cues from ${key} are arriving too fast; dropping the excess.`)
      }
      return false
    },
    size: () => buckets.size
  }
}
