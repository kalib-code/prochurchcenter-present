/**
 * Remote control controller — owns the HTTP and OSC listeners and the
 * state Settings shows. Mirrors main/mcp/index.ts: start/stop are
 * serialized through one promise chain so rapid toggles can't race for
 * a port.
 *
 * Each cue is forwarded to the operator window (which owns Service Mode)
 * and its result is returned to the caller; see dispatch.ts.
 *
 * Partial failure: if one listener fails (e.g. OSC port taken) the other
 * stays up, and status is 'error' with a message naming the failed part.
 */

import { createSocket, type Socket } from 'dgram'
import { networkInterfaces } from 'os'
import { CHANNELS } from '@shared/ipc-contract'
import {
  oscToCommand,
  type RemoteConfig,
  type RemoteResult,
  type RemoteState
} from '@shared/remote'
import { getOperatorWindow } from '../windows'
import { isValidPort, newToken } from '../mcp/config'
import { PortInUseError } from '../mcp/httpServer'
import { loadRemoteConfig, saveRemoteConfig } from './config'
import { startRemoteHttpServer } from './httpServer'
import { decodeOscPacket } from './osc'
import { createDispatcher } from './dispatch'

let config: RemoteConfig | null = null
let http: { port: number; close(): Promise<void> } | null = null
let osc: Socket | null = null
let status: RemoteState['status'] = 'off'
let error: string | null = null
let queue: Promise<unknown> = Promise.resolve()

const dispatcher = createDispatcher((msg) => {
  const win = getOperatorWindow()
  if (!win || win.isDestroyed()) return false
  win.webContents.send(CHANNELS.remote.eventCommand, msg)
  return true
})

function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn)
  queue = next.catch(() => {})
  return next
}

function sendState(): void {
  const win = getOperatorWindow()
  if (win && !win.isDestroyed()) win.webContents.send(CHANNELS.remote.eventState, getRemoteState())
}

function localAddresses(): string[] {
  const out: string[] = []
  for (const list of Object.values(networkInterfaces())) {
    for (const i of list ?? []) {
      if (i.family === 'IPv4' && !i.internal) out.push(i.address)
    }
  }
  return out
}

export function getRemoteState(): RemoteState {
  const c = config ?? normalizeFallback()
  return { ...c, status, error, addresses: localAddresses() }
}

function normalizeFallback(): RemoteConfig {
  return {
    enabled: false,
    scope: 'local',
    httpPort: 0,
    oscEnabled: false,
    oscPort: 0,
    midiEnabled: false,
    midiInput: null,
    midiChannel: 16,
    token: ''
  }
}

function hostFor(c: RemoteConfig): '127.0.0.1' | '0.0.0.0' {
  return c.scope === 'network' ? '0.0.0.0' : '127.0.0.1'
}

async function stopLocked(): Promise<void> {
  const h = http
  const o = osc
  http = null
  osc = null
  if (o) await new Promise<void>((res) => { try { o.close(() => res()) } catch { res() } })
  if (h) await h.close().catch((err) => console.error('[remote] http close failed', err))
}

function startOsc(c: RemoteConfig): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const sock = createSocket('udp4')
    let bound = false
    sock.on('error', (err: NodeJS.ErrnoException) => {
      if (!bound) return reject(err)
      console.error('[remote] osc socket error', err.message)
    })
    sock.on('message', (buf, rinfo) => {
      try {
        for (const m of decodeOscPacket(buf)) {
          const cmd = oscToCommand(m.address, m.args)
          if (cmd) void dispatcher.dispatch(cmd, 'osc', rinfo.address).catch(() => {})
        }
      } catch (err) {
        console.error('[remote] osc message failed', err)
      }
    })
    sock.bind(c.oscPort, hostFor(c), () => {
      bound = true
      resolve(sock)
    })
  })
}

