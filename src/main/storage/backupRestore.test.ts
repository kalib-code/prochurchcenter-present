import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AdmZip from 'adm-zip'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { randomBytes } from 'crypto'
import { join } from 'path'

let userData = ''
vi.mock('electron', () => ({
  app: { getPath: () => userData, getVersion: () => '9.9.9' }
}))
// No worker threads under vitest: make spawning fail so exportLibrary
// takes its in-process fallback (the same buildZip the worker runs).
vi.mock('./backupZipWorker?nodeWorker', () => ({
  default: () => {
    throw new Error('no workers in tests')
  }
}))

import { exportLibrary, importLibrary, listBackups, readBackupManifest, swapInPaths } from './backup'
import { buildZip, tmpZipPathFor, TMP_ZIP_RE } from './backupZip'
import { ensureDirectories, getSettingsPath, getSongsDir, getThemesDir, getMediaDir } from './paths'

const lib = (...p: string[]): string => join(userData, ...p)
const json = (v: unknown): string => JSON.stringify(v)

function seedLibrary(): void {
  ensureDirectories()
  writeFileSync(lib('library/songs/a.json'), json({ id: 'a', title: 'Local A' }))
  writeFileSync(lib('themes/default.json'), json({ id: 'default', name: 'Default' }))
  writeFileSync(lib('themes/custom.json'), json({ id: 'custom', name: 'Custom' }))
  writeFileSync(lib('media/bg #1.jpg'), 'jpeg-bytes')
  writeFileSync(getSettingsPath(), json({ maxLinesPerSlide: 7 }))
}

function makeZip(entries: Record<string, string | Buffer>): string {
  const zip = new AdmZip()
  zip.addFile('manifest.json', Buffer.from(json({ version: 1, createdAt: '2026-01-01T00:00:00Z', appVersion: '1', counts: { songs: 0, setlists: 0, themes: 0 } })))
  for (const [name, data] of Object.entries(entries)) zip.addFile(name, Buffer.isBuffer(data) ? data : Buffer.from(data))
  const path = join(userData, 'incoming.zip')
  zip.writeZip(path)
  return path
}

beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), 'backup-restore-test-'))
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(async () => {
  vi.restoreAllMocks()
  await rm(userData, { recursive: true, force: true })
})

describe('exportLibrary', () => {
  it('writes a complete zip via a tmp name and leaves no tmp behind', async () => {
    seedLibrary()
    mkdirSync(lib('backups'), { recursive: true })
    const dest = lib('backups', 'backup-x.zip')
    const manifest = await exportLibrary(dest)
    expect(manifest.counts).toEqual({ songs: 1, setlists: 0, themes: 2 })
    expect(readdirSync(lib('backups'))).toEqual(['backup-x.zip'])
    const zip = new AdmZip(dest)
    expect(zip.getEntry('library/songs/a.json')?.getData().toString()).toContain('Local A')
    expect(zip.getEntry('media/bg #1.jpg')?.getData().toString()).toBe('jpeg-bytes')
    expect(zip.getEntry('settings.json')).toBeTruthy()
    expect(readBackupManifest(dest).appVersion).toBe('9.9.9')
  })
})

describe('buildZip', () => {
  it('removes its tmp file and leaves no destination when a source is missing', async () => {
    mkdirSync(lib('backups'), { recursive: true })
    const destPath = lib('backups', 'backup-y.zip')
    await expect(
      buildZip({
        kind: 'backup-zip',
        destPath,
        tmpPath: tmpZipPathFor(destPath),
        entries: [{ zipPath: 'x', absPath: lib('nope.bin') }]
      })
    ).rejects.toThrow()
    expect(readdirSync(lib('backups'))).toEqual([])
  })

  it('names tmp files so the Restore list ignores them', async () => {
    const tmp = tmpZipPathFor('/b/backup-1.zip')
    expect(TMP_ZIP_RE.test(tmp)).toBe(true)
    mkdirSync(lib('backups'), { recursive: true })
    writeFileSync(lib('backups', 'backup-1.zip.deadbeef.tmp'), 'partial')
    expect(await listBackups()).toEqual([])
  })
})

