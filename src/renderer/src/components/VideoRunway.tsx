/**
 * VideoRunway — playback progress + pause/mute controls for the active
 * video slide, shown under the confidence monitor mirror during
 * Service Mode. Per design L631–659.
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
import { videoModeLabel, videoProgressPercent, videoTimeReadout } from '../lib/videoRunway'
import { MonoLabel } from './ui/MonoLabel'

interface VideoRunwayProps {
  update: VideoTimeUpdate
  loop: boolean
  paused: boolean
  muted: boolean
  onTogglePause: () => void
  onToggleMute: () => void
}

export function VideoRunway({
  update,
  loop,
  paused,
  muted,
  onTogglePause,
  onToggleMute
}: VideoRunwayProps): JSX.Element {
  const mode = videoModeLabel(loop, update.duration, update.currentTime)
  const time = videoTimeReadout(update.currentTime, update.duration)
  const pct = videoProgressPercent(update.currentTime, update.duration)

  return (
    <div className="mt-3 border border-border px-[13px] py-[11px]">
      <div className="mb-[9px] flex items-center justify-between">
        <MonoLabel tone="signal" size="xs">
          {mode}
        </MonoLabel>
        <span className="font-mono text-[10px] font-medium text-soft">{time}</span>
      </div>

      <div className="h-[3px] bg-border">
        <div className="h-[3px] bg-signal" style={{ width: `${pct}%` }} />
      </div>

      <div className="mt-[11px] flex">
        <button
          type="button"
          onClick={onTogglePause}
          title={`${paused ? 'Resume' : 'Pause'} (P)`}
          className="flex flex-1 items-center justify-center gap-[9px] border border-border bg-transparent p-[11px] text-bone hover:border-white"
        >
          {paused ? (
            <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M4 2.5l9 5.5-9 5.5z" />
            </svg>
          ) : (
            <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <rect x="4" y="2.8" width="3" height="10.4" />
              <rect x="9" y="2.8" width="3" height="10.4" />
            </svg>
          )}
          <span className="font-mono text-[9px] font-semibold tracking-[0.1em] text-dim">P</span>
        </button>
        <button
          type="button"
          onClick={onToggleMute}
          title={`${muted ? 'Sound on' : 'Mute'} (M)`}
          className={`flex flex-1 items-center justify-center gap-[9px] border border-l-0 border-border bg-transparent p-[11px] hover:border-white ${
            muted ? 'text-signal' : 'text-bone'
          }`}
        >
          {muted ? (
            <svg
              width="15"
              height="15"
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
              width="15"
              height="15"
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
          <span className="font-mono text-[9px] font-semibold tracking-[0.1em] text-dim">M</span>
        </button>
      </div>
    </div>
  )
}
