/**
 * The tools Present offers AI assistants over MCP.
 *
 * Scope is service PREPARATION: read the library, create a setlist, add
 * a sermon deck / song / scripture / section header. There is
 * deliberately no tool that touches live output, deletes, or rewrites
 * existing items — an assistant mid-conversation must never be able to
 * change what the congregation sees, or quietly remove something the
 * operator planned.
 *
 * Storage and side effects come in through `deps` so tests can drive the
 * real tool handlers through an in-memory MCP client.
 */

import { randomUUID } from 'crypto'
import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { BibleLookupResult, Setlist, SetlistItem, Song } from '@shared/types'
import type { CreateSetlistInput, CreateSongInput, UpdateSongPatch } from '@shared/ipc-contract'
import { formatReference } from '@shared/bibleReference'
import { MCP_SERVER_NAME, type LibraryChange } from '@shared/mcp'
import type { ImportedPptx, PptxSource } from './importPptx'

export interface PresentToolDeps {
  listSetlists(): Promise<Setlist[]>
  getSetlist(id: string): Promise<Setlist | null>
  createSetlist(input: CreateSetlistInput & { startTime?: string }): Promise<Setlist>
  insertSetlistItems(id: string, items: SetlistItem[], position?: number): Promise<Setlist>
  listSongs(): Promise<Song[]>
  createSong(input: CreateSongInput): Promise<Song>
  updateSong(id: string, patch: UpdateSongPatch): Promise<Song>
  lookupScripture(translationId: string, reference: string): Promise<BibleLookupResult>
  importPptx(src: PptxSource): Promise<ImportedPptx>
  /** Tell open Present windows the library changed. */
  onLibraryChange(change: LibraryChange): void
  /** Record one operator-readable line for Settings → AI connections. */
  onActivity(summary: string, client: string | null): void
  /** Local calendar date, YYYY-MM-DD. */
  today(): string
  appVersion: string
}

export const DEFAULT_TRANSLATION = 'ENGWEBP'

const INSTRUCTIONS = `Present is the worship presentation app running this church's Sunday services. Through these tools you can prepare a service: find the setlist (one per service date), then add items to it — a PowerPoint sermon deck, songs from the library, scripture passages, and section headers.

- Call list_setlists first to find the service. If none exists for the date, create_setlist.
- add_pptx_to_setlist: if the .pptx is on this computer, pass file_path (absolute). Otherwise send file_base64 + file_name.
- Songs must exist in the library before they can be added: search_songs, then add_song_to_setlist with the song id. create_song adds a new song; update_song fixes an existing one (e.g. fills in placeholder lyrics) instead of creating a duplicate.
- Positions are 0-based; omit position to add at the end of the service.
- You cannot control the projector or delete anything. The operator reviews the setlist in Present.`

// ─── formatting helpers ──────────────────────────────────────────────

function json(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}

function newItemId(): string {
  return `item-${randomUUID().replace(/-/g, '').slice(0, 8)}`
}

function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

function describeItem(item: SetlistItem, songs: Map<string, Song>): string {
  switch (item.kind) {
    case 'song':
      return `Song: ${songs.get(item.songId)?.title ?? '(missing song)'}`
    case 'scripture':
      return `Scripture: ${item.reference || '(no reference yet)'}${item.translation ? ` (${item.translation})` : ''}`
    case 'section-divider':
      return `Section: ${item.label || '(untitled)'}`
    case 'pptx':
      return `PowerPoint: ${item.title ?? 'Untitled'} (${item.slideCount} slides)`
    case 'deck':
      return `PDF deck: ${item.title ?? 'Untitled'} (${item.pageCount} pages)`
    case 'image':
      return `Image${item.caption ? `: ${item.caption}` : ''}`
    case 'video':
      return `Video: ${item.title ?? 'Untitled'}`
    case 'countdown':
      return `Countdown: ${item.label}`
  }
}

function setlistSummary(s: Setlist): Record<string, unknown> {
  return {
    id: s.id,
    name: s.name,
    date: s.date,
    start_time: s.startTime ?? '10:00',
    item_count: s.items.length
  }
}

