import type { RemoteState } from '@shared/remote'
import { Select } from '../ui/Input'
import { SettingRow, Switch } from '../settings/SettingsKit'
import { useRemoteStore } from '../../stores/useRemoteStore'
import { useRemoteSave } from './useRemoteState'

const CHANNELS = Array.from({ length: 16 }, (_, i) => i + 1)

export function RemoteMidiSection({
  state,
  setState
}: {
  state: RemoteState
  setState: (s: RemoteState) => void
}): JSX.Element {
  const { error, save } = useRemoteSave(setState)
  // MIDI listening itself is attached once in App; here we only read what it found.
  const inputs = useRemoteStore((s) => s.midiInputs)
  const midiError = useRemoteStore((s) => s.midiError)
  const lastMidi = useRemoteStore((s) => s.lastMidi)

  // Keep a saved-but-unplugged device visible so the select doesn't lie.
  const options = state.midiInput && !inputs.includes(state.midiInput) ? [...inputs, state.midiInput] : inputs

  return (
    <>
      <SettingRow label="MIDI" htmlFor="remote-midi" description="For keyboards, pads, and playback apps that send MIDI.">
        <Switch
          id="remote-midi"
          checked={state.midiEnabled}
          onChange={(e) => void save({ midiEnabled: e.target.checked })}
        />
      </SettingRow>
      {state.midiEnabled && (
        <>
          <SettingRow label="MIDI input" htmlFor="remote-midi-input">
            <Select
              id="remote-midi-input"
              className="w-56"
              value={state.midiInput ?? ''}
              onChange={(e) => void save({ midiInput: e.target.value || null })}
            >
              <option value="">All inputs</option>
              {options.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </Select>
          </SettingRow>
          <SettingRow label="MIDI channel" htmlFor="remote-midi-channel">
            <Select
              id="remote-midi-channel"
              className="w-24"
              value={state.midiChannel}
              onChange={(e) => void save({ midiChannel: Number(e.target.value) })}
            >
              {CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </SettingRow>
          <div className="space-y-1 px-4 py-3 text-[12.5px] text-muted-foreground">
            {midiError && (
              <p role="alert" className="text-warn">
                {midiError}
              </p>
            )}
            {error && (
              <p role="alert" className="text-warn">
                {error}
              </p>
            )}
            <p>Last MIDI message: {lastMidi ?? 'none yet'}</p>
          </div>
        </>
      )}
    </>
  )
}
