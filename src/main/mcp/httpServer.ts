/**
 * The HTTP listener AI tools connect to: MCP Streamable HTTP on
 * 127.0.0.1 only.
 *
 * Three gates run before any MCP code sees a request:
 *
 *   1. Loopback bind — nothing off this computer can reach the port.
 *   2. Host header must be 127.0.0.1/localhost:<port>. Blocks DNS
 *      rebinding, where a web page re-points its own domain at
 *      127.0.0.1 to talk to local servers from the browser.
 *   3. Bearer token, compared in constant time. Any local program could
 *      otherwise write into the library.
 *
 * Requests carrying an Origin header are refused too: MCP clients
 * (Claude Code, Codex, mcp-remote) are not browsers, so an Origin means a
 * web page is trying, and there is no reason to let one in.
 *
 * Sessions are stateful (the SDK's standard pattern) so each connection
 * keeps the client's name from `initialize` — that is what lets
 * Settings say "Claude Code added …" instead of "something added …".
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { randomUUID, timingSafeEqual, createHash } from 'crypto'
import type { AddressInfo } from 'net'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import { MCP_PATH } from '@shared/mcp'

export interface McpHttpOptions {
  port: number
  token: string
  /** A fresh MCP server per session. */
  createMcpServer: () => McpServer
  maxBodyBytes: number
  /** Oldest sessions are closed past this; clients reconnect on their own. */
  maxSessions?: number
}

export interface RunningMcpHttp {
  port: number
  close(): Promise<void>
}

export class PortInUseError extends Error {}

interface Session {
  transport: StreamableHTTPServerTransport
  server: McpServer
}

function sha256(s: string): Buffer {
  return createHash('sha256').update(s).digest()
}

/** Constant-time, length-independent token check. */
export function tokenMatches(header: string | undefined, token: string): boolean {
  const m = /^Bearer\s+(.+)$/i.exec(header?.trim() ?? '')
  if (!m) return false
  return timingSafeEqual(sha256(m[1].trim()), sha256(token))
}

export function hostAllowed(host: string | undefined, port: number): boolean {
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`
}

function sendJson(res: ServerResponse, status: number, message: string, headers: Record<string, string> = {}): void {
  if (res.headersSent) return
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers })
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }))
}

class BodyTooLarge extends Error {}

async function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  if (Number(req.headers['content-length']) > maxBytes) throw new BodyTooLarge()
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > maxBytes) throw new BodyTooLarge()
    chunks.push(chunk as Buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  return text ? JSON.parse(text) : undefined
}

export async function startMcpHttpServer(opts: McpHttpOptions): Promise<RunningMcpHttp> {
  const sessions = new Map<string, Session>()
  const maxSessions = opts.maxSessions ?? 32
  let port = opts.port

  async function closeSession(id: string): Promise<void> {
    const s = sessions.get(id)
    if (!s) return
    sessions.delete(id)
    await s.transport.close().catch(() => {})
    await s.server.close().catch(() => {})
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = (req.url ?? '').split('?')[0]
    if (path !== MCP_PATH) return sendJson(res, 404, 'Not found. The MCP endpoint is ' + MCP_PATH)
    if (!hostAllowed(req.headers.host, port)) return sendJson(res, 403, 'Forbidden host.')
    if (req.headers.origin) return sendJson(res, 403, 'Browser requests are not allowed.')
    if (!tokenMatches(req.headers.authorization, opts.token)) {
      return sendJson(res, 401, 'Missing or wrong access token. Copy it from Present → Settings → Connections.', {
        'WWW-Authenticate': 'Bearer'
      })
    }

    const sessionHeader = req.headers['mcp-session-id']
    const sessionId = Array.isArray(sessionHeader) ? sessionHeader[0] : sessionHeader

    if (req.method === 'POST') {
      let body: unknown
      try {
        body = await readJsonBody(req, opts.maxBodyBytes)
      } catch (err) {
        if (err instanceof BodyTooLarge) {
          return sendJson(res, 413, `Request too large (limit ${Math.round(opts.maxBodyBytes / 1048576)} MB). For big decks, pass file_path instead of file_base64.`)
        }
        return sendJson(res, 400, 'Request body is not valid JSON.')
      }

      if (sessionId) {
        const s = sessions.get(sessionId)
        if (!s) return sendJson(res, 404, 'Session not found. Reconnect to start a new one.')
        return s.transport.handleRequest(req, res, body)
      }
      if (!isInitializeRequest(body)) {
        return sendJson(res, 400, 'No session. Send an initialize request first.')
      }

      // Cap concurrent sessions: a client that never sends DELETE (most
      // don't) would otherwise grow this map for as long as the app runs.
      while (sessions.size >= maxSessions) {
        const oldest = sessions.keys().next().value as string
        await closeSession(oldest)
      }

      const server = opts.createMcpServer()
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        maxRequestBodySize: opts.maxBodyBytes,
        onsessioninitialized: (id) => {
          sessions.set(id, { transport, server })
        },
        onsessionclosed: (id) => {
          sessions.delete(id)
        }
      })
      transport.onclose = () => {
        if (transport.sessionId) sessions.delete(transport.sessionId)
      }
      await server.connect(transport)
      return transport.handleRequest(req, res, body)
    }

    if (req.method === 'GET' || req.method === 'DELETE') {
      const s = sessionId ? sessions.get(sessionId) : undefined
      if (!s) return sendJson(res, sessionId ? 404 : 400, 'Session not found.')
      return s.transport.handleRequest(req, res)
    }

    res.writeHead(405, { Allow: 'GET, POST, DELETE' }).end()
  }

  const http: Server = createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error('[mcp] request failed', err)
      sendJson(res, 500, 'Internal error.')
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
    http.listen(opts.port, '127.0.0.1')
  })
  port = (http.address() as AddressInfo).port
  http.on('error', (err) => console.error('[mcp] server error', err))

  return {
    port,
    close: async () => {
      await Promise.all([...sessions.keys()].map(closeSession))
      await new Promise<void>((resolve) => {
        http.close(() => resolve())
        // Long-lived SSE streams would otherwise hold close() open.
        http.closeAllConnections()
      })
    }
  }
}
