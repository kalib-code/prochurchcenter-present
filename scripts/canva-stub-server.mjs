/**
 * Local stand-in for the production Canva OAuth proxy.
 *
 * Implements the exact contract in
 * docs/superpowers/specs/2026-07-25-canva-setlist-import-design.md and
 * talks to the real Canva API, so it doubles as the reference
 * implementation for the deployed backend.
 *
 * Stateless by design: it holds the client secret and proxies two
 * exchanges. It never stores user tokens.
 *
 * Usage:
 *   CANVA_CLIENT_ID=... CANVA_CLIENT_SECRET=... node scripts/canva-stub-server.mjs
 *
 * Register http://127.0.0.1:8787/canva/callback as a redirect URL in
 * your Canva developer integration.
 */

import { createServer } from 'node:http'
import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto'

const PORT = 8787
const BASE = `http://127.0.0.1:${PORT}`
const CLIENT_ID = process.env.CANVA_CLIENT_ID
const CLIENT_SECRET = process.env.CANVA_CLIENT_SECRET
// Generated at startup: each invocation creates a new key, invalidating any
// in-flight authorization flows from the previous run. This prevents key
// reuse across deployments and ensures the stub cannot be used as a reference
// implementation if copied into a production environment without explicit
// key configuration.
//
// PRODUCTION: this is correct for a single, disposable dev process and
// WRONG for any restartable or multi-replica deployment — a restart
// invalidates every in-flight authorization flow, and two replicas behind
// a load balancer will never agree on a key, so a callback landing on the
// "wrong" replica fails verifyState() outright. The real backend must read
// its signing key from configuration (a secret store / env var provisioned
// at deploy time) and refuse to start if it is missing, rather than
// falling back to a per-process random value like this stub does.
const SIGNING_KEY = randomBytes(32)

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Set CANVA_CLIENT_ID and CANVA_CLIENT_SECRET.')
  process.exit(1)
}

const AUTHORIZE_URL = 'https://www.canva.com/api/oauth/authorize'
const TOKEN_URL = 'https://api.canva.com/rest/v1/oauth/token'
const REDIRECT_URI = `${BASE}/canva/callback`
const STATE_TTL_MS = 10 * 60 * 1000

const b64url = (buf) => Buffer.from(buf).toString('base64url')

function signState(payload) {
  const body = b64url(JSON.stringify(payload))
  const sig = createHmac('sha256', SIGNING_KEY).update(body).digest('base64url')
  return `${body}.${sig}`
}

function verifyState(token) {
  const [body, sig] = String(token ?? '').split('.')
  if (!body || !sig) return null
  const expected = createHmac('sha256', SIGNING_KEY).update(body).digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString())
  if (typeof payload.iat !== 'number' || Date.now() - payload.iat > STATE_TTL_MS) return null
  return payload
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (c) => {
      raw += c
      if (raw.length > 1e6) {
        // Stop the socket from buffering further chunks past the limit —
        // rejecting the promise alone doesn't stop `data` events from
        // continuing to arrive and accumulate in `raw`.
        req.destroy()
        reject(new Error('body too large'))
      }
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}'))
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

async function exchange(params) {
  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams(params)
  })
  return { ok: res.ok, status: res.status, data: await res.json() }
}

const send = (res, status, obj) => {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(obj))
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, BASE)

  try {
    if (req.method === 'GET' && url.pathname === '/canva/start') {
      const challenge = url.searchParams.get('challenge')
      const state = url.searchParams.get('state')
      const port = Number(url.searchParams.get('port'))
      if (!challenge || !state || !Number.isInteger(port) || port < 1024 || port > 65535) {
        return send(res, 400, { error: 'invalid_request' })
      }
      const authorize = new URL(AUTHORIZE_URL)
      authorize.searchParams.set('client_id', CLIENT_ID)
      authorize.searchParams.set('redirect_uri', REDIRECT_URI)
      authorize.searchParams.set('response_type', 'code')
      authorize.searchParams.set('scope', 'design:meta:read design:content:read profile:read')
      authorize.searchParams.set('code_challenge', challenge)
      authorize.searchParams.set('code_challenge_method', 'S256')
      authorize.searchParams.set('state', signState({ appState: state, port, iat: Date.now() }))
      res.writeHead(302, { Location: authorize.toString() })
      return res.end()
    }

    if (req.method === 'GET' && url.pathname === '/canva/callback') {
      const payload = verifyState(url.searchParams.get('state'))
      if (!payload) return send(res, 400, { error: 'invalid_state' })
      const target = new URL(`http://127.0.0.1:${payload.port}/callback`)
      const error = url.searchParams.get('error')
      if (error) target.searchParams.set('error', error)
      else target.searchParams.set('code', url.searchParams.get('code') ?? '')
      target.searchParams.set('state', payload.appState)
      res.writeHead(302, { Location: target.toString() })
      return res.end()
    }

    if (req.method === 'POST' && url.pathname === '/canva/token') {
      const { code, code_verifier: verifier } = await readJsonBody(req)
      if (!code || !verifier) return send(res, 400, { error: 'invalid_request' })
      const r = await exchange({
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        redirect_uri: REDIRECT_URI
      })
      return send(res, r.ok ? 200 : r.status === 400 ? 400 : 502, r.data)
    }

    if (req.method === 'POST' && url.pathname === '/canva/refresh') {
      const { refresh_token: refreshToken } = await readJsonBody(req)
      if (!refreshToken) return send(res, 400, { error: 'invalid_request' })
      const r = await exchange({ grant_type: 'refresh_token', refresh_token: refreshToken })
      return send(res, r.ok ? 200 : r.status === 400 ? 400 : 502, r.data)
    }

    send(res, 404, { error: 'not_found' })
  } catch (err) {
    // Deliberately does not echo the error body — it can contain tokens.
    console.error('[canva-stub]', err.message)
    send(res, 500, { error: 'server_error' })
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[canva-stub] listening on ${BASE}`)
  console.log(`[canva-stub] register redirect URL: ${REDIRECT_URI}`)
})
