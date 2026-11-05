/**
 * VideoRunway — playback progress + pause/mute controls for the active
 * video slide, shown under the confidence monitor mirror during
 * Service Mode.
 *
 * Presentational only: renders from props and does not subscribe to
 * IPC itself. The wiring task feeds it the latest `VideoTimeUpdate`
 * broadcast from the output window plus the operator's local
 * paused/muted state; this component only formats and displays.
 *
 * All time/percentage math is delegated to lib/videoRunway.ts, which
 * guards `duration` being `NaN` (metadata not loaded) or `Infinity`
 * (a stream) — see that file for why those cases can't be coerced to
 * a placeholder like "0:00".
 */

import type { VideoTimeUpdate } from '@shared/ipc-contract'
import { cn } from '../lib/utils'
import { videoModeLabel, videoProgressPercent, videoTimeReadout } from '../lib/videoRunway'
import { Kbd } from './service/Kbd'

interface VideoRunwayProps {
  update: VideoTimeUpdate
  loop: boolean
  paused: boolean
  muted: boolean
  onTogglePause: () => void
  onToggleMute: () => void
}

/**
 * lib/videoRunway's mode strings are fixed all-caps copy pinned by its
 * tests ("PLAYS ONCE · ADVANCES IN 1:23"); render them in sentence case.
 * Safe to lowercase wholesale — the only variable part is an m:ss time.
 */
function sentenceCase(text: string): string {
  const lower = text.toLowerCase()
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

const CONTROL =
  'flex h-9 flex-1 items-center justify-center gap-2 rounded-md bg-hover text-[13px] font-medium transition-colors ' +
  'hover:bg-selected focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70'

export function VideoRunway({
  update,
  loop,
  paused,
  muted,
  onTogglePause,
  onToggleMute
}: VideoRunwayProps): JSX.Element {
  const mode = sentenceCase(videoModeLabel(loop, update.duration, update.currentTime))
  const time = videoTimeReadout(update.currentTime, update.duration)
  const pct = videoProgressPercent(update.currentTime, update.duration)

  return (
    <div className="mt-3 rounded-lg bg-raised p-3">
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <span className="truncate text-[12px] font-medium text-soft">{mode}</span>
        <span className="shrink-0 font-mono text-[12px] font-medium tabular-nums text-quiet">
          {time}
        </span>
      </div>

      <div className="h-1 overflow-hidden rounded-full bg-border">
        <div className="h-full rounded-full bg-bone" style={{ width: `${pct}%` }} />
      </div>

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onTogglePause}
          title={`${paused ? 'Resume' : 'Pause'} (P)`}
          className={cn(CONTROL, 'text-bone')}
        >
          {paused ? (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M4 2.5l9 5.5-9 5.5z" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <rect x="4" y="2.8" width="3" height="10.4" rx="0.5" />
              <rect x="9" y="2.8" width="3" height="10.4" rx="0.5" />
            </svg>
          )}
          {paused ? 'Resume' : 'Pause'}
          <Kbd>P</Kbd>
        </button>
        <button
          type="button"
          onClick={onToggleMute}
          title={`${muted ? 'Sound on' : 'Mute'} (M)`}
          // Muted audio during a service needs attention → amber.
          className={cn(CONTROL, muted ? 'bg-warn/15 text-warn hover:bg-warn/20' : 'text-bone')}
        >
          {muted ? (
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              aria-hidden="true"
            >
              <path d="M3 6h2.4L8.6 3.2v9.6L5.4 10H3z" />
              <path d="M11 6.2l3 3.6M14 6.2l-3 3.6" />
            </svg>
          ) : (
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              aria-hidden="true"
            >
              <path d="M3 6h2.4L8.6 3.2v9.6L5.4 10H3z" />
              <path d="M11 5.6a3.4 3.4 0 010 4.8M12.9 3.6a6 6 0 010 8.8" />
            </svg>
          )}
          {muted ? 'Muted' : 'Mute'}
          <Kbd>M</Kbd>
        </button>
      </div>
    </div>
  )
}
