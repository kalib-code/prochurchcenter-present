import { describe, expect, it } from 'vitest'
import { appBundlePath, isDeveloperIdSigned } from './macSignature'

describe('isDeveloperIdSigned', () => {
  it('accepts a Developer ID Application signature', () => {
    const out = [
      'Executable=/Applications/ProChurchCenter Present.app/Contents/MacOS/ProChurchCenter Present',
      'Identifier=com.prochurchcenter.present',
      'Authority=Developer ID Application: ProChurchCenter (ABCDE12345)',
      'Authority=Developer ID Certification Authority',
      'Authority=Apple Root CA',
      'TeamIdentifier=ABCDE12345'
    ].join('\n')
    expect(isDeveloperIdSigned(out)).toBe(true)
  })

  it('rejects the ad-hoc signature unsigned arm64 builds carry', () => {
    const out = [
      'Executable=/Applications/ProChurchCenter Present.app/Contents/MacOS/ProChurchCenter Present',
      'Identifier=com.prochurchcenter.present',
      'Signature=adhoc',
      'TeamIdentifier=not set'
    ].join('\n')
    expect(isDeveloperIdSigned(out)).toBe(false)
  })

  it('rejects other certificate types and codesign errors', () => {
    expect(isDeveloperIdSigned('Authority=Apple Development: someone@example.com (XYZ)')).toBe(false)
    expect(isDeveloperIdSigned('/Applications/X.app: code object is not signed at all')).toBe(false)
    expect(isDeveloperIdSigned('')).toBe(false)
  })
})

describe('appBundlePath', () => {
  it('climbs from the executable to the .app bundle', () => {
    expect(
      appBundlePath('/Applications/ProChurchCenter Present.app/Contents/MacOS/ProChurchCenter Present')
    ).toBe('/Applications/ProChurchCenter Present.app')
  })
})
