import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Setlist, SetlistItem } from '@shared/types'
import {
  itemsWithoutSong,
  pickCloneSource,
  pickHero,
  setlistsUsingSong,
  songDeleteConfirmText
} from './setlist-helpers'

function setlist(id: string, date: string): Setlist {
  return { id, name: id, date, items: [], createdAt: '', updatedAt: '' }
}

describe('pickHero', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it('uses the LOCAL date, not UTC, to decide what is upcoming', () => {
    // Monday 2026-11-09 06:00 in Manila (UTC+8) is still Sunday 22:00 UTC.
    vi.stubEnv('TZ', 'Asia/Manila')
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-08T22:00:00Z'))

    const lastSunday = setlist('last', '2026-11-08')
    const nextSunday = setlist('next', '2026-11-15')
    expect(pickHero([lastSunday, nextSunday])?.id).toBe('next')
  })

  it('falls back to the most recent PAST setlist regardless of input order', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-20T12:00:00'))
    const old = setlist('old', '2026-10-01')
    const recent = setlist('recent', '2026-11-15')
    expect(pickHero([old, recent])?.id).toBe('recent')
  })
})

describe('pickCloneSource', () => {
  const today = '2026-11-05'

  it('skips future setlists and picks the most recent on or before today', () => {
    // Newest-first, as the store sorts them — [0] is the future one.
    const list = [
      setlist('future', '2026-11-22'),
      setlist('next', '2026-11-08'),
      setlist('last', '2026-11-01'),
      setlist('older', '2026-10-25')
    ]
    expect(pickCloneSource(list, today)?.id).toBe('last')
  })

  it('counts a setlist dated today as "last"', () => {
    const list = [setlist('next', '2026-11-08'), setlist('today', today)]
    expect(pickCloneSource(list, today)?.id).toBe('today')
  })

  it('does not depend on input order', () => {
    const list = [setlist('older', '2026-10-25'), setlist('last', '2026-11-01')]
    expect(pickCloneSource(list, today)?.id).toBe('last')
  })

  it('falls back to the nearest upcoming setlist when all are in the future', () => {
    const list = [setlist('far', '2026-12-20'), setlist('near', '2026-11-08')]
    expect(pickCloneSource(list, today)?.id).toBe('near')
  })

  it('returns null for an empty list', () => {
    expect(pickCloneSource([], today)).toBeNull()
  })
})

describe('deleting a song used in setlists', () => {
  const song = (id: string, songId: string): SetlistItem => ({ kind: 'song', id, songId })
  const divider: SetlistItem = { kind: 'section-divider', id: 'd', label: 'Worship' }
  const withItems = (id: string, date: string, items: SetlistItem[]): Setlist => ({
    ...setlist(id, date),
    items
  })

  it('finds only setlists that reference the song, oldest first', () => {
    const a = withItems('a', '2026-11-15', [song('1', 'grace')])
    const b = withItems('b', '2026-11-08', [divider, song('2', 'grace')])
    const c = withItems('c', '2026-11-01', [song('3', 'other')])
    expect(setlistsUsingSong([a, b, c], 'grace').map((s) => s.id)).toEqual(['b', 'a'])
  })

  it('removes every item for that song and keeps everything else in order', () => {
    const items = [song('1', 'grace'), divider, song('2', 'other'), song('3', 'grace')]
    expect(itemsWithoutSong(items, 'grace').map((i) => i.id)).toEqual(['d', '2'])
  })

  it('names the affected services in the confirm text', () => {
    const used = [withItems('a', '2026-11-08', []), withItems('b', '2026-11-15', [])]
    used[0].name = 'Sunday Worship'
    used[1].name = 'Youth Night'
    const text = songDeleteConfirmText('Amazing Grace', used)
    expect(text).toMatch(/^Delete "Amazing Grace"\?/)
    expect(text).toContain('Used in: Sunday Worship (')
    expect(text).toContain('Youth Night (')
    expect(text).toContain('removed from these services')
  })

  it('keeps the plain confirm text when no setlist uses the song', () => {
    expect(songDeleteConfirmText('Amazing Grace', [])).toBe('Delete "Amazing Grace"?')
  })
})
