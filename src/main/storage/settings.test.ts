import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

// paths.ts resolves everything under app.getPath('userData').
let userData = ''
vi.mock('electron', () => ({ app: { getPath: () => userData } }))

import { getSettings, parseStoredSettings, updateSettings } from './settings'

beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), 'settings-test-'))
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(async () => {
  vi.restoreAllMocks()
  await rm(userData, { recursive: true, force: true })
})

describe('parseStoredSettings', () => {
  it('accepts a JSON object', () => {
    expect(parseStoredSettings('{"maxLinesPerSlide":2}')).toEqual({ maxLinesPerSlide: 2 })
  })

  it.each(['', '{"a":', 'null', '[]', '"x"', '42'])('rejects %j', (text) => {
    expect(parseStoredSettings(text)).toBeNull()
  })
})

describe('corrupt settings.json', () => {
  it('is copied aside before an update overwrites it', async () => {
    const corrupt = '{"outputDisplayId": 12345, "lowerThirdsFontSize": 4'
    await writeFile(join(userData, 'settings.json'), corrupt)

    // Two reads of the same corrupt file preserve it once, not twice.
    expect((await getSettings()).maxLinesPerSlide).toBe(4)
    await getSettings()
    await updateSettings({ maxLinesPerSlide: 3 })

    const copies = (await readdir(userData)).filter((f) => f.startsWith('settings.corrupt-'))
    expect(copies).toHaveLength(1)
    expect(copies[0]).toMatch(/^settings\.corrupt-.+\.json$/)
    expect(await readFile(join(userData, copies[0]), 'utf8')).toBe(corrupt)

    // The live file is now valid again, with the patch applied.
    const live = JSON.parse(await readFile(join(userData, 'settings.json'), 'utf8'))
    expect(live.maxLinesPerSlide).toBe(3)
  })

  it('leaves a healthy settings.json alone', async () => {
    await writeFile(join(userData, 'settings.json'), '{"maxLinesPerSlide":6}')
    expect((await getSettings()).maxLinesPerSlide).toBe(6)
    expect(await readdir(userData)).toEqual(['settings.json'])
  })
})
