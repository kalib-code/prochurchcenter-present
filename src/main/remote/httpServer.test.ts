import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { RemoteCommand, RemoteResult } from '@shared/remote'
import { createServer } from 'http'
import { applyHttpLimits, startRemoteHttpServer } from './httpServer'

const TOKEN = 'test-token-0123456789-0123456789-abcdef'
const OK: RemoteResult = { ok: true, position: null }

let running: { port: number; close(): Promise<void> }
let calls: { cmd: RemoteCommand; from: string | null }[]
let result: RemoteResult
let throws: boolean
let base: string

beforeEach(async () => {
  calls = []
  result = OK
  throws = false
  running = await startRemoteHttpServer({
    host: '127.0.0.1',
    port: 0,
    token: TOKEN,
    dispatch: async (cmd, from) => {
      if (throws) throw new Error('boom')
      calls.push({ cmd, from })
      return result
    }
  })
  base = `http://127.0.0.1:${running.port}`
})

afterEach(async () => {
  await running.close()
})

const auth = { Authorization: `Bearer ${TOKEN}` }
const post = (body: string, headers: Record<string, string> = auth): Promise<Response> =>
  fetch(`${base}/api/v1/command`, { method: 'POST', headers, body })

describe('remote http server', () => {
  it('dispatches a valid command', async () => {
    const res = await post('{"type":"next"}')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(await res.json()).toEqual(OK)
    expect(calls).toEqual([{ cmd: { type: 'next' }, from: '127.0.0.1' }])
  })

  it('rejects missing or wrong tokens without dispatching', async () => {
    const none = await post('{"type":"next"}', {})
    expect(none.status).toBe(401)
    expect(none.headers.get('www-authenticate')).toBe('Bearer')
    const bad = await post('{"type":"next"}', { Authorization: 'Bearer nope' })
    expect(bad.status).toBe(401)
    expect(calls).toHaveLength(0)
  })

  it('rejects requests with an Origin header', async () => {
    const res = await post('{"type":"next"}', { ...auth, Origin: 'http://evil.example' })
    expect(res.status).toBe(403)
    expect(calls).toHaveLength(0)
  })

  it('returns 400 for invalid commands and non-JSON', async () => {
    for (const body of ['{"type":"nope"}', 'not json']) {
      const res = await post(body)
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ ok: false, reason: 'invalid' })
    }
    expect(calls).toHaveLength(0)
  })

  it('returns 413 for bodies over 4096 bytes', async () => {
    const res = await post(JSON.stringify({ type: 'goToSection', section: 'a'.repeat(5000) }))
    expect(res.status).toBe(413)
    expect(calls).toHaveLength(0)
  })

  it('returns 409 with the body when dispatch fails', async () => {
    result = { ok: false, reason: 'no-service' }
    const res = await post('{"type":"next"}')
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual(result)
  })

  it('GET /api/v1/status dispatches status', async () => {
    const res = await fetch(`${base}/api/v1/status`, { headers: auth })
    expect(res.status).toBe(200)
    expect(calls[0].cmd).toEqual({ type: 'status' })
  })

  it('404 for unknown paths, 405 for wrong methods', async () => {
    expect((await fetch(`${base}/nope`, { headers: auth })).status).toBe(404)
    const put = await fetch(`${base}/api/v1/command`, { method: 'PUT', headers: auth, body: '{}' })
    expect(put.status).toBe(405)
    expect(put.headers.get('allow')).toBe('POST')
    const postStatus = await fetch(`${base}/api/v1/status`, { method: 'POST', headers: auth })
    expect(postStatus.status).toBe(405)
    expect(postStatus.headers.get('allow')).toBe('GET')
  })

  it('returns 500 when dispatch throws', async () => {
    throws = true
    const res = await post('{"type":"next"}')
    expect(res.status).toBe(500)
    const again = await post('{"type":"next"}')
    expect(again.status).toBe(500)
  })
})

describe('remote http socket limits', () => {
  it('sets timeouts and a connection cap on the server', () => {
    const server = createServer()
    applyHttpLimits(server)
    expect(server.headersTimeout).toBe(10_000)
    expect(server.requestTimeout).toBe(10_000)
    expect(server.keepAliveTimeout).toBe(5_000)
    expect(server.maxConnections).toBe(32)
  })
})