const setlistId = z.string().min(1).describe('Setlist id from list_setlists.')
const position = z
  .number()
  .int()
  .min(0)
  .optional()
  .describe('0-based index to insert at (0 = first item). Omit to add at the end.')

// ─── server ──────────────────────────────────────────────────────────

export function buildPresentServer(deps: PresentToolDeps): McpServer {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, title: 'Present', version: deps.appVersion },
    { instructions: INSTRUCTIONS }
  )
  const client = (): string | null => server.server.getClientVersion()?.name ?? null

  async function requireSetlist(id: string): Promise<Setlist> {
    const s = await deps.getSetlist(id)
    if (!s) throw new Error(`No setlist with id "${id}". Call list_setlists to see valid ids.`)
    return s
  }

  async function addItems(
    id: string,
    items: SetlistItem[],
    at: number | undefined,
    summary: (s: Setlist) => string
  ): Promise<CallToolResult> {
    await requireSetlist(id)
    const saved = await deps.insertSetlistItems(id, items, at)
    deps.onLibraryChange({ kind: 'setlist', setlist: saved })
    const line = summary(saved)
    deps.onActivity(line, client())
    return json({
      ok: true,
      message: line,
      setlist: setlistSummary(saved),
      added_item_ids: items.map((i) => i.id)
    })
  }

  server.registerTool(
    'list_setlists',
    {
      title: 'List services',
      description:
        'List service setlists. By default only today and upcoming services, soonest first.',
      inputSchema: {
        include_past: z.boolean().optional().describe('Also include past services, newest first.'),
        limit: z.number().int().min(1).max(100).optional()
      },
      annotations: { readOnlyHint: true }
    },
    async ({ include_past, limit }) => {
      const today = deps.today()
      const all = await deps.listSetlists()
      const upcoming = all
        .filter((s) => s.date >= today)
        .sort((a, b) => (a.date === b.date ? a.name.localeCompare(b.name) : a.date < b.date ? -1 : 1))
      const past = include_past
        ? all.filter((s) => s.date < today).sort((a, b) => (a.date < b.date ? 1 : -1))
        : []
      const max = limit ?? 20
      return json({
        today,
        upcoming: upcoming.slice(0, max).map(setlistSummary),
        ...(include_past ? { past: past.slice(0, max).map(setlistSummary) } : {})
      })
    }
  )

  server.registerTool(
    'get_setlist',
    {
      title: 'Read a service',
      description: 'Show every item in a setlist, in service order.',
      inputSchema: { setlist_id: setlistId },
      annotations: { readOnlyHint: true }
    },
    async ({ setlist_id }) => {
      const s = await requireSetlist(setlist_id)
      const songs = new Map((await deps.listSongs()).map((song) => [song.id, song]))
      return json({
        ...setlistSummary(s),
        items: s.items.map((item, index) => ({
          position: index,
          id: item.id,
          kind: item.kind,
          description: describeItem(item, songs),
          ...(item.durationMinutes !== undefined ? { minutes: item.durationMinutes } : {})
        }))
      })
    }
  )

  server.registerTool(
    'create_setlist',
    {
      title: 'Create a service',
      description: 'Create an empty setlist for a service date.',
      inputSchema: {
        name: z.string().min(1).max(120).describe('e.g. "Sunday Service"'),
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .describe('Service date, YYYY-MM-DD.'),
        start_time: z
          .string()
          .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
          .optional()
          .describe('Start time, 24-hour HH:MM. Defaults to 10:00.')
      }
    },
    async ({ name, date, start_time }) => {
      const created = await deps.createSetlist({ name, date, startTime: start_time })
      deps.onLibraryChange({ kind: 'setlist', setlist: created })
      deps.onActivity(`Created ${created.name} (${created.date})`, client())
      return json({ ok: true, setlist: setlistSummary(created) })
    }
  )

  server.registerTool(
    'add_pptx_to_setlist',
    {
      title: 'Add a PowerPoint deck',
      description:
        'Add a .pptx deck (e.g. a sermon) to a setlist. Present keeps its own copy, so a temporary file is fine. Pass file_path when the file is on this computer; otherwise file_base64 + file_name. Max 100 MB.',
      inputSchema: {
        setlist_id: setlistId,
        file_path: z.string().optional().describe('Absolute path to a .pptx on this computer.'),
        file_base64: z.string().optional().describe('The .pptx file content, base64-encoded.'),
        file_name: z
          .string()
          .optional()
          .describe('File name for file_base64, e.g. "Grace Abounds.pptx".'),
        title: z.string().max(120).optional().describe('Name shown to the operator. Defaults to the file name.'),
        minutes: z.number().int().min(0).max(240).optional().describe('Planned length in minutes.'),
        position
      }
    },
    async ({ setlist_id, file_path, file_base64, file_name, title, minutes, position: at }) => {
      if (!!file_path === !!file_base64) {
        throw new Error('Pass exactly one of file_path or file_base64.')
      }
      // Check the setlist before copying anything into media/.
      await requireSetlist(setlist_id)
      const imported = await deps.importPptx(
        file_path ? { path: file_path } : { base64: file_base64!, fileName: file_name ?? 'Presentation.pptx' }
      )
      const itemTitle = title?.trim() || imported.title
      const item: SetlistItem = {
        kind: 'pptx',
        id: newItemId(),
        pptxPath: imported.pptxPath,
        slideCount: imported.slideCount,
        title: itemTitle,
        ...(minutes !== undefined ? { durationMinutes: minutes } : {})
      }
      return addItems(
        setlist_id,
        [item],
        at,
        (s) => `Added "${itemTitle}" (${imported.slideCount} slides) to ${s.name}`
      )
    }
  )

  server.registerTool(
    'search_songs',
    {
      title: 'Search songs',
      description:
        "Search the church's song library by title, author, tag or lyric. Empty query lists songs A–Z.",
      inputSchema: {
        query: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional()
      },
      annotations: { readOnlyHint: true }
    },
    async ({ query, limit }) => {
      const songs = await deps.listSongs()
      const q = fold(query?.trim() ?? '')
      const scored = songs
        .map((song) => {
          if (!q) return { song, score: 1 }
          if (fold(song.title).includes(q)) return { song, score: 3 }
          if (fold(song.author ?? '').includes(q) || song.categories.some((c) => fold(c).includes(q)))
            return { song, score: 2 }
          if (fold(song.rawText).includes(q)) return { song, score: 1 }
          return { song, score: 0 }
        })
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score || a.song.title.localeCompare(b.song.title))
      return json({
        total: scored.length,
        songs: scored.slice(0, limit ?? 25).map(({ song }) => ({
          id: song.id,
          title: song.title,
          author: song.author,
          tags: song.categories,
          first_line: song.rawText.split('\n').find((l) => l.trim() && !l.trim().startsWith('['))?.trim() ?? ''
        }))
      })
    }
  )

  server.registerTool(
    'add_song_to_setlist',
    {
      title: 'Add a song',
      description: 'Add a song from the library to a setlist. Get song_id from search_songs.',
      inputSchema: { setlist_id: setlistId, song_id: z.string().min(1), position }
    },
    async ({ setlist_id, song_id, position: at }) => {
      const song = (await deps.listSongs()).find((s) => s.id === song_id)
      if (!song) throw new Error(`No song with id "${song_id}". Use search_songs to find it.`)
      return addItems(
        setlist_id,
        [{ kind: 'song', id: newItemId(), songId: song.id }],
        at,
        (s) => `Added song "${song.title}" to ${s.name}`
      )
    }
  )

  server.registerTool(
    'create_song',
    {
      title: 'Create a song',
      description:
        'Add a new song to the library. Lyrics use bracketed section headers on their own line, e.g. "[Verse 1]", "[Chorus]", "[Bridge]"; a blank line inside a section starts a new slide. Check search_songs first to avoid duplicates. Only add lyrics the church is licensed to project.',
      inputSchema: {
        title: z.string().min(1).max(200),
        lyrics: z.string().min(1),
        author: z.string().max(200).optional(),
        ccli: z.string().max(40).optional().describe('CCLI song number, if known.'),
        copyright: z.string().max(300).optional()
      }
    },
    async ({ title, lyrics, author, ccli, copyright }) => {
      const song = await deps.createSong({
        title: title.trim(),
        rawText: lyrics.replace(/\r\n?/g, '\n'),
        author: author?.trim() || null,
        ccli: ccli?.trim() || null,
        copyright: copyright?.trim() || null
      })
      deps.onLibraryChange({ kind: 'songs' })
      deps.onActivity(`Created song "${song.title}"`, client())
      return json({
        ok: true,
        song: { id: song.id, title: song.title, sections: song.sections.map((s) => s.label) }
      })
    }
  )

  server.registerTool(
    'update_song',
    {
      title: 'Update a song',
      description:
        'Change an existing song in the library: replace its lyrics, or correct its title, author, CCLI number or copyright. Only the fields you pass change; pass an empty string to clear author, ccli or copyright. Lyrics use the same format as create_song. Get song_id from search_songs. Only add lyrics the church is licensed to project.',
      inputSchema: {
        song_id: z.string().min(1),
        title: z.string().min(1).max(200).optional(),
        lyrics: z.string().min(1).optional(),
        author: z.string().max(200).optional(),
        ccli: z.string().max(40).optional(),
        copyright: z.string().max(300).optional()
      },
      annotations: { destructiveHint: false, idempotentHint: true }
    },
    async ({ song_id, title, lyrics, author, ccli, copyright }) => {
      const existing = (await deps.listSongs()).find((s) => s.id === song_id)
      if (!existing) throw new Error(`No song with id "${song_id}". Use search_songs to find it.`)

      // Optional text field → trimmed value, or null to clear; undefined = leave alone.
      const orNull = (v: string | undefined): string | null | undefined =>
        v === undefined ? undefined : v.trim() || null
      const patch: UpdateSongPatch = {}
      if (title !== undefined) patch.title = title.trim()
      if (lyrics !== undefined) patch.rawText = lyrics.replace(/\r\n?/g, '\n')
      if (author !== undefined) patch.author = orNull(author)
      if (ccli !== undefined) patch.ccli = orNull(ccli)
      if (copyright !== undefined) patch.copyright = orNull(copyright)

      const changed = Object.keys(patch).map((k) => (k === 'rawText' ? 'lyrics' : k))
      if (changed.length === 0) {
        throw new Error('Nothing to update: pass at least one of title, lyrics, author, ccli, copyright.')
      }

      const song = await deps.updateSong(song_id, patch)
      deps.onLibraryChange({ kind: 'songs' })
      // Name the song as it was before the edit, so a renamed song is still recognisable.
      deps.onActivity(`Updated song "${existing.title}" (${changed.join(', ')})`, client())
      return json({
        ok: true,
        song: { id: song.id, title: song.title, sections: song.sections.map((s) => s.label) }
      })
    }
  )

  server.registerTool(
    'add_scripture_to_setlist',
    {
      title: 'Add scripture',
      description: `Look up a Bible passage and add it to a setlist. Default translation ${DEFAULT_TRANSLATION} (World English Bible); translation ids are bible.helloao.org catalog ids.`,
      inputSchema: {
        setlist_id: setlistId,
        reference: z.string().min(1).describe('e.g. "John 3:16" or "Romans 12:1-3".'),
        translation: z.string().optional(),
        position
      }
    },
    async ({ setlist_id, reference, translation, position: at }) => {
      await requireSetlist(setlist_id)
      const translationId = translation?.trim() || DEFAULT_TRANSLATION
      const found = await deps.lookupScripture(translationId, reference)
      if (!found.ok) throw new Error(found.error)
      const label = formatReference(found.reference)
      return addItems(
        setlist_id,
        [
          {
            kind: 'scripture',
            id: newItemId(),
            reference: label,
            text: found.text,
            translation: translationId
          }
        ],
        at,
        (s) => `Added ${label} to ${s.name}`
      )
    }
  )

  server.registerTool(
    'add_section_to_setlist',
    {
      title: 'Add a section header',
      description:
        'Add a section header (e.g. "Worship", "Sermon", "Response") to group a setlist. Headers are for the operator and never reach the projector.',
      inputSchema: { setlist_id: setlistId, label: z.string().min(1).max(80), position }
    },
    async ({ setlist_id, label, position: at }) =>
      addItems(
        setlist_id,
        [{ kind: 'section-divider', id: newItemId(), label: label.trim() }],
        at,
        (s) => `Added section "${label.trim()}" to ${s.name}`
      )
  )

  return server
}
