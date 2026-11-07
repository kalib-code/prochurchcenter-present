import { useEffect } from 'react'
import { midiToCommand, type RemoteState } from '@shared/remote'
import { executeRemoteCommand } from '../lib/remoteExecutor'
import { formatMidiMessage } from '../lib/midiFormat'
import { useRemoteStore } from '../stores/useRemoteStore'

/**
 * Operator window only, call once (App.tsx). Listens to Web MIDI inputs while remote control
 * and MIDI are enabled, and publishes the input list / error to useRemoteStore.
 */
export function useMidiInput(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return
    let disposed = false
    let state: RemoteState | null = null
    let access: MIDIAccess | null = null
    let requested = false
    const attached = new Set<MIDIInput>()

    const publish = (inputs: string[], error: string | null): void =>
      useRemoteStore.getState().setMidiStatus(inputs, error)

    const detachAll = (): void => {
      for (const input of attached) input.onmidimessage = null
      attached.clear()
    }

    const handle = (input: MIDIInput, e: MIDIMessageEvent): void => {
      try {
        const data = e.data
        if (!data || !state) return
        const text = formatMidiMessage(data)
        if (text === null) return
        useRemoteStore.getState().setLastMidi(text)
        const cmd = midiToCommand(data, state.midiChannel)
        if (cmd) executeRemoteCommand(cmd, 'midi', input.name ?? 'MIDI')
      } catch (err) {
        console.error('[remote] MIDI message failed', err)
      }
    }

    const sync = (): void => {
      if (disposed) return
      const active = !!state && state.enabled && state.midiEnabled
      if (!active || !access) {
        detachAll()
        if (!active) publish([], null)
        return
      }
      const all = Array.from(access.inputs.values())
      publish(all.map((i) => i.name ?? 'Unknown input'), null)
      const wanted = new Set(state!.midiInput === null ? all : all.filter((i) => i.name === state!.midiInput))
      for (const input of [...attached]) {
        if (!wanted.has(input)) {
          input.onmidimessage = null
          attached.delete(input)
        }
      }
      for (const input of wanted) {
        if (attached.has(input)) continue
        input.onmidimessage = (e) => handle(input, e)
        attached.add(input)
      }
    }

    const ensureAccess = async (): Promise<void> => {
      if (access || requested) return
      requested = true
      if (typeof navigator === 'undefined' || typeof navigator.requestMIDIAccess !== 'function') {
        publish([], 'Web MIDI is not available in this app.')
        return
      }
      try {
        const a = await navigator.requestMIDIAccess({ sysex: false })
        if (disposed) return
        access = a
        a.onstatechange = () => sync()
        sync()
      } catch (err) {
        console.error('[remote] MIDI access failed', err)
        requested = false
        if (!disposed) publish([], 'Could not access MIDI devices. Check system MIDI permissions.')
      }
    }

    const apply = (s: RemoteState): void => {
      state = s
      if (s.enabled && s.midiEnabled) void ensureAccess()
      sync()
    }

    void window.api.remote.getState().then((s) => { if (!disposed) apply(s) }).catch((err) => console.error('[remote] getState failed', err))
    const off = window.api.remote.onStateChange(apply)

    return () => {
      disposed = true
      off()
      detachAll()
      if (access) access.onstatechange = null
      publish([], null)
    }
  }, [enabled])
}
