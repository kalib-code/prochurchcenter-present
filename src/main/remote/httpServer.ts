/**
 * Token-protected HTTP control API for remote cues.
 *
 *   POST /api/v1/command   JSON RemoteCommand body
 *   GET  /api/v1/status    same as the `status` command
 *
 * Gates, in order: path, Origin (browsers are refused), bearer token,
 * then method and body. There is deliberately no Host-header check:
 * LAN clients reach this by the machine's IP, and the token is the gate.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import type { AddressInfo } from 'net'
import { parseRemoteCommand, type RemoteCommand, type RemoteResult } from '@shared/remote'
import { PortInUseError, tokenMatches } from '../mcp/httpServer'

const COMMAND_PATH = '/api/v1/command'
const STATUS_PATH = '/api/v1/status'
const MAX_BODY_BYTES = 4096

export interface RemoteHttpOptions {
  host: '127.0.0.1' | '0.0.0.0'
  port: number
  token: string
  dispatch: (cmd: RemoteCommand, from: string | null) => Promise<RemoteResult>
}

class BodyTooLarge extends Error {}

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  if (res.headersSent) return
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers })
  res.end(JSON.stringify(body))
}

async function readBody(req: IncomingMessage): Promise<string> {
  if (Number(req.headers['content-length']) > MAX_BODY_BYTES) throw new BodyTooLarge()
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > MAX_BODY_BYTES) throw new BodyTooLarge()
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

export async function startRemoteHttpServer(
  opts: RemoteHttpOptions
): Promise<{ port: number; close(): Promise<void> }> {
  async function run(cmd: RemoteCommand, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const from = req.socket.remoteAddress?.replace(/^::ffff:/, '') ?? null
    let result: RemoteResult
    try {
      result = await opts.dispatch(cmd, from)
    } catch (err) {
      console.error('[remote] dispatch failed', err)
      return sendJson(res, 500, { ok: false, reason: 'invalid' })
    }
    sendJson(res, result.ok ? 200 : 409, result)
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = (req.url ?? '').split('?')[0]
    if (path !== COMMAND_PATH && path !== STATUS_PATH) {
      return sendJson(res, 404, { ok: false, reason: 'not-found' })
    }
    if (req.headers.origin) return sendJson(res, 403, { ok: false, reason: 'forbidden' })
    if (!tokenMatches(req.headers.authorization, opts.token)) {
      return sendJson(res, 401, { ok: false, reason: 'unauthorized' }, { 'WWW-Authenticate': 'Bearer' })
    }

    if (path === STATUS_PATH) {
      if (req.method !== 'GET') return sendJson(res, 405, { ok: false, reason: 'method' }, { Allow: 'GET' })
      return run({ type: 'status' }, req, res)
    }

    if (req.method !== 'POST') return sendJson(res, 405, { ok: false, reason: 'method' }, { Allow: 'POST' })
    let text: string
    try {
      text = await readBody(req)
    } catch {
      return sendJson(res, 413, { ok: false, reason: 'too-large' })
    }
    let cmd: RemoteCommand | null = null
    try {
      cmd = parseRemoteCommand(JSON.parse(text))
    } catch {
      // Not JSON: falls through to 400.
    }
    if (!cmd) return sendJson(res, 400, { ok: false, reason: 'invalid' })
    return run(cmd, req, res)
  }

  const http: Server = createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error('[remote] request failed', err)
      sendJson(res, 500, { ok: false, reason: 'invalid' })
    })
  })

  await new Promise<void>((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException): void => {
      http.off('listening', onListening)
      reject(err.code === 'EADDRINUSE' ? new PortInUseError(`Port ${opts.port} is already in use.`) : err)
    }
    const onListening = (): void => {
      http.off('error', onError)
      resolve()
    }
    http.once('error', onError)
    http.once('listening', onListening)
    http.listen(opts.port, opts.host)
  })
  http.on('error', (err) => console.error('[remote] server error', err))

  return {
    port: (http.address() as AddressInfo).port,
    close: () =>
      new Promise<void>((resolve) => {
        http.close(() => resolve())
        http.closeAllConnections()
      })
  }
}
