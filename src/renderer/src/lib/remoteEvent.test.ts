import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RemoteCommandEvent } from '@shared/remote'

const exec = vi.hoisted(() => vi.fn())
vi.mock('./remoteExecutor', () => ({ executeRemoteCommand: exec }))

import { handleRemoteEvent } from './remoteEvent'

const event = (expiresAt: number): RemoteCommandEvent => ({
  id: 'x',
  command: { type: 'next' },
  source: 'osc',
  from: '10.0.0.5',
  expiresAt
})

describe('handleRemoteEvent', () => {
  beforeEach(() => {
    exec.mockReset()
    exec.mockReturnValue({ ok: true, position: null })
  })

  it('runs a cue that arrives in time', () => {
    expect(handleRemoteEvent(event(2000), 1500)).toEqual({ ok: true, position: null })
    expect(exec).toHaveBeenCalledWith({ type: 'next' }, 'osc', '10.0.0.5')
  })

  it('runs a cue exactly at its expiry', () => {
    handleRemoteEvent(event(2000), 2000)
    expect(exec).toHaveBeenCalledOnce()
  })

  it('discards an expired cue instead of running it late', () => {
    expect(handleRemoteEvent(event(2000), 2001)).toEqual({ ok: false, reason: 'timeout' })
    expect(exec).not.toHaveBeenCalled()
  })

  it('reports a cue that throws as invalid', () => {
    exec.mockImplementation(() => {
      throw new Error('boom')
    })
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(handleRemoteEvent(event(2000), 1000)).toEqual({ ok: false, reason: 'invalid' })
    err.mockRestore()
  })
})
