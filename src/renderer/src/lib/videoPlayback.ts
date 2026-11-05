/**
 * videoPlayback — pure timing rules for the output window's foreground
 * video (VideoSlideOutput in SlideRenderer.tsx). Kept out of the
 * component so the edge cases (tiny clips, unknown duration) can be
 * pinned with render-free tests.
 */

/** How early, at most, a LOOPING video is rewound before its end. */
export const LOOP_REWIND_MARGIN_S = 0.5

/**
 * Whether a looping video is close enough to its end to rewind to 0.
 *
 * Only for loops: the pre-emptive rewind sidesteps native `loop`
 * failing to seek back on our present-media:// streams. Non-looping
 * videos must NOT use this — they signal end from the real `ended`
 * event so their last frames (fade-outs, title cards) are shown.
 *
 * The margin shrinks to a quarter of the clip for very short videos:
 * a flat 0.5s on a 0.4s clip would read as "near end" from frame one.
 * Unknown (NaN), infinite, or zero durations never rewind — there is
 * no end to be near; native `loop` / the `ended` fallback handle them.
 */
export function shouldRewindLoop(currentTime: number, duration: number): boolean {
  if (!Number.isFinite(duration) || duration <= 0) return false
  if (!Number.isFinite(currentTime)) return false
  const margin = Math.min(LOOP_REWIND_MARGIN_S, duration / 4)
  return currentTime >= duration - margin
}

/** No playback update for this long while one is expected → "not playing". */
export const PLAYBACK_STALL_MS = 4000

/**
 * Whether the operator should be getting a steady stream of playback
 * updates from the projector right now. Drives Service Mode's "not
 * playing" warning — the operator's only signal that the projector's
 * video failed, since the projector itself renders black on error (an
 * error panel there would be read by the congregation).
 *
 * Not expected when:
 *   - the output is cut to black / logo (the projector pauses the video)
 *   - the operator paused it
 *   - the projector last reported itself paused
 *   - the last report sits at the very end of the clip — a play-once
 *     video's final timeupdate fires BEFORE the element flips to paused,
 *     so without this a finished video on the last slide would read as
 *     stalled
 *
 * `last` is null until the first update for this video arrives; that
 * still counts as expected, so a file that never starts is flagged too.
 */
export function isPlaybackExpected(
  live: boolean,
  operatorPaused: boolean,
  last: { currentTime: number; duration: number; paused: boolean } | null
): boolean {
  if (!live || operatorPaused) return false
  if (!last) return true
  if (last.paused) return false
  if (Number.isFinite(last.duration) && last.currentTime >= last.duration - 0.25) return false
  return true
}
