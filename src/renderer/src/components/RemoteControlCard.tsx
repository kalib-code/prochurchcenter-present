/**
 * Settings → Connections → Remote control.
 *
 * Lets a playback app, MIDI controller or Stream Deck move slides during
 * a service. Sections live in ./remote; this file holds the master
 * switch, who may connect, and the HTTP address/token.
 */

import { Badge } from './ui/Badge'
import { Segmented } from './ui/Segmented'
import { Notice, SettingRow, SettingsGroup, Switch } from './settings/SettingsKit'
import { CopyButton } from './AiConnectionsCard'
import { PortField } from './remote/PortField'
import { RemoteActivityList } from './remote/RemoteActivityList'
import { RemoteMidiSection } from './remote/RemoteMidiSection'
import { RemoteOscSection } from './remote/RemoteOscSection'
import { RemoteTokenRow } from './remote/RemoteTokenRow'
import { useRemoteSave, useRemoteState } from './remote/useRemoteState'
import type { RemoteState } from '@shared/remote'

const DOCS_URL = 'https://github.com/kalib-code/prochurchcenter-present/blob/main/docs/remote-control.md'

function StatusBadge({ state }: { state: RemoteState }): JSX.Element {
  if (!state.enabled) return <Badge tone="neutral">Off</Badge>
  switch (state.status) {
    case 'running':
      return <Badge tone="ok">On</Badge>
    case 'starting':
      return <Badge tone="neutral">Starting…</Badge>
    case 'error':
      return <Badge tone="warn">Not running</Badge>
    default:
      return <Badge tone="neutral">Off</Badge>
  }
}

export function RemoteControlCard(): JSX.Element | null {
  const [state, setState] = useRemoteState()
  const { error, save } = useRemoteSave(setState)
  if (!state) return null

  return (
    <div className="space-y-5">
      <SettingsGroup
        title="Remote control"
        description="Let a playback app, MIDI controller, or Stream Deck move the slides during a service. Remotes can change slides, songs, and blackout. They can't end the service or change your library."
        action={<StatusBadge state={state} />}
      >
        <SettingRow label="Allow remote control" htmlFor="remote-enabled">
          <Switch
            id="remote-enabled"
            checked={state.enabled}
            onChange={(e) => void save({ enabled: e.target.checked })}
          />
        </SettingRow>

        {(state.error || error) && (
          <div className="px-4 py-3">
            <Notice tone="warn">{error ?? state.error}</Notice>
          </div>
        )}

        {state.enabled && (
          <>
            <SettingRow
              label="Listen on"
              below={
                state.scope === 'network' ? (
                  <ul className="space-y-1">
                    {state.addresses.map((addr) => {
                      const url = `http://${addr}:${state.httpPort}`
                      return (
                        <li key={addr} className="flex items-center gap-2">
                          <code className="font-mono text-[12px] text-soft">{url}</code>
                          <CopyButton text={url} />
                        </li>
                      )
                    })}
                  </ul>
                ) : undefined
              }
            >
              <Segmented
                size="sm"
                options={[
                  { value: 'local', label: 'This computer only' },
                  { value: 'network', label: 'Other computers on this network' }
                ]}
                value={state.scope}
                onChange={(scope) => void save({ scope })}
              />
            </SettingRow>
            <RemoteTokenRow state={state} setState={setState} />
            <SettingRow label="Port" htmlFor="remote-http-port" description="Change this only if another app already uses it.">
              <PortField id="remote-http-port" saved={state.httpPort} onSave={(p) => save({ httpPort: p })} />
            </SettingRow>
            <RemoteOscSection state={state} setState={setState} />
            <RemoteMidiSection state={state} setState={setState} />
            <div className="px-4 py-3 text-[12.5px]">
              <button
                type="button"
                className="text-accent hover:underline"
                onClick={() => void window.api.system.openExternal(DOCS_URL)}
              >
                How to set up your remote
              </button>
            </div>
          </>
        )}
      </SettingsGroup>

      {state.enabled && <RemoteActivityList />}
    </div>
  )
}
