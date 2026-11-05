import { describe, expect, it } from 'vitest'
import type { Setlist, Song } from '@shared/types'
import { normalize, searchCommands } from './commandSearch'

function song(id: string, title: string, extra: Partial<Song> = {}): Song {
  return {
    id,
    title,
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
    updatedAt: '',
    ...extra
  }
}

function setlist(id: string, name: string, date: string): Setlist {
  return { id, name, date, items: [], createdAt: '', updatedAt: '' }
}

const songs = [
  song('1', 'Way Maker', { author: 'Sinach', rawText: '[Verse]\nYou are here moving in our midst' }),
  song('2', 'Goodness of God', { rawText: '[Chorus]\nAll my life you have been faithful\nWay maker too' }),
  song('3', 'Pupúrihin Ka', { categories: ['tagalog'] })
]
const setlists = [
  setlist('old', 'Sunday Worship', '2026-10-25'),
  setlist('next', 'Sunday Worship', '2026-11-08'),
  setlist('youth', 'Youth Night', '2026-11-13')
]
const today = '2026-11-05'
const ids = (q: string): string[] => searchCommands(q, songs, setlists, today).map((r) => r.id)

describe('normalize', () => {
  it('drops accents and case', () => {
    expect(normalize('Pupúrihin')).toBe('pupurihin')
  })
})

describe('searchCommands', () => {
  it('shows actions, upcoming setlists and songs when empty', () => {
    const r = ids('')
    expect(r).toContain('a:new-setlist')
    expect(r).toContain('l:next')
    expect(r).not.toContain('l:old')
  })

  it('ranks a title match above a lyric match', () => {
    const r = ids('way maker')
    expect(r.indexOf('s:1')).toBeLessThan(r.indexOf('s:2'))
  })

  it('finds songs by a lyric line and shows that line', () => {
    const hit = searchCommands('faithful', songs, setlists, today).find((r) => r.id === 's:2')
    expect(hit?.subtitle).toBe('“All my life you have been faithful”')
  })

  it('ignores section headers in lyrics', () => {
    expect(ids('chorus')).not.toContain('s:2')
  })

  it('is accent-insensitive and matches tags', () => {
    expect(ids('pupurihin')).toContain('s:3')
    expect(ids('tagalog')).toContain('s:3')
  })

  it('lists the upcoming setlist before the past one with the same name', () => {
    const r = ids('sunday')
    expect(r.indexOf('l:next')).toBeLessThan(r.indexOf('l:old'))
  })

  it('finds actions by keyword', () => {
    expect(ids('theme')).toContain('a:settings')
  })
})
