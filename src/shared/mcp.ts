/**
 * AI connections (MCP) — types shared by main and renderer, plus the
 * copy-paste setup text Settings shows for each AI tool.
 *
 * Present runs a Model Context Protocol server on this computer only
 * (127.0.0.1), so only AI tools running on this computer can reach it —
 * Claude Code, Codex, anything that speaks MCP over HTTP. Cloud-hosted
 * assistants cannot. Tools connect with a bearer token and can read the
 * library and add items (PowerPoint decks, songs, scripture) to setlists.
 * They cannot drive the projector: nothing here touches live output.
 */

import type { Setlist } from './types'

export const MCP_DEFAULT_PORT = 39217
export const MCP_PATH = '/mcp'
/** The name AI tools list this server under. */
export const MCP_SERVER_NAME = 'present'

export type McpStatus = 'off' | 'starting' | 'running' | 'error'

export interface McpActivity {
  /** ISO 8601 */
  at: string
  /** The AI tool's self-reported name, e.g. "claude-code", or null if unknown. */
  client: string | null
  /** One operator-readable line, e.g. `Added "Sermon.pptx" to Sunday Service`. */
  summary: string
}

export interface McpState {
  enabled: boolean
  status: McpStatus
  port: number
  /** Full endpoint, e.g. http://127.0.0.1:39217/mcp */
  url: string
  token: string
  /** Operator-facing reason when status is 'error'. */
  error: string | null
  /** Newest first, capped. In memory only — cleared when the app quits. */
  activity: McpActivity[]
}

/**
 * What changed in the library because of an AI tool, broadcast to the
 * operator window so open screens refresh. A setlist change carries the
 * whole saved setlist so an open editor can merge it into its draft
 * without a second read (which could race its own autosave).
 */
export type LibraryChange = { kind: 'setlist'; setlist: Setlist } | { kind: 'songs' }

export function mcpUrl(port: number): string {
  return `http://127.0.0.1:${port}${MCP_PATH}`
}

export interface McpClientSnippet {
  id: 'claude-code' | 'codex' | 'json' | 'stdio'
  label: string
  /** Where the text goes, in one line. */
  hint: string
  text: string
}

/**
 * Setup text per AI tool. Built from the live URL and token so the
 * operator copies something that works as-is.
 */
export function buildClientSnippets(url: string, token: string): McpClientSnippet[] {
  const auth = `Bearer ${token}`
  return [
    {
      id: 'claude-code',
      label: 'Claude Code',
      hint: 'Run once in a terminal.',
      text: `claude mcp add --transport http --scope user ${MCP_SERVER_NAME} ${url} --header "Authorization: ${auth}"`
    },
    {
      id: 'codex',
      label: 'Codex',
      hint: 'Add to ~/.codex/config.toml.',
      text: [
        `[mcp_servers.${MCP_SERVER_NAME}]`,
        `url = "${url}"`,
        `http_headers = { "Authorization" = "${auth}" }`
      ].join('\n')
    },
    {
      id: 'json',
      label: 'Other apps',
      hint: 'For apps that take an MCP server URL, or an mcpServers JSON block.',
      text: JSON.stringify(
        {
          mcpServers: {
            [MCP_SERVER_NAME]: { type: 'http', url, headers: { Authorization: auth } }
          }
        },
        null,
        2
      )
    },
    {
      id: 'stdio',
      label: 'Command-only apps',
      hint: 'For apps that can only launch a command (needs Node.js).',
      text: JSON.stringify(
        {
          mcpServers: {
            [MCP_SERVER_NAME]: {
              command: 'npx',
              // No space after the colon: some apps split arguments on
              // spaces, which would cut the header in half.
              args: ['-y', 'mcp-remote', url, '--header', `Authorization:${auth}`]
            }
          }
        },
        null,
        2
      )
    }
  ]
}

/**
 * Friendly name for an AI tool's self-reported MCP client name
 * ("claude-code" → "Claude Code"). Unknown names pass through as-is so
 * the operator still sees *something* specific.
 */
export function clientLabel(name: string | null): string {
  if (!name) return 'An AI tool'
  const n = name.toLowerCase()
  if (n.includes('claude-code') || n === 'claude code') return 'Claude Code'
  if (n.includes('claude')) return 'Claude'
  if (n.includes('codex')) return 'Codex'
  if (n.includes('cursor')) return 'Cursor'
  if (n === 'mcp-remote') return 'An AI tool'
  return name
}
