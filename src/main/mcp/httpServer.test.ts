/**
 * Real HTTP on an ephemeral port: the gates in front of MCP, and a full
 * connect + tool call through the SDK's own HTTP client.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  hostAllowed,
  PortInUseError,
  startMcpHttpServer,
  tokenMatches,
  type RunningMcpHttp
} from './httpServer'

const TOKEN = 'test-token-0123456789-0123456789-abcdef'
let running: RunningMcpHttp
let url: string
const clientNames: (string | null)[] = []

function makeServer(): McpServer {
  const server = new McpServer({ name: 'present', version: 'test' })
  server.registerTool('ping', { description: 'ping' }, async () => {
    clientNames.push(server.server.getClientVersion()?.name ?? null)
    return { content: [{ type: 'text', text: 'pong' }] }
  })
  return server
}

beforeEach(async () => {
  running = await startMcpHttpServer({
    port: 0,
    token: TOKEN,
    createMcpServer: makeServer,
    maxBodyBytes: 1024 * 1024
  })
  url = `http://127.0.0.1:${running.port}/mcp`
})

afterEach(async () => {
  await running.close()
})

const initBody = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'curl', version: '1' } }
})

async function post(headers: Record<string, string>, body = initBody, target = url): Promise<Response> {
  return fetch(target, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers },
    body
  })
}

describe('MCP HTTP gates', () => {
  it('rejects a missing or wrong token', async () => {
    expect((await post({})).status).toBe(401)
    expect((await post({ Authorization: 'Bearer nope' })).status).toBe(401)
  })

  it('rejects browser requests', async () => {
    const res = await post({ Authorization: `Bearer ${TOKEN}`, Origin: 'https://evil.example' })
    expect(res.status).toBe(403)
  })

  it('rejects other paths and oversized bodies', async () => {
    const other = await post({ Authorization: `Bearer ${TOKEN}` }, initBody, url.replace('/mcp', '/x'))
    expect(other.status).toBe(404)
    const big = await post({ Authorization: `Bearer ${TOKEN}` }, 'x'.repeat(1024 * 1024 + 10))
    expect(big.status).toBe(413)
  })

  it('serves a real MCP client end to end and remembers its name', async () => {
    const client = new Client({ name: 'claude-code', version: '2.0.0' })
    await client.connect(
      new StreamableHTTPClientTransport(new URL(url), {
        requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } }
      })
    )
    const result = (await client.callTool({ name: 'ping', arguments: {} })) as {
      content: { text: string }[]
    }
    expect(result.content[0].text).toBe('pong')
    expect(clientNames.at(-1)).toBe('claude-code')
    await client.close()
  })

  it('reports a port that is already taken', async () => {
    await expect(
      startMcpHttpServer({ port: running.port, token: TOKEN, createMcpServer: makeServer, maxBodyBytes: 1 })
    ).rejects.toBeInstanceOf(PortInUseError)
  })
})

describe('gate helpers', () => {
  it('matches the bearer token exactly', () => {
    expect(tokenMatches(`Bearer ${TOKEN}`, TOKEN)).toBe(true)
    expect(tokenMatches(`bearer  ${TOKEN} `, TOKEN)).toBe(true)
    expect(tokenMatches(`Bearer ${TOKEN}x`, TOKEN)).toBe(false)
    expect(tokenMatches(TOKEN, TOKEN)).toBe(false)
    expect(tokenMatches(undefined, TOKEN)).toBe(false)
  })

  it('allows loopback hosts on our port only', () => {
    expect(hostAllowed('127.0.0.1:39217', 39217)).toBe(true)
    expect(hostAllowed('localhost:39217', 39217)).toBe(true)
    expect(hostAllowed('evil.example:39217', 39217)).toBe(false)
    expect(hostAllowed('127.0.0.1:80', 39217)).toBe(false)
    expect(hostAllowed(undefined, 39217)).toBe(false)
  })
})
