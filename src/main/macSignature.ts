/**
 * macSignature — can this macOS build install its own updates?
 *
 * Squirrel.Mac (which electron-updater drives on macOS) only applies an
 * update whose code signature satisfies the running app's designated
 * requirement. That only works for apps signed with an Apple
 * "Developer ID Application" certificate. Unsigned builds, and the
 * ad-hoc signature the arm64 linker adds automatically, fail that
 * check, so the update downloads and then never installs.
 *
 * We detect this at runtime instead of hard-coding it, so the day the
 * build is signed (RELEASING.md, Phase 10b) real auto-updates switch on
 * with no code change.
 */

import { execFile } from 'child_process'
import { posix } from 'path'

/**
 * Pure parser for `codesign -dv --verbose=2` output (which codesign
 * writes to stderr). True only for a Developer ID signature: ad-hoc
 * signatures print `Signature=adhoc` and no Authority lines.
 */
export function isDeveloperIdSigned(codesignOutput: string): boolean {
  return /^Authority=Developer ID Application:/m.test(codesignOutput)
}

/**
 * The `.app` bundle that contains the running executable:
 * `<Bundle>.app/Contents/MacOS/<exe>` → `<Bundle>.app`.
 *
 * Always POSIX: this only ever handles macOS paths, but the test suite
 * also runs on the Windows CI runner, where plain `path.resolve` would
 * turn `/Applications/...` into `D:\Applications\...`.
 */
export function appBundlePath(exePath: string): string {
  return posix.resolve(exePath, '..', '..', '..')
}

/**
 * Asks `codesign` about the running app. Resolves false on any failure
 * (codesign missing, unsigned binary, timeout): when unsure, assume we
 * can't self-update and point the user at the download page instead.
 */
export function canSelfUpdateOnMac(exePath: string): Promise<boolean> {
  return new Promise((done) => {
    execFile(
      'codesign',
      ['-dv', '--verbose=2', appBundlePath(exePath)],
      { timeout: 5_000 },
      (_err, stdout, stderr) => done(isDeveloperIdSigned(`${stdout}\n${stderr}`))
    )
  })
}
