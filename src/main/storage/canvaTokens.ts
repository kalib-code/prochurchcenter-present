/**
 * Canva OAuth token persistence.
 *
 * Deliberately does NOT follow the plain-JSON pattern used by settings,
 * themes, songs, and setlists. A refresh token is a standing grant to
 * someone's entire Canva account — categorically different from a theme
 * — so it is encrypted with Electron's safeStorage, which binds to the
 * OS keychain on macOS and DPAPI on Windows.
 *
 * On systems where safeStorage is unavailable (some Linux desktops with
 * no keyring), we report the connection as unavailable rather than
 * silently writing a refresh token to disk in plaintext. Refusing to
 * store the credential is the correct failure here.
 */

import { safeStorage } from 'electron'
import { readFile, rm } from 'fs/promises'
import { existsSync } from 'fs'
import type { CanvaTokens } from '@shared/canva'
import { getCanvaTokensPath } from './paths'
import { atomicWriteFile } from './atomic'

export function isTokenStorageAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

export async function saveTokens(tokens: CanvaTokens): Promise<void> {
  if (!isTokenStorageAvailable()) {
    throw new Error('Encrypted storage is unavailable on this system')
  }
  const encrypted = safeStorage.encryptString(JSON.stringify(tokens))
  // Atomic: a crash mid-write would otherwise leave a truncated blob
  // that fails to decrypt — read back as "not connected", losing the
  // (just-rotated, so irreplaceable) refresh token.
  await atomicWriteFile(getCanvaTokensPath(), encrypted)
}

/**
 * Returns null when no tokens are stored, and also when stored tokens
 * cannot be decrypted or parsed — a corrupt or foreign-keychain blob is
 * indistinguishable from "not connected" from the operator's side, and
 * both are fixed the same way: connect again.
 */
export async function loadTokens(): Promise<CanvaTokens | null> {
  const path = getCanvaTokensPath()
  if (!existsSync(path) || !isTokenStorageAvailable()) return null
  try {
    const buf = await readFile(path)
    return JSON.parse(safeStorage.decryptString(buf)) as CanvaTokens
  } catch (err) {
    // Never log the raw error: modern V8 JSON.parse messages echo a
    // leading slice of the offending input, so a corrupt-decrypt path
    // (garbled plaintext fed into JSON.parse) could print a few bytes of
    // what used to be token material. Log only the error's name/shape.
    console.error(
      '[canva] could not read stored tokens',
      err instanceof Error ? err.name : 'unknown'
    )
    return null
  }
}

export async function clearTokens(): Promise<void> {
  await rm(getCanvaTokensPath(), { force: true })
}
