/**
 * videoRunway — pure formatting/derivation helpers for the operator's
 * video progress runway (VideoRunway.tsx).
 *
 * Pulled out of the component because `VideoTimeUpdate.duration` is
 * `NaN` until the output <video> element has loaded metadata, and can
 * be `Infinity` for a live stream (see ipc-contract.ts). Every helper
 * here treats "not a finite duration" as its own case rather than
 * coercing it to 0 — a live confidence monitor rendering "advances in
 * NaN:NaN" mid-service is the exact failure this file exists to
 * prevent. Kept as plain functions (no React) so the edge cases can be
 * pinned with fast, render-free tests.
 */

/**
 * Seconds → "m:ss". Non-finite or negative input clamps to "0:00"
 * rather than producing "NaN:NaN" or a negative readout.
 */
export function formatSeconds(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '0:00'
  const whole = Math.floor(totalSeconds)
  const minutes = Math.floor(whole / 60)
  const seconds = whole % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

/**
 * The runway's mode line.
 *
 *   - `loop`: always "LOOPING · WILL NOT ADVANCE" — this slide never
 *     auto-advances regardless of position, so duration is irrelevant.
 *   - not looping, duration finite: "PLAYS ONCE · ADVANCES IN {m:ss}",
 *     the remaining time clamped to >= 0 so a currentTime that has
 *     drifted past duration never reads as negative.
 *   - not looping, duration NOT finite (metadata hasn't loaded yet, or
 *     a live stream): "PLAYS ONCE" alone — never a placeholder time.
 */
export function videoModeLabel(loop: boolean, duration: number, currentTime: number): string {
  if (loop) return 'LOOPING · WILL NOT ADVANCE'
  if (!Number.isFinite(duration)) return 'PLAYS ONCE'
  const remaining = Math.max(0, duration - currentTime)
  return `PLAYS ONCE · ADVANCES IN ${formatSeconds(remaining)}`
}

/**
 * The "{elapsed} / {total}" mono readout. `total` reads "--:--" (never
 * "0:00", which would lie that playback already finished) while
 * duration hasn't loaded or is infinite.
 */
export function videoTimeReadout(currentTime: number, duration: number): string {
  const total = Number.isFinite(duration) ? formatSeconds(duration) : '--:--'
  return `${formatSeconds(currentTime)} / ${total}`
}

/**
 * Fill percentage for the progress track, clamped to 0–100. Guards
 * both a non-finite duration (NaN before metadata loads, Infinity for
 * a stream) and a currentTime that has drifted past duration — either
 * would otherwise overflow the track's container.
 */
export function videoProgressPercent(currentTime: number, duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0
  if (!Number.isFinite(currentTime) || currentTime < 0) return 0
  const pct = (currentTime / duration) * 100
  return Math.min(100, Math.max(0, pct))
}
