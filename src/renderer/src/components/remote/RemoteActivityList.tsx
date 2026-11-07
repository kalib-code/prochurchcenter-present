import { SettingsGroup } from '../settings/SettingsKit'
import { useRemoteStore } from '../../stores/useRemoteStore'
import { failureText, sourceLabel } from '../../lib/remoteDisplay'

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })
}

export function RemoteActivityList(): JSX.Element {
  const activity = useRemoteStore((s) => s.activity)
  return (
    <SettingsGroup title="Recent cues" description="What remotes have asked Present to do since it opened.">
      {activity.length === 0 ? (
        <p className="px-4 py-3.5 text-[12.5px] text-muted-foreground">
          Nothing yet. Cues from your remotes will show up here.
        </p>
      ) : (
        activity.map((a, i) => (
          <div key={`${a.at}-${i}`} className="flex items-baseline gap-3 px-4 py-2.5 text-[13px]">
            <span className="w-24 shrink-0 tabular-nums text-muted-foreground">{formatTime(a.at)}</span>
            <span className="min-w-0 flex-1 text-foreground">
              <span className="text-soft">{sourceLabel(a.source)}</span>
              {a.from ? <span className="text-muted-foreground"> {a.from}</span> : null} · {a.summary}
            </span>
            {a.result.ok ? (
              <span className="shrink-0 text-ok" aria-label="Done">
                ✓
              </span>
            ) : (
              <span className="shrink-0 text-warn">{failureText(a.result.reason)}</span>
            )}
          </div>
        ))
      )}
    </SettingsGroup>
  )
}
