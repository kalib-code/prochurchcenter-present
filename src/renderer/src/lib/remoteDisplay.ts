import type { RemoteFailure, RemoteSource } from '@shared/remote'

const FAILURE_TEXT: Record<RemoteFailure, string> = {
  'no-service': 'No service running',
  paused: 'Paused in Service Mode',
  'not-found': 'Not found (no such section, item or slide)',
  'not-a-song': "Current item isn't a song",
  timeout: "Present didn't answer in time",
  invalid: "Couldn't run that cue"
}

/** Plain-language reason a cue didn't run. */
export function failureText(reason: RemoteFailure): string {
  return FAILURE_TEXT[reason] ?? "Couldn't run that cue"
}

const SOURCE_TEXT: Record<RemoteSource, string> = { http: 'Web', osc: 'OSC', midi: 'MIDI' }

export function sourceLabel(source: RemoteSource): string {
  return SOURCE_TEXT[source] ?? source
}

/** Port field value -> valid port, or null. Accepts 1024-65535 integers only. */
export function parsePort(text: string): number | null {
  const t = text.trim()
  if (!/^\d+$/.test(t)) return null
  const n = Number(t)
  return n >= 1024 && n <= 65535 ? n : null
}

/** Strip Electron's IPC wrapper so operators see only the message. */
export function cleanIpcError(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err)
  return m.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
