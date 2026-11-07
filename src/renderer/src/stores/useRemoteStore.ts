import { create } from 'zustand'
import type { RemoteResult, RemoteSource } from '@shared/remote'

export interface RemoteActivity {
  at: string
  source: RemoteSource
  from: string | null
  summary: string
  result: RemoteResult
}

const ACTIVITY_CAP = 20

interface RemoteStore {
  paused: boolean
  activity: RemoteActivity[]
  lastMidi: string | null
  midiInputs: string[]
  midiError: string | null
  setPaused: (p: boolean) => void
  record: (a: RemoteActivity) => void
  setLastMidi: (s: string) => void
  setMidiStatus: (inputs: string[], error: string | null) => void
}

export const useRemoteStore = create<RemoteStore>((set) => ({
  paused: false,
  activity: [],
  lastMidi: null,
  midiInputs: [],
  midiError: null,
  setPaused: (paused) => set({ paused }),
  record: (a) => set((st) => ({ activity: [a, ...st.activity].slice(0, ACTIVITY_CAP) })),
  setLastMidi: (lastMidi) => set({ lastMidi }),
  setMidiStatus: (midiInputs, midiError) => set({ midiInputs, midiError })
}))

/**
 * Summary of the newest cue, or null. A primitive, so subscribers (the
 * Service Mode chip) don't re-render when an identical cue repeats.
 */
export const selectLastCueSummary = (s: Pick<RemoteStore, 'activity'>): string | null =>
  s.activity[0]?.summary ?? null
