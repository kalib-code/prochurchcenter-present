/**
 * commandSearch — ranking for the ⌘K quick-search palette.
 *
 * Pure: takes the cached songs and setlists, returns grouped results.
 * The palette owns the keyboard and turns a result into navigation.
 *
 * Matching is case- and accent-insensitive ("pupurihin" finds
 * "Pupúrihin"). Songs also match on lyrics, because operators often
 * remember a line before the title; a lyric match ranks below any
 * title or author match and shows the matching line.
 */

import type { Setlist, Song } from '@shared/types'
import { formatServiceDate, todayISO } from './setlist-helpers'

export type CommandAction = 'new-setlist' | 'new-song'

export interface CommandResult {
  id: string
  group: 'Actions' | 'Setlists' | 'Songs'
  title: string
  subtitle?: string
  /** Route to open, or an action the palette runs itself. */
  target: { to: string } | { action: CommandAction }
}

const PER_GROUP = 6

const ACTIONS: (CommandResult & { keywords: string })[] = [
  { id: 'a:new-setlist', group: 'Actions', title: 'New setlist', target: { action: 'new-setlist' }, keywords: 'create service plan' },
  { id: 'a:new-song', group: 'Actions', title: 'New song', target: { action: 'new-song' }, keywords: 'create add lyrics' },
  { id: 'a:home', group: 'Actions', title: 'Go to Home', target: { to: '/' }, keywords: 'dashboard' },
  { id: 'a:songs', group: 'Actions', title: 'Go to Songs', target: { to: '/library' }, keywords: 'library' },
  { id: 'a:settings', group: 'Actions', title: 'Open Settings', target: { to: '/settings' }, keywords: 'display theme output backup preferences' }
]

export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

/** 3 = starts with, 2 = a word starts with, 1 = contains, 0 = no match. */
function textScore(haystack: string, needle: string): number {
  const h = normalize(haystack)
  if (h.startsWith(needle)) return 3
  const i = h.indexOf(needle)
  if (i < 0) return 0
  return /[^a-z0-9]/.test(h[i - 1] ?? ' ') ? 2 : 1
}

/** First lyric line containing the query, or null. Skips [Section] headers. */
function lyricLine(song: Song, needle: string): string | null {
  for (const line of song.rawText.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('[')) continue
    if (normalize(t).includes(needle)) return t
  }
  return null
}

function rank<T>(items: T[], score: (t: T) => number): T[] {
  return items
    .map((t) => ({ t, s: score(t) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.t)
}

function setlistResult(s: Setlist): CommandResult {
  return {
    id: `l:${s.id}`,
    group: 'Setlists',
    title: s.name || 'Untitled service',
    subtitle: formatServiceDate(s.date),
    target: { to: `/setlists/${s.id}` }
  }
}

function songResult(s: Song, subtitle?: string): CommandResult {
  return {
    id: `s:${s.id}`,
    group: 'Songs',
    title: s.title || 'Untitled song',
    subtitle: subtitle ?? s.author ?? undefined,
    target: { to: `/library/${s.id}` }
  }
}

export function searchCommands(
  query: string,
  songs: Song[],
  setlists: Setlist[],
  today: string = todayISO()
): CommandResult[] {
  const q = normalize(query.trim())

  if (!q) {
    // Nothing typed: actions, the next few services, recently edited songs.
    const upcoming = setlists
      .filter((s) => s.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 4)
    const recent = [...songs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 4)
    return [...ACTIONS, ...upcoming.map(setlistResult), ...recent.map((s) => songResult(s))]
  }

  const actions = rank(ACTIONS, (a) => Math.max(textScore(a.title, q), textScore(a.keywords, q)))

  // Ties keep the nearest date first: upcoming, then most recent past.
  const byDate = [...setlists].sort((a, b) => {
    const af = a.date >= today
    const bf = b.date >= today
    if (af !== bf) return af ? -1 : 1
    return af ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date)
  })
  const lists = rank(byDate, (s) =>
    Math.max(textScore(s.name, q), textScore(formatServiceDate(s.date), q) ? 1 : 0)
  )

  const lyricHits = new Map<string, string>()
  const songHits = rank(songs, (s) => {
    const title = textScore(s.title, q)
    if (title) return title + 3 // title beats everything else
    const meta = Math.max(textScore(s.author ?? '', q), ...s.categories.map((c) => textScore(c, q)))
    if (meta) return meta
    const line = q.length >= 3 ? lyricLine(s, q) : null
    if (!line) return 0
    lyricHits.set(s.id, line)
    return 0.5
  })

  return [
    ...actions.slice(0, PER_GROUP),
    ...lists.slice(0, PER_GROUP).map(setlistResult),
    ...songHits.slice(0, PER_GROUP).map((s) => {
      const line = lyricHits.get(s.id)
      return songResult(s, line ? `“${line}”` : undefined)
    })
  ]
}
