/**
 * Remote-control config — `<userData>/remote.json`.
 *
 * Per computer and kept out of backups for the same reason as mcp.json:
 * the token is a standing grant to drive this computer's presentation.
 */

import { chmod, readFile } from 'fs/promises'
import { join } from 'path'
import { app } from 'electron'
import {
  REMOTE_HTTP_DEFAULT_PORT,
  REMOTE_MIDI_DEFAULT_CHANNEL,
  REMOTE_OSC_DEFAULT_PORT,
  type RemoteConfig
} from '@shared/remote'
import { atomicWriteJson } from '../storage/atomic'
import { isValidPort, newToken } from '../mcp/config'

function configPath(): string {
  return join(app.getPath('userData'), 'remote.json')
}

/** Fill gaps in a stored config; never throws on a damaged file. */
export function normalizeRemoteConfig(raw: unknown): RemoteConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof RemoteConfig, unknown>>
  const ch = r.midiChannel
  return {
    enabled: r.enabled === true,
    scope: r.scope === 'network' ? 'network' : 'local',
    httpPort: isValidPort(r.httpPort) ? r.httpPort : REMOTE_HTTP_DEFAULT_PORT,
    oscEnabled: r.oscEnabled === true,
    // TCP (HTTP) and UDP (OSC) don't collide, so equal ports are fine.
    oscPort: isValidPort(r.oscPort) ? r.oscPort : REMOTE_OSC_DEFAULT_PORT,
    midiEnabled: r.midiEnabled === true,
    midiInput: typeof r.midiInput === 'string' && r.midiInput ? r.midiInput : null,
    midiChannel:
      typeof ch === 'number' && Number.isInteger(ch) && ch >= 1 && ch <= 16
        ? ch
        : REMOTE_MIDI_DEFAULT_CHANNEL,
    token: typeof r.token === 'string' && r.token.length >= 32 ? r.token : newToken()
  }
}

/** Owner read/write only: the token is a credential. No-op on Windows. */
const CONFIG_MODE = 0o600

export async function loadRemoteConfig(): Promise<RemoteConfig> {
  await chmod(configPath(), CONFIG_MODE).catch(() => {})
  let raw: unknown = null
  try {
    raw = JSON.parse(await readFile(configPath(), 'utf8'))
  } catch {
    // Missing or unreadable: start from defaults (off, fresh token).
  }
  const config = normalizeRemoteConfig(raw)
  // Persist a generated token straight away so the one shown in Settings
  // is the one that still works after a restart.
  if (JSON.stringify(raw) !== JSON.stringify(config)) await saveRemoteConfig(config)
  return config
}

export async function saveRemoteConfig(config: RemoteConfig): Promise<void> {
  await atomicWriteJson(configPath(), config, { mode: CONFIG_MODE })
}
