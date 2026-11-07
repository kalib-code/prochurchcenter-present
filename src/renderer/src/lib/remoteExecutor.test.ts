import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RenderableItem } from './slideify'
import { useServiceStore } from '../stores/useServiceStore'
import { useRemoteStore } from '../stores/useRemoteStore'
import { executeRemoteCommand } from './remoteExecutor'

const t = (label: string, lines = ['x']) => ({ kind: 'text' as const, lines, sectionLabel: label })

const items: RenderableItem[] = [
  { id: 'a', kind: 'song', label: 'Song', slides: [t('Verse 1'), t('Chorus'), t('Verse 2')] },
  { id: 'b', kind: 'video', label: 'Outro', slides: [t('o1')] }
]

function pos() {
  const st = useServiceStore.getState().state
  return st.mode === 'running' ? { i: st.itemIndex, s: st.slideIndex } : st.mode
}
const run = (cmd: Parameters<typeof executeRemoteCommand>[0]) => executeRemoteCommand(cmd, 'http', null)

describe('executeRemoteCommand', () => {
  beforeEach(() => {
    const output = {
      setSlide: vi.fn(async () => {}),
      setBlack: vi.fn(async () => {}),
      setLogo: vi.fn(async () => {}),
      setLive: vi.fn(async () => {}),
      setItemThemeOverride: vi.fn(async () => {}),
      setLowerThirdsContent: vi.fn(async () => {})
    }
    vi.stubGlobal('window', { api: { output } })
    useServiceStore.setState({ state: { mode: 'idle' } })
    useRemoteStore.setState({ paused: false, activity: [] })
  })
  afterEach(() => vi.unstubAllGlobals())

  const start = () => useServiceStore.getState().start({ setlistId: 's', setlistName: 'S', items })

  it('no-service for commands; status returns null position and ok', () => {
    expect(run({ type: 'next' })).toEqual({ ok: false, reason: 'no-service' })
    expect(run({ type: 'status' })).toEqual({ ok: true, position: null })
  })

  it('next on the very last slide succeeds without ending', () => {
    start()
    useServiceStore.getState().jumpTo(1, 0)
    const r = run({ type: 'next' })
    expect(r.ok).toBe(true)
    expect(useServiceStore.getState().state.mode).toBe('running')
  })

  it('paused blocks commands but not status', () => {
    start()
    useRemoteStore.getState().setPaused(true)
    expect(run({ type: 'next' })).toEqual({ ok: false, reason: 'paused' })
    expect(pos()).toEqual({ i: 0, s: 0 })
    expect(run({ type: 'status' }).ok).toBe(true)
  })

  it('goToSection errors', () => {
    start()
    expect(run({ type: 'goToSection', section: 'Bridge' })).toEqual({ ok: false, reason: 'not-found' })
    useServiceStore.getState().jumpTo(1, 0)
    expect(run({ type: 'goToSection', section: 'Chorus' })).toEqual({ ok: false, reason: 'not-a-song' })
  })

  it('goToSection with an unknown name is not-found and nothing moves', () => {
    start()
    expect(run({ type: 'goToSection', section: 'Coda' })).toEqual({ ok: false, reason: 'not-found' })
    expect(run({ type: 'goToSection', section: 'Channel' })).toEqual({ ok: false, reason: 'not-found' })
    expect(pos()).toEqual({ i: 0, s: 0 })
  })

  it('goToSection jumps within a song', () => {
    start()
    expect(run({ type: 'goToSection', section: 'verse 2' }).ok).toBe(true)
    expect(pos()).toEqual({ i: 0, s: 2 })
  })

  it('goToItem', () => {
    start()
    expect(run({ type: 'goToItem', number: 3 })).toEqual({ ok: false, reason: 'not-found' })
    run({ type: 'goToItem', number: 2 })
    expect(pos()).toEqual({ i: 1, s: 0 })
  })

  it('black is idempotent', () => {
    start()
    run({ type: 'black' })
    run({ type: 'black' })
    const st = useServiceStore.getState().state
    expect(st.mode === 'running' && st.displayMode).toBe('black')
  })

  it('reports a 1-based position, records activity except for status', () => {
    start()
    run({ type: 'next' })
    const r = run({ type: 'status' })
    expect(r).toEqual({
      ok: true,
      position: {
        itemNumber: 1, itemCount: 2, itemLabel: 'Song', section: 'Chorus',
        slideNumber: 2, slideCount: 3, display: 'live'
      }
    })
    expect(useRemoteStore.getState().activity).toHaveLength(1)
  })

  it('caps activity at 20, newest first', () => {
    start()
    for (let n = 0; n < 25; n++) run({ type: 'black' })
    expect(useRemoteStore.getState().activity).toHaveLength(20)
  })
})
