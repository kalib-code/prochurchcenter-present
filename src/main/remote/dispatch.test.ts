import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDispatcher } from './dispatch'
import type { RemoteCommandEvent } from '@shared/remote'

describe('createDispatcher', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('resolves with the matching reply', async () => {
    const sent: RemoteCommandEvent[] = []
    const d = createDispatcher((m) => (sent.push(m), true))
    const p = d.dispatch({ type: 'next' }, 'http', '1.2.3.4')
    expect(sent[0]).toMatchObject({ command: { type: 'next' }, source: 'http', from: '1.2.3.4' })
    d.reply(sent[0].id, { ok: true, position: null })
    await expect(p).resolves.toEqual({ ok: true, position: null })
  })

  it('times out when no reply arrives', async () => {
    const d = createDispatcher(() => true, 1000)
    const p = d.dispatch({ type: 'next' }, 'osc', null)
    await vi.advanceTimersByTimeAsync(1000)
    await expect(p).resolves.toEqual({ ok: false, reason: 'timeout' })
  })

  it('returns no-service immediately when send fails', async () => {
    const d = createDispatcher(() => false)
    await expect(d.dispatch({ type: 'next' }, 'http', null)).resolves.toEqual({
      ok: false,
      reason: 'no-service'
    })
  })

  it('ignores unknown and late replies', async () => {
    const sent: RemoteCommandEvent[] = []
    const d = createDispatcher((m) => (sent.push(m), true), 1000)
    const p = d.dispatch({ type: 'next' }, 'http', null)
    d.reply('nope', { ok: true, position: null })
    await vi.advanceTimersByTimeAsync(1000)
    await expect(p).resolves.toEqual({ ok: false, reason: 'timeout' })
    expect(() => d.reply(sent[0].id, { ok: true, position: null })).not.toThrow()
  })

  it('dispatch preserves order', () => {
    const sent: RemoteCommandEvent[] = []
    const d = createDispatcher((m) => (sent.push(m), true))
    void d.dispatch({ type: 'next' }, 'http', null)
    void d.dispatch({ type: 'prev' }, 'http', null)
    expect(sent.map((s) => s.command.type)).toEqual(['next', 'prev'])
    expect(sent[0].id).not.toBe(sent[1].id)
  })

  it('clears pending on reply and settles them on close', async () => {
    const d = createDispatcher(() => true, 1000)
    const p = d.dispatch({ type: 'next' }, 'http', null)
    d.close()
    await expect(p).resolves.toEqual({ ok: false, reason: 'no-service' })
    expect(vi.getTimerCount()).toBe(0)
  })
})
