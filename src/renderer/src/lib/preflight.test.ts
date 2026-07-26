import { describe, expect, it } from 'vitest'
import type { PreflightCheck } from '@shared/ipc-contract'
import { summarize } from './preflight'

const ready = (id: PreflightCheck['id']): PreflightCheck => ({
  id,
  status: 'ready',
  name: id,
  detail: 'fine'
})
const warn = (id: PreflightCheck['id']): PreflightCheck => ({
  id,
  status: 'warning',
  name: id,
  detail: 'not fine'
})

describe('summarize', () => {
  it('counts ok and warning checks', () => {
    const r = summarize([ready('display'), warn('screenRecording'), ready('media'), ready('backup')])
    expect(r.okCount).toBe(3)
    expect(r.warningCount).toBe(1)
  })

  it('builds the headline in the design’s format', () => {
    const r = summarize([ready('display'), warn('screenRecording'), ready('media'), ready('backup')])
    expect(r.headline).toBe('3 OK · 1 WARNING')
  })

  it('pluralises warnings', () => {
    const r = summarize([ready('display'), warn('media'), warn('backup')])
    expect(r.headline).toBe('1 OK · 2 WARNINGS')
  })

  it('omits the warning clause when everything passes', () => {
    const r = summarize([ready('display'), ready('media')])
    expect(r.headline).toBe('2 OK')
    expect(r.firstWarning).toBeNull()
  })

  // The macOS-only screenRecording check is absent on Windows and Linux.
  // Counts must stay internally consistent rather than assuming 4 checks.
  it('stays consistent when a platform check is omitted', () => {
    const r = summarize([ready('display'), ready('media'), ready('backup')])
    expect(r.okCount).toBe(3)
    expect(r.warningCount).toBe(0)
    expect(r.headline).toBe('3 OK')
  })

  it('returns the first warning so the hero banner can show it', () => {
    const r = summarize([ready('display'), warn('media'), warn('backup')])
    expect(r.firstWarning?.id).toBe('media')
  })

  it('handles an empty check list', () => {
    const r = summarize([])
    expect(r.okCount).toBe(0)
    expect(r.warningCount).toBe(0)
    expect(r.headline).toBe('0 OK')
    expect(r.firstWarning).toBeNull()
  })
})
