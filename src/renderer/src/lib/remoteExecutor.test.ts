import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RenderableItem } from './slideify'
import { useServiceStore } from '../stores/useServiceStore'
import { useRemoteStore } from '../stores/useRemoteStore'
import { executeRemoteCommand, resetRemoteExecutor } from './remoteExecutor'

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
    resetRemoteExecutor()
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

  it('records paused rejections at most once per second', () => {
    start()
    useRemoteStore.getState().setPaused(true)
    const at = (now: number) => executeRemoteCommand({ type: 'next' }, 'osc', '10.0.0.5', now)
    for (let n = 0; n < 50; n++) expect(at(5000 + n)).toEqual({ ok: false, reason: 'paused' })
    expect(useRemoteStore.getState().activity).toHaveLength(1)
    at(5999)
    expect(useRemoteStore.getState().activity).toHaveLength(1)
    at(6000)
    expect(useRemoteStore.getState().activity).toHaveLength(2)
    useRemoteStore.getState().setPaused(false)
    at(6001)
    expect(useRemoteStore.getState().activity).toHaveLength(3)
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

  describe('duplicate goToSection', () => {
    const twoChoruses: RenderableItem[] = [
      { id: 'c', kind: 'song', label: 'Song', slides: [t('Verse 1'), t('Chorus'), t('Verse 2'), t('Chorus'), t('Bridge')] }
    ]
    const begin = () =>
      useServiceStore.getState().start({ setlistId: 's', setlistName: 'S', items: twoChoruses })
    const cue = (section: string, now: number, source: 'http' | 'osc' | 'midi' = 'osc') =>
      executeRemoteCommand({ type: 'goToSection', section }, source, null, now)

    it('an identical cue within 750 ms (any source) is a no-op that still reports ok', () => {
      begin()
      expect(cue('Chorus', 10_000).ok).toBe(true)
      expect(pos()).toEqual({ i: 0, s: 1 })
      const r = cue('chorus', 10_400, 'midi')
      expect(r).toMatchObject({ ok: true, position: { section: 'Chorus', slideNumber: 2 } })
      expect(pos()).toEqual({ i: 0, s: 1 })
      expect(cue('C', 10_750, 'http').ok).toBe(true)
      expect(pos()).toEqual({ i: 0, s: 1 })
    })

    it('the window runs from the last cue that moved, not from the duplicates', () => {
      begin()
      cue('Chorus', 10_000)
      cue('Chorus', 10_700)
      cue('Chorus', 10_751)
      expect(pos()).toEqual({ i: 0, s: 3 })
    })

    it('a later repeat goes to the next occurrence', () => {
      begin()
      cue('Chorus', 10_000)
      cue('Chorus', 11_000)
      expect(pos()).toEqual({ i: 0, s: 3 })
      cue('Chorus', 12_000)
      expect(pos()).toEqual({ i: 0, s: 1 })
    })

    it('a different section within 750 ms still moves', () => {
      begin()
      cue('Chorus', 10_000)
      cue('Bridge', 10_100)
      expect(pos()).toEqual({ i: 0, s: 4 })
      cue('Chorus', 10_200)
      expect(pos()).toEqual({ i: 0, s: 1 })
    })

    it('is not a duplicate once something else has moved the slide', () => {
      begin()
      cue('Chorus', 10_000)
      executeRemoteCommand({ type: 'next' }, 'osc', null, 10_100)
      cue('Chorus', 10_200)
      expect(pos()).toEqual({ i: 0, s: 3 })
    })
  })

  it('goToItem', () => {
    start()
    expect(run({ type: 'goToItem', number: 3 })).toEqual({ ok: false, reason: 'not-found' })
    run({ type: 'goToItem', number: 2 })
    expect(pos()).toEqual({ i: 1, s: 0 })
  })

  it('goToSlide jumps within the current item, any kind', () => {
    start()
    expect(run({ type: 'goToSlide', number: 3 }).ok).toBe(true)
    expect(pos()).toEqual({ i: 0, s: 2 })
    expect(run({ type: 'goToSlide', number: 1 }).ok).toBe(true)
    expect(pos()).toEqual({ i: 0, s: 0 })
  })

  it('goToSlide works on a multi-slide non-song item', () => {
    useServiceStore.getState().start({
      setlistId: 's',
      setlistName: 'S',
      items: [{ id: 'p', kind: 'pptx', label: 'Deck', slides: [t('p1'), t('p2'), t('p3')] }]
    })
    expect(run({ type: 'goToSlide', number: 2 }).ok).toBe(true)
    expect(pos()).toEqual({ i: 0, s: 1 })
  })

  it('goToSlide counts the empty Intro transition slide', () => {
    useServiceStore.getState().start({
      setlistId: 's',
      setlistName: 'S',
      items: [{ id: 'a', kind: 'song', label: 'Song', slides: [t('Intro', []), t('Verse 1'), t('Chorus')] }]
    })
    expect(run({ type: 'goToSlide', number: 2 }).ok).toBe(true)
    expect(pos()).toEqual({ i: 0, s: 1 })
  })

  it('goToSlide out of range is not-found and does not move', () => {
    start()
    useServiceStore.getState().jumpTo(0, 1)
    expect(run({ type: 'goToSlide', number: 4 })).toEqual({ ok: false, reason: 'not-found' })
    expect(pos()).toEqual({ i: 0, s: 1 })
    useServiceStore.getState().jumpTo(1, 0)
    expect(run({ type: 'goToSlide', number: 2 })).toEqual({ ok: false, reason: 'not-found' })
    expect(pos()).toEqual({ i: 1, s: 0 })
  })

  it('goToSlide follows the pause and no-service rules', () => {
    expect(run({ type: 'goToSlide', number: 1 })).toEqual({ ok: false, reason: 'no-service' })
    start()
    useRemoteStore.getState().setPaused(true)
    expect(run({ type: 'goToSlide', number: 2 })).toEqual({ ok: false, reason: 'paused' })
    expect(pos()).toEqual({ i: 0, s: 0 })
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