async function startLocked(): Promise<void> {
  const c = config!
  await stopLocked()
  status = 'starting'
  error = null
  sendState()
  const problems: string[] = []
  try {
    http = await startRemoteHttpServer({
      host: hostFor(c),
      port: c.httpPort,
      token: c.token,
      dispatch: (cmd, from) => dispatcher.dispatch(cmd, 'http', from) as Promise<RemoteResult>
    })
    console.log(`[remote] http listening on ${hostFor(c)}:${http.port}`)
  } catch (err) {
    problems.push(
      err instanceof PortInUseError
        ? `Remote control port ${c.httpPort} is already in use. Choose a different port.`
        : `Remote control could not start: ${err instanceof Error ? err.message : String(err)}`
    )
    console.error('[remote] http start failed', err)
  }
  if (c.oscEnabled) {
    try {
      osc = await startOsc(c)
      console.log(`[remote] osc listening on ${hostFor(c)}:${c.oscPort}`)
    } catch (err) {
      const e = err as NodeJS.ErrnoException
      problems.push(
        e.code === 'EADDRINUSE'
          ? `OSC port ${c.oscPort} is already in use. Choose a different port.`
          : `OSC could not start: ${e.message}`
      )
      console.error('[remote] osc start failed', err)
    }
  }
  status = problems.length ? 'error' : 'running'
  error = problems.length ? problems.join(' ') : null
  sendState()
}

async function applyLocked(): Promise<void> {
  if (config!.enabled) {
    await startLocked()
  } else {
    await stopLocked()
    status = 'off'
    error = null
    sendState()
  }
}

/** Load config and start listeners if left on. Call once at startup. */
export function initRemote(): Promise<void> {
  return serialize(async () => {
    config = await loadRemoteConfig()
    await applyLocked()
  })
}

export function replyToCommand(id: string, result: RemoteResult): void {
  dispatcher.reply(id, result)
}

type Patch = Partial<Omit<RemoteConfig, 'token'>>
const LISTENER_KEYS = ['enabled', 'scope', 'httpPort', 'oscEnabled', 'oscPort'] as const

function validatePatch(p: unknown): Patch {
  if (!p || typeof p !== 'object') throw new Error('Invalid settings.')
  const r = p as Record<string, unknown>
  const out: Patch = {}
  for (const k of ['enabled', 'oscEnabled', 'midiEnabled'] as const) {
    if (k in r) {
      if (typeof r[k] !== 'boolean') throw new Error(`Invalid value for ${k}.`)
      out[k] = r[k] as boolean
    }
  }
  for (const k of ['httpPort', 'oscPort'] as const) {
    if (k in r) {
      if (!isValidPort(r[k])) throw new Error('Port must be a whole number from 1024 to 65535.')
      out[k] = r[k] as number
    }
  }
  if ('midiChannel' in r) {
    const ch = r.midiChannel
    if (typeof ch !== 'number' || !Number.isInteger(ch) || ch < 1 || ch > 16)
      throw new Error('MIDI channel must be a whole number from 1 to 16.')
    out.midiChannel = ch
  }
  if ('scope' in r) {
    if (r.scope !== 'local' && r.scope !== 'network') throw new Error('Invalid scope.')
    out.scope = r.scope
  }
  if ('midiInput' in r) {
    if (r.midiInput !== null && typeof r.midiInput !== 'string') throw new Error('Invalid MIDI input.')
    out.midiInput = r.midiInput as string | null
  }
  return out
}

export function updateRemote(patch: unknown): Promise<RemoteState> {
  return serialize(async () => {
    const valid = validatePatch(patch)
    const prev = config ?? (await loadRemoteConfig())
    config = { ...prev, ...valid }
    await saveRemoteConfig(config)
    if (LISTENER_KEYS.some((k) => config![k] !== prev[k])) await applyLocked()
    else sendState()
    return getRemoteState()
  })
}

export function regenerateRemoteToken(): Promise<RemoteState> {
  return serialize(async () => {
    config = { ...(config ?? (await loadRemoteConfig())), token: newToken() }
    await saveRemoteConfig(config)
    // Restart so the old token stops working immediately.
    if (config.enabled) await startLocked()
    else sendState()
    return getRemoteState()
  })
}

export function shutdownRemote(): Promise<void> {
  return serialize(async () => {
    await stopLocked()
    dispatcher.close()
  })
}
