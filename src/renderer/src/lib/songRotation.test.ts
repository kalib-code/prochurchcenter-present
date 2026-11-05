import { describe, expect, it } from 'vitest'
import type { Setlist, Song } from '@shared/types'
import { formatSince, songRotation } from './songRotation'

function song(id: string): Song {
  return {
    id,
    title: id,
    author: null,
    ccli: null,
    copyright: null,
    year: null,
    language: 'en',
    categories: [],
    rawText: '',
    sections: [],
    notes: '',
    themeOverride: null,
    createdAt: '',
    updatedAt: ''
  }
}

function service(date: string, songIds: string[]): Setlist {
  return {
    id: date + songIds.join(),
    name: date,
    date,
    items: songIds.map((songId, i) => ({ kind: 'song' as const, id: String(i), songId })),
    createdAt: '',
    updatedAt: ''
  }
}

const songs = ['a', 'b', 'c', 'old'].map(song)

describe('songRotation', () => {
  it('needs enough history before saying anything', () => {
    const r = songRotation([service('2026-11-01', ['a']), service('2026-11-08', ['a'])], songs, '2026-11-08')
    expect(r.streaks).toEqual([])
    expect(r.serviceCount).toBe(2)
  })

  it('flags songs in the last 3+ services in a row, longest first', () => {
    const r = songRotation(
      [
        service('2026-10-18', ['a']),
        service('2026-10-25', ['a', 'b']),
        service('2026-11-01', ['a', 'b']),
        service('2026-11-08', ['a', 'b', 'c'])
      ],
      songs,
      '2026-11-08'
    )
    expect(r.streaks.map((s) => [s.song.id, s.count])).toEqual([
      ['a', 4],
      ['b', 3]
    ])
  })

  it('breaks a streak at a gap of more than two weeks', () => {
    const r = songRotation(
      [
        service('2026-04-19', ['a']),
        service('2026-07-26', ['a']),
        service('2026-10-25', ['a', 'b']),
        service('2026-11-01', ['a', 'b']),
        service('2026-11-08', ['a', 'b'])
      ],
      songs,
      '2026-11-08'
    )
    expect(r.streaks.map((s) => [s.song.id, s.count])).toEqual([
      ['a', 3],
      ['b', 3]
    ])
  })

  it('counts two setlists on one day as one service', () => {
    const r = songRotation(
      [
        service('2026-10-25', ['a']),
        service('2026-11-01', ['a']),
        service('2026-11-08', ['a']),
        service('2026-11-08', ['b'])
      ],
      songs,
      '2026-11-08'
    )
    expect(r.serviceCount).toBe(3)
  })

  it('ignores services after upTo', () => {
    const r = songRotation(
      [
        service('2026-10-18', ['a']),
        service('2026-10-25', ['a']),
        service('2026-11-01', ['b']),
        service('2026-11-08', ['a']),
        service('2026-11-15', ['a'])
      ],
      songs,
      '2026-11-08'
    )
    expect(r.streaks).toEqual([])
  })

  it('lists songs unused for 90+ days, most-sung first', () => {
    const r = songRotation(
      [
        service('2026-03-01', ['old', 'c']),
        service('2026-03-08', ['old']),
        service('2026-10-25', ['a']),
        service('2026-11-01', ['b']),
        service('2026-11-08', ['a'])
      ],
      songs,
      '2026-11-08'
    )
    expect(r.resting.map((h) => [h.song.id, h.timesUsed, h.lastUsed])).toEqual([
      ['old', 2, '2026-03-08'],
      ['c', 1, '2026-03-01']
    ])
  })
})

describe('formatSince', () => {
  it('picks a readable unit', () => {
    expect(formatSince(20)).toBe('2 weeks')
    expect(formatSince(95)).toBe('3 months')
    expect(formatSince(400)).toBe('1 year')
  })
})
