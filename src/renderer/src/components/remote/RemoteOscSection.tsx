import { useEffect, useState } from 'react'
import type { RemoteState } from '@shared/remote'
import { Input } from '../ui/Input'
import { Notice, SettingRow, Switch } from '../settings/SettingsKit'
import { PortField } from './PortField'
import { FieldError, useRemoteSave } from './useRemoteState'

export function RemoteOscSection({
  state,
  setState
}: {
  state: RemoteState
  setState: (s: RemoteState) => void
}): JSX.Element {
  const { errors, save } = useRemoteSave(setState)
  const saved = state.oscAllowFrom ?? ''
  const [draft, setDraft] = useState(saved)
  useEffect(() => setDraft(saved), [saved])

  const commitAllow = async (): Promise<void> => {
    if (draft.trim() === saved) return
    await save('oscAllowFrom', { oscAllowFrom: draft.trim() || null })
  }

  return (
    <>
      <SettingRow label="OSC" htmlFor="remote-osc" description="For apps that send OSC messages, such as TouchOSC.">
        <Switch
          id="remote-osc"
          checked={state.oscEnabled}
          onChange={(e) => void save('oscEnabled', { oscEnabled: e.target.checked })}
        />
      </SettingRow>
      {errors.oscEnabled && (
        <div className="px-4 py-2">
          <FieldError message={errors.oscEnabled} />
        </div>
      )}
      {state.oscEnabled && (
        <>
          <div className="px-4 py-3">
            <Notice tone="warn">
              Anyone on this network can send OSC cues. Only turn this on at church, not on public Wi-Fi.
            </Notice>
          </div>
          <SettingRow label="OSC port" htmlFor="remote-osc-port">
            <PortField
              id="remote-osc-port"
              saved={state.oscPort}
              error={errors.oscPort}
              onSave={(p) => save('oscPort', { oscPort: p })}
            />
          </SettingRow>
          <SettingRow
            label="Only accept OSC from (optional)"
            htmlFor="remote-osc-allow"
            description="Leave empty to accept OSC from any computer on this network."
            below={errors.oscAllowFrom ? <FieldError message={errors.oscAllowFrom} /> : undefined}
          >
            <Input
              id="remote-osc-allow"
              className="w-44"
              placeholder="e.g. 192.168.1.20"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => void commitAllow()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
              }}
            />
          </SettingRow>
        </>
      )}
    </>
  )
}
