import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, readdir, rm, stat } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { atomicWriteJson, pendingWriteCount, waitForPendingWrites, withFileLock } from './atomic'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'atomic-test-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('atomicWriteJson', () => {
  it('survives many overlapping writes to one path and leaves no tmp files', async () => {
    const path = join(dir, 'x.json')
    await Promise.all(Array.from({ length: 50 }, (_, i) => atomicWriteJson(path, { i })))
    // Writes are serialized in call order, so the last call wins.
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ i: 49 })
    expect(await readdir(dir)).toEqual(['x.json'])
  })
})

describe('withFileLock', () => {
  it('serializes read-modify-write so no update is lost', async () => {
    const path = join(dir, 'counter.json')
    await atomicWriteJson(path, { n: 0 })
    const increment = (): Promise<void> =>
      withFileLock(path, async () => {
        const { n } = JSON.parse(await readFile(path, 'utf8')) as { n: number }
        await atomicWriteJson(path, { n: n + 1 }) // re-entrant: must not deadlock
      })
    await Promise.all(Array.from({ length: 25 }, increment))
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ n: 25 })
  })

  it('releases the lock when the callback throws', async () => {
    const path = join(dir, 'y.json')
    await expect(
      withFileLock(path, async () => {
        throw new Error('boom')
      })
    ).rejects.toThrow('boom')
    await atomicWriteJson(path, { ok: true })
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ ok: true })
  })
})

describe('pending write tracking (quit drain)', () => {
  it('counts queued writes and waits for all of them', async () => {
    const path = join(dir, 'q.json')
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    // Hold the lock so the writes below queue up behind it.
    const holder = withFileLock(path, () => gate)
    const writes = [atomicWriteJson(path, { n: 1 }), atomicWriteJson(path, { n: 2 })]
    expect(pendingWriteCount()).toBe(2)

    const drained = waitForPendingWrites(2000)
    release()
    expect(await drained).toBe(true)
    await Promise.all([holder, ...writes])
    expect(pendingWriteCount()).toBe(0)
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ n: 2 })
  })

  it('gives up after the timeout instead of hanging the quit', async () => {
    const path = join(dir, 'stuck.json')
    let release!: () => void
    const holder = withFileLock(path, () => new Promise<void>((r) => (release = r)))
    const write = atomicWriteJson(path, { x: 1 })
    expect(await waitForPendingWrites(30)).toBe(false)
    release()
    await Promise.all([holder, write])
    expect(await waitForPendingWrites(30)).toBe(true)
  })

  it('does not count failed writes as pending', async () => {
    await expect(atomicWriteJson(join(dir, 'missing-dir', 'a.json'), {})).rejects.toThrow()
    expect(pendingWriteCount()).toBe(0)
    expect(await waitForPendingWrites(10)).toBe(true)
  })
})

describe('atomicWriteJson mode', () => {
  it.skipIf(process.platform === 'win32')('creates the file with the requested permissions', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'present-atomic-mode-'))
    const file = join(dir, 'secret.json')
    await atomicWriteJson(file, { token: 'x' }, { mode: 0o600 })
    expect((await stat(file)).mode & 0o777).toBe(0o600)
    await rm(dir, { recursive: true, force: true })
  })
})
