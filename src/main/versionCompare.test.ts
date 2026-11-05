import { describe, expect, it } from 'vitest'
import { compareVersions, isNewerVersion } from './versionCompare'

describe('compareVersions', () => {
  it('orders core versions numerically, not lexically', () => {
    expect(compareVersions('0.1.10', '0.1.9')).toBe(1)
    expect(compareVersions('0.2.0', '0.10.0')).toBe(-1)
    expect(compareVersions('1.0.0', '0.99.99')).toBe(1)
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0)
  })

  it('tolerates a leading v and ignores build metadata', () => {
    expect(compareVersions('v1.2.3', '1.2.3')).toBe(0)
    expect(compareVersions('1.2.3+build.7', '1.2.3')).toBe(0)
  })

  it('ranks prereleases below the release they precede', () => {
    expect(compareVersions('1.0.0-beta', '1.0.0')).toBe(-1)
    expect(compareVersions('1.0.0', '1.0.0-rc.1')).toBe(1)
    expect(compareVersions('1.0.1-alpha', '1.0.0')).toBe(1)
  })

  it('follows semver precedence between prereleases', () => {
    const ordered = [
      '1.0.0-alpha',
      '1.0.0-alpha.1',
      '1.0.0-alpha.beta',
      '1.0.0-beta',
      '1.0.0-beta.2',
      '1.0.0-beta.11',
      '1.0.0-rc.1',
      '1.0.0'
    ]
    for (let i = 0; i < ordered.length - 1; i++) {
      expect(compareVersions(ordered[i], ordered[i + 1])).toBe(-1)
      expect(compareVersions(ordered[i + 1], ordered[i])).toBe(1)
    }
  })

  it('returns null for unparseable input', () => {
    expect(compareVersions('latest', '1.0.0')).toBeNull()
    expect(compareVersions('1.0', '1.0.0')).toBeNull()
  })
})

describe('isNewerVersion', () => {
  it('is true only for strictly newer versions', () => {
    expect(isNewerVersion('0.1.3', '0.1.2')).toBe(true)
    expect(isNewerVersion('0.1.2', '0.1.2')).toBe(false)
    // A rolled-back / older release on the feed must not read as an update.
    expect(isNewerVersion('0.1.1', '0.1.2')).toBe(false)
    expect(isNewerVersion('garbage', '0.1.2')).toBe(false)
  })
})
