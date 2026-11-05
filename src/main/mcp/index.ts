/**
 * AI connections controller — owns the MCP server's lifecycle and the
 * state Settings shows.
 *
 * Start/stop are serialized through one promise chain: the operator can
 * flip the switch faster than a listener opens or closes, and two
 * overlapping starts would race for the port.
 */

import { app } from 'electron'
import { CHANNELS } from '@shared/ipc-contract'
import { mcpUrl, type LibraryChange, type McpActivity, type McpState, type McpStatus } from '@shared/mcp'
import { getOperatorWindow } from '../windows'
import { getMediaDir } from '../storage/paths'
import { listSetlists, getSetlist, createSetlist, updateSetlist, insertSetlistItems } from '../storage/setlists'
import { listSongs, createSong } from '../storage/songs'
import { lookupScripture } from '../ipc/bible'
import { loadMcpConfig, newToken, saveMcpConfig, isValidPort, type McpConfig } from './config'
import { startMcpHttpServer, PortInUseError, type RunningMcpHttp } from './httpServer'
import { buildPresentServer } from './tools'
import { importPptx, MAX_PPTX_BYTES } from './importPptx'

const MAX_ACTIVITY = 20
// base64 inflates by 4/3; leave headroom for the JSON-RPC envelope.
const MAX_BODY_BYTES = Math.ceil(MAX_PPTX_BYTES * 1.4)

let config: McpConfig | null = null
let running: RunningMcpHttp | null = null
let status: McpStatus = 'off'
let error: string | null = null
const activity: McpActivity[] = []
let queue: Promise<unknown> = Promise.resolve()

function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn)
  queue = next.catch(() => {})
  return next
}

function sendToOperator(channel: string, payload: unknown): void {
  const win = getOperatorWindow()
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

function localDate(): string {
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function getMcpState(): McpState {
  const c = config ?? { enabled: false, port: 0, token: '' }
  return {
    enabled: c.enabled,
    status,
    port: c.port,
    url: mcpUrl(c.port),
    token: c.token,
    error,
    activity: [...activity]
  }
}

function broadcastState(): void {
  sendToOperator(CHANNELS.mcp.eventState, getMcpState())
}

function recordActivity(summary: string, client: string | null): void {
  activity.unshift({ at: new Date().toISOString(), client, summary })
  activity.length = Math.min(activity.length, MAX_ACTIVITY)
  broadcastState()
}

function broadcastLibraryChange(change: LibraryChange): void {
  sendToOperator(CHANNELS.library.eventExternalChange, change)
}

function createMcpServer() {
  return buildPresentServer({
    listSetlists,
    getSetlist,
    createSetlist: async ({ name, date, startTime }) => {
      const created = await createSetlist({ name, date })
      return startTime ? updateSetlist(created.id, { startTime }) : created
    },
    insertSetlistItems,
    listSongs,
    createSong,
    lookupScripture,
    importPptx: (src) => importPptx(src, getMediaDir()),
    onLibraryChange: broadcastLibraryChange,
    onActivity: recordActivity,
    today: localDate,
    appVersion: app.getVersion()
  })
}

async function stopLocked(): Promise<void> {
  if (running) {
    const r = running
    running = null
    await r.close().catch((err) => console.error('[mcp] close failed', err))
  }
}

async function startLocked(): Promise<void> {
  const c = config!
  await stopLocked()
  status = 'starting'
  error = null
  broadcastState()
  try {
    running = await startMcpHttpServer({
      port: c.port,
      token: c.token,
      createMcpServer,
      maxBodyBytes: MAX_BODY_BYTES
    })
    status = 'running'
    console.log(`[mcp] listening on ${mcpUrl(running.port)}`)
  } catch (err) {
    status = 'error'
    error =
      err instanceof PortInUseError
        ? `${err.message} Another app is using it — choose a different port below.`
        : `Could not start: ${err instanceof Error ? err.message : String(err)}`
    console.error('[mcp] start failed', err)
  }
  broadcastState()
}

async function applyLocked(): Promise<void> {
  if (config!.enabled) {
    await startLocked()
  } else {
    await stopLocked()
    status = 'off'
    error = null
    broadcastState()
  }
}

/** Load config and start the server if it was left on. Call once at startup. */
export function initMcp(): Promise<void> {
  return serialize(async () => {
    config = await loadMcpConfig()
    await applyLocked()
  })
}

export function setMcpEnabled(enabled: boolean): Promise<McpState> {
  return serialize(async () => {
    config = { ...(config ?? (await loadMcpConfig())), enabled }
    await saveMcpConfig(config)
    await applyLocked()
    return getMcpState()
  })
}

export function regenerateMcpToken(): Promise<McpState> {
  return serialize(async () => {
    config = { ...(config ?? (await loadMcpConfig())), token: newToken() }
    await saveMcpConfig(config)
    // Restart so the old token stops working immediately, and existing
    // sessions (authenticated with it) are closed.
    if (config.enabled) await startLocked()
    else broadcastState()
    return getMcpState()
  })
}

export function setMcpPort(port: number): Promise<McpState> {
  return serialize(async () => {
    if (!isValidPort(port)) throw new Error('Port must be a whole number from 1024 to 65535.')
    config = { ...(config ?? (await loadMcpConfig())), port }
    await saveMcpConfig(config)
    if (config.enabled) await startLocked()
    else broadcastState()
    return getMcpState()
  })
}

export function shutdownMcp(): Promise<void> {
  return serialize(stopLocked)
}
