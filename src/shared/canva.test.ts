import { describe, it, expect } from 'vitest'
import {
  unixSecondsToIso,
  isDesignStale,
  generateCodeVerifier,
  deriveCodeChallenge,
  buildExportRequestBody,
  nextPollDelayMs
} from './canva'
import type { CanvaOrigin } from './types'

describe('unixSecondsToIso', () => {
  it('converts Unix seconds to an ISO 8601 string', () => {
    expect(unixSecondsToIso(1700000000)).toBe('2023-11-14T22:13:20.000Z')
  })

  it('treats the epoch as a valid instant, not as missing data', () => {
    expect(unixSecondsToIso(0)).toBe('1970-01-01T00:00:00.000Z')
  })

  it('throws on values that are not finite numbers', () => {
    expect(() => unixSecondsToIso(Number.NaN)).toThrow()
    expect(() => unixSecondsToIso(Number.POSITIVE_INFINITY)).toThrow()
  })
})

describe('isDesignStale', () => {
  const origin: CanvaOrigin = {
    designId: 'DAF123',
    designUpdatedAt: '2023-11-14T22:13:20.000Z',
    importedAt: '2023-11-14T22:20:00.000Z'
  }

  it('is stale when Canva reports a newer edit', () => {
    expect(isDesignStale(origin, 1700000001)).toBe(true)
  })

  it('is not stale when the timestamps match exactly', () => {
    expect(isDesignStale(origin, 1700000000)).toBe(false)
  })

  it('is not stale when Canva reports an older timestamp', () => {
    expect(isDesignStale(origin, 1699999999)).toBe(false)
  })

  it('is not stale when the stored timestamp is unparseable', () => {
    // Never badge on corrupt data — a spurious "updated" badge before a
    // service is worse than silently missing one.
    const corrupt = { ...origin, designUpdatedAt: 'not-a-date' }
    expect(isDesignStale(corrupt, 1700000001)).toBe(false)
  })
})

describe('PKCE', () => {
  it('generates a verifier within RFC 7636 length bounds', () => {
    const v = generateCodeVerifier()
    expect(v.length).toBeGreaterThanOrEqual(43)
    expect(v.length).toBeLessThanOrEqual(128)
  })

  it('generates unpadded base64url verifiers only', () => {
    expect(generateCodeVerifier()).toMatch(/^[A-Za-z0-9\-._~]+$/)
  })

  it('generates a different verifier each call', () => {
    expect(generateCodeVerifier()).not.toBe(generateCodeVerifier())
  })

  it('derives the RFC 7636 reference S256 challenge', async () => {
    // Verifier and expected challenge from RFC 7636 Appendix B.
    const challenge = await deriveCodeChallenge(
      'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
    )
    expect(challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })

  it('derives a challenge with no base64 padding', async () => {
    const challenge = await deriveCodeChallenge(generateCodeVerifier())
    expect(challenge).not.toContain('=')
    expect(challenge).toMatch(/^[A-Za-z0-9\-_]+$/)
  })
})

describe('buildExportRequestBody', () => {
  it('requests a PDF export for the given design', () => {
    expect(buildExportRequestBody('DAF123')).toEqual({
      design_id: 'DAF123',
      format: { type: 'pdf', export_quality: 'regular' }
    })
  })

  it('never sends `size` — it reflows 16:9 slides to paper proportions', () => {
    // Regression pin. This failure mode is silent: the export succeeds,
    // the import reports success, and every slide is letterboxed.
    const body = buildExportRequestBody('DAF123')
    expect(body.format).not.toHaveProperty('size')
    expect(JSON.stringify(body)).not.toContain('size')
  })

  it('never requests pro quality — it fails on free Canva accounts', () => {
    expect(buildExportRequestBody('DAF123').format.export_quality).toBe('regular')
  })
})

describe('nextPollDelayMs', () => {
  it('starts fast so short exports feel immediate', () => {
    expect(nextPollDelayMs(0)).toBe(1000)
  })

  it('backs off to a steady cadence rather than growing without bound', () => {
    expect(nextPollDelayMs(5)).toBe(5000)
    expect(nextPollDelayMs(10)).toBe(5000)
  })

  it('returns null once the cumulative budget is exhausted', () => {
    expect(nextPollDelayMs(999)).toBeNull()
  })

  it('never returns a zero or negative delay, which would busy-loop', () => {
    for (let i = 0; i < 50; i++) {
      const d = nextPollDelayMs(i)
      if (d !== null) expect(d).toBeGreaterThan(0)
    }
  })
})