describe('importLibrary — replace', () => {
  it('swaps in exactly the zip contents and re-seeds the default theme', async () => {
    seedLibrary()
    const zipPath = makeZip({
      'library/songs/b.json': json({ id: 'b', title: 'Zip B' }),
      'media/nested/clip.mp4': 'mp4'
    })
    const result = await importLibrary(zipPath, 'replace')

    expect(result.imported).toEqual({ songs: 1, setlists: 0, themes: 0 })
    expect(readdirSync(getSongsDir())).toEqual(['b.json'])
    // Zip had no themes/: the default theme must exist anyway.
    expect(readdirSync(getThemesDir())).toEqual(['default.json'])
    expect(readFileSync(join(getMediaDir(), 'nested/clip.mp4'), 'utf8')).toBe('mp4')
    expect(existsSync(join(getMediaDir(), 'canva'))).toBe(true)
    // No settings.json in the zip: current settings kept.
    expect(JSON.parse(readFileSync(getSettingsPath(), 'utf8'))).toEqual({ maxLinesPerSlide: 7 })
    // Staging is cleaned up; safety backup written.
    expect(readdirSync(userData).filter((f) => f.startsWith('.restore-staging-'))).toEqual([])
    expect(existsSync(result.safetyBackupPath)).toBe(true)
  })

  it('keeps current settings when the zip settings.json is not a settings object', async () => {
    seedLibrary()
    const zipPath = makeZip({ 'settings.json': '{"maxLinesPerSlide": 3' })
    await importLibrary(zipPath, 'replace')
    expect(JSON.parse(readFileSync(getSettingsPath(), 'utf8'))).toEqual({ maxLinesPerSlide: 7 })
  })

  it('installs a valid settings.json from the zip', async () => {
    seedLibrary()
    const zipPath = makeZip({ 'settings.json': json({ maxLinesPerSlide: 2 }) })
    await importLibrary(zipPath, 'replace')
    expect(JSON.parse(readFileSync(getSettingsPath(), 'utf8'))).toEqual({ maxLinesPerSlide: 2 })
  })

  it('leaves the library untouched when the zip is corrupt part-way', async () => {
    seedLibrary()
    // Build a zip whose second entry's compressed bytes are damaged, so
    // extraction fails AFTER the first entry was read fine.
    const zip = new AdmZip()
    zip.addFile('manifest.json', Buffer.from(json({ version: 1, createdAt: 'x', appVersion: '1', counts: {} })))
    zip.addFile('library/songs/b.json', Buffer.from(json({ id: 'b' })))
    // Incompressible payload, so flipping bytes in the middle of it hits
    // entry data (caught by the CRC check) rather than the zip directory.
    zip.addFile('media/big.bin', randomBytes(20000))
    const buf = zip.toBuffer()
    const marker = buf.indexOf('media/big.bin') + 10000
    for (let i = marker; i < marker + 200; i++) buf[i] = buf[i] ^ 0xff
    const zipPath = join(userData, 'corrupt.zip')
    writeFileSync(zipPath, buf)

    // Fails during staging (after the manifest read + safety backup),
    // not when the zip is first opened.
    await expect(importLibrary(zipPath, 'replace')).rejects.toThrow(/crc|checksum/i)
    expect(readdirSync(lib('backups')).some((f) => f.startsWith('pre-import-'))).toBe(true)
    expect(readdirSync(getSongsDir())).toEqual(['a.json'])
    expect(readdirSync(getThemesDir()).sort()).toEqual(['custom.json', 'default.json'])
    expect(readFileSync(join(getMediaDir(), 'bg #1.jpg'), 'utf8')).toBe('jpeg-bytes')
    expect(readdirSync(userData).filter((f) => f.startsWith('.restore-staging-'))).toEqual([])
  })
})

describe('importLibrary — merge', () => {
  it('adds and overwrites files without deleting local ones', async () => {
    seedLibrary()
    const zipPath = makeZip({
      'library/songs/a.json': json({ id: 'a', title: 'Zip A' }),
      'library/songs/b.json': json({ id: 'b', title: 'Zip B' })
    })
    const result = await importLibrary(zipPath, 'merge')
    expect(result.imported.songs).toBe(2)
    expect(readdirSync(getSongsDir()).sort()).toEqual(['a.json', 'b.json'])
    expect(readFileSync(join(getSongsDir(), 'a.json'), 'utf8')).toContain('Zip A')
    expect(readdirSync(getThemesDir()).sort()).toEqual(['custom.json', 'default.json'])
    expect(readFileSync(join(getMediaDir(), 'bg #1.jpg'), 'utf8')).toBe('jpeg-bytes')
  })
})

describe('swapInPaths', () => {
  it('rolls back completed swaps when a later one fails', () => {
    for (const d of ['live1', 'live2', 'staged1']) mkdirSync(lib(d), { recursive: true })
    writeFileSync(lib('live1', 'old.txt'), 'old1')
    writeFileSync(lib('live2', 'old.txt'), 'old2')
    writeFileSync(lib('staged1', 'new.txt'), 'new1')
    expect(() =>
      swapInPaths([
        { staged: lib('staged1'), live: lib('live1'), parked: lib('parked1') },
        // staged2 doesn't exist → this rename throws mid-swap.
        { staged: lib('staged2'), live: lib('live2'), parked: lib('parked2') }
      ])
    ).toThrow()
    expect(readdirSync(lib('live1'))).toEqual(['old.txt'])
    expect(readdirSync(lib('live2'))).toEqual(['old.txt'])
    expect(readdirSync(lib('staged1'))).toEqual(['new.txt'])
    expect(existsSync(lib('parked1'))).toBe(false)
    expect(existsSync(lib('parked2'))).toBe(false)
  })
})
