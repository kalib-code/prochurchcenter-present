/**
 * Drives the real tool handlers through an MCP client over an in-memory
 * transport — the same JSON-RPC path Claude Code or Codex would take,
 * minus HTTP. Storage is a tiny in-memory fake.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { Setlist, SetlistItem, Song } from '@shared/types'
import type { LibraryChange } from '@shared/mcp'
import { buildPresentServer, type PresentToolDeps } from './tools'

function setlist(id: string, date: string, items: SetlistItem[] = []): Setlist {
  return { id, name: `Service ${id}`, date, items, createdAt: '', updatedAt: '' }
}

function song(id: string, title: string, rawText = '[Verse 1]\nAmazing grace'): Song {
  return {
    id,
    title,
    author: 'John Newton',
    ccli: null,
    copyright: null,
    year: null,
    language: 'en',
    categories: ['hymn'],
    rawText,
    sections: [],
    notes: '',
    themeOverride: null,
    createdAt: '',
    updatedAt: ''
  }
}

let setlists: Map<string, Setlist>
let songs: Song[]
let changes: LibraryChange[]
let activity: { summary: string; client: string | null }[]
let client: Client

async function call(name: string, args: Record<string, unknown> = {}) {
  const res = (await client.callTool({ name, arguments: args })) as {
    isError?: boolean
    content: { type: string; text: string }[]
  }
  const text = res.content[0]?.text ?? ''
  return { isError: res.isError === true, text, data: res.isError ? null : JSON.parse(text) }
}

beforeEach(async () => {
  setlists = new Map([
    ['past', setlist('past', '2026-10-25')],
    ['next', setlist('next', '2026-11-08', [{ kind: 'section-divider', id: 'd1', label: 'Worship' }])]
  ])
  songs = [song('s1', 'Amazing Grace'), song('s2', 'Ánimo', '[Chorus]\nKoro line')]
  changes = []
  activity = []

  const deps: PresentToolDeps = {
    listSetlists: async () => [...setlists.values()],
    getSetlist: async (id) => setlists.get(id) ?? null,
    createSetlist: async ({ name, date, startTime }) => {
      const s = { ...setlist(`new-${setlists.size}`, date), name, startTime }
      setlists.set(s.id, s)
      return s
    },
    insertSetlistItems: async (id, items, position) => {
      const s = setlists.get(id)!
      const next = [...s.items]
      next.splice(position ?? next.length, 0, ...items)
      const saved = { ...s, items: next }
      setlists.set(id, saved)
      return saved
    },
    listSongs: async () => songs,
    createSong: async (input) => {
      const s = { ...song(`s${songs.length + 1}`, input.title, input.rawText), sections: [] }
      songs.push(s)
      return s
    },
    lookupScripture: async (_t, ref) =>
      ref.startsWith('John')
        ? {
            ok: true,
            reference: { bookId: 'JHN', bookName: 'John', chapter: 3, verseStart: 16 },
            verses: [{ number: 16, text: 'For God so loved the world' }],
            text: 'For God so loved the world'
          }
        : { ok: false, error: 'Could not understand that reference.' },
    importPptx: async (src) => ({
      pptxPath: '/media/ai-imports/abc-Sermon.pptx',
      slideCount: 12,
      title: 'path' in src ? 'Sermon' : src.fileName.replace(/\.pptx$/, '')
    }),
    onLibraryChange: (c) => changes.push(c),
    onActivity: (summary, c) => activity.push({ summary, client: c }),
    today: () => '2026-11-05',
    appVersion: '0.0.0-test'
  }

  const server = buildPresentServer(deps)
  const [a, b] = InMemoryTransport.createLinkedPair()
  client = new Client({ name: 'test-client', version: '1.0.0' })
  await Promise.all([server.connect(a), client.connect(b)])
})

describe('Present MCP tools', () => {
  it('advertises every tool', async () => {
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual([
      'add_pptx_to_setlist',
      'add_scripture_to_setlist',
      'add_section_to_setlist',
      'add_song_to_setlist',
      'create_setlist',
      'create_song',
      'get_setlist',
      'list_setlists',
      'search_songs'
    ])
  })

  it('lists upcoming services only, unless past ones are asked for', async () => {
    const { data } = await call('list_setlists')
    expect(data.upcoming.map((s: { id: string }) => s.id)).toEqual(['next'])
    expect(data.past).toBeUndefined()
    const withPast = await call('list_setlists', { include_past: true })
    expect(withPast.data.past.map((s: { id: string }) => s.id)).toEqual(['past'])
  })

  it('adds a sermon deck, notifies the app, and logs who did it', async () => {
    const { data } = await call('add_pptx_to_setlist', {
      setlist_id: 'next',
      file_path: '/Users/pastor/Desktop/Sermon.pptx',
      title: 'Grace Abounds',
      minutes: 35
    })
    expect(data.ok).toBe(true)
    const items = setlists.get('next')!.items
    expect(items[1]).toMatchObject({
      kind: 'pptx',
      pptxPath: '/media/ai-imports/abc-Sermon.pptx',
      slideCount: 12,
      title: 'Grace Abounds',
      durationMinutes: 35
    })
    expect(changes).toEqual([{ kind: 'setlist', setlist: setlists.get('next') }])
    expect(activity).toEqual([
      { summary: 'Added "Grace Abounds" (12 slides) to Service next', client: 'test-client' }
    ])
  })

  it('needs exactly one deck source, and a real setlist, before importing', async () => {
    const both = await call('add_pptx_to_setlist', {
      setlist_id: 'next',
      file_path: '/a.pptx',
      file_base64: 'AAAA'
    })
    expect(both.isError).toBe(true)
    const neither = await call('add_pptx_to_setlist', { setlist_id: 'next' })
    expect(neither.isError).toBe(true)
    const missing = await call('add_pptx_to_setlist', { setlist_id: 'nope', file_path: '/a.pptx' })
    expect(missing.isError).toBe(true)
    expect(missing.text).toMatch(/list_setlists/)
    expect(changes).toEqual([])
  })

  it('inserts at a position', async () => {
    await call('add_section_to_setlist', { setlist_id: 'next', label: 'Sermon', position: 0 })
    expect(setlists.get('next')!.items.map((i) => i.kind === 'section-divider' && i.label)).toEqual([
      'Sermon',
      'Worship'
    ])
  })

  it('finds songs accent-insensitively and adds them by id', async () => {
    const { data } = await call('search_songs', { query: 'animo' })
    expect(data.songs.map((s: { id: string }) => s.id)).toEqual(['s2'])
    expect(data.songs[0].first_line).toBe('Koro line')
    await call('add_song_to_setlist', { setlist_id: 'next', song_id: 's2' })
    expect(setlists.get('next')!.items[1]).toMatchObject({ kind: 'song', songId: 's2' })
    const bad = await call('add_song_to_setlist', { setlist_id: 'next', song_id: 'zzz' })
    expect(bad.isError).toBe(true)
  })

  it('adds looked-up scripture, and reports lookup failures', async () => {
    await call('add_scripture_to_setlist', { setlist_id: 'next', reference: 'John 3:16' })
    expect(setlists.get('next')!.items[1]).toMatchObject({
      kind: 'scripture',
      reference: 'John 3:16',
      text: 'For God so loved the world',
      translation: 'ENGWEBP'
    })
    const bad = await call('add_scripture_to_setlist', { setlist_id: 'next', reference: 'Hezekiah 1' })
    expect(bad.isError).toBe(true)
    expect(bad.text).toMatch(/Could not understand/)
  })

  it('creates songs and setlists', async () => {
    const created = await call('create_song', { title: 'New Song', lyrics: '[Verse 1]\r\nLine' })
    expect(created.data.ok).toBe(true)
    expect(songs.at(-1)!.rawText).toBe('[Verse 1]\nLine')
    expect(changes.at(-1)).toEqual({ kind: 'songs' })

    const s = await call('create_setlist', { name: 'Youth Night', date: '2026-11-14', start_time: '18:30' })
    expect(s.data.setlist).toMatchObject({ name: 'Youth Night', date: '2026-11-14', start_time: '18:30' })
    const badDate = await call('create_setlist', { name: 'X', date: 'next sunday' })
    expect(badDate.isError).toBe(true)
  })

  it('describes setlist items in plain words', async () => {
    setlists.get('next')!.items.push({ kind: 'song', id: 'x', songId: 's1' })
    const { data } = await call('get_setlist', { setlist_id: 'next' })
    expect(data.items.map((i: { description: string }) => i.description)).toEqual([
      'Section: Worship',
      'Song: Amazing Grace'
    ])
  })
})
