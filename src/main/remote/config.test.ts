import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '' } }))

import { normalizeRemoteConfig } from './config'

describe('normalizeRemoteConfig', () => {
  it('fills defaults from an empty object', () => {
    const c = normalizeRemoteConfig({})
    expect(c).toMatchObject({
      enabled: false,
      scope: 'local',
      httpPort: 39218,
      oscEnabled: false,
      oscPort: 39219,
      midiEnabled: false,
      midiInput: null,
      midiChannel: 16,
      oscAllowFrom: null
    })
    expect(c.token.length).toBeGreaterThanOrEqual(32)
  })

  it('falls back on invalid values', () => {
    expect(normalizeRemoteConfig({ midiChannel: 0 }).midiChannel).toBe(16)
    expect(normalizeRemoteConfig({ midiChannel: 17 }).midiChannel).toBe(16)
    expect(normalizeRemoteConfig({ scope: 'x' }).scope).toBe('local')
    expect(normalizeRemoteConfig({ httpPort: 80 }).httpPort).toBe(39218)
    expect(normalizeRemoteConfig(null).enabled).toBe(false)
  })

  it('keeps valid values, including osc port equal to http port', () => {
    const c = normalizeRemoteConfig({
      enabled: true, scope: 'network', httpPort: 40000, oscPort: 40000,
      midiEnabled: true, midiInput: 'IAC', midiChannel: 3, token: 'x'.repeat(40)
    })
    expect(c).toMatchObject({ enabled: true, scope: 'network', httpPort: 40000, oscPort: 40000, midiInput: 'IAC', midiChannel: 3 })
    expect(c.token).toBe('x'.repeat(40))
  })

  it('keeps only a valid trimmed IPv4 oscAllowFrom', () => {
    expect(normalizeRemoteConfig({ oscAllowFrom: ' 10.0.0.5 ' }).oscAllowFrom).toBe('10.0.0.5')
    expect(normalizeRemoteConfig({ oscAllowFrom: 'nope' }).oscAllowFrom).toBeNull()
    expect(normalizeRemoteConfig({ oscAllowFrom: 5 }).oscAllowFrom).toBeNull()
  })
})
