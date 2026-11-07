import { describe, expect, it } from 'vitest'
import { buildClientSnippets, clientLabel, mcpUrl } from './mcp'

const URL = mcpUrl(39217)
const TOKEN = 'abc_DEF-123'

describe('buildClientSnippets', () => {
  const byId = Object.fromEntries(buildClientSnippets(URL, TOKEN).map((s) => [s.id, s.text]))

  it('builds a Claude Code command with the live URL and token', () => {
    expect(byId['claude-code']).toBe(
      'claude mcp add --transport http --scope user present http://127.0.0.1:39217/mcp --header "Authorization: Bearer abc_DEF-123"'
    )
  })

  it('builds Codex TOML', () => {
    expect(byId.codex).toContain('[mcp_servers.present]')
    expect(byId.codex).toContain('url = "http://127.0.0.1:39217/mcp"')
    expect(byId.codex).toContain('"Authorization" = "Bearer abc_DEF-123"')
  })

  it('builds valid JSON for HTTP and command-only apps', () => {
    const http = JSON.parse(byId.json)
    expect(http.mcpServers.present).toEqual({
      type: 'http',
      url: URL,
      headers: { Authorization: 'Bearer abc_DEF-123' }
    })
    const stdio = JSON.parse(byId.stdio)
    expect(stdio.mcpServers.present.args).toEqual([
      '-y',
      'mcp-remote',
      URL,
      '--header',
      'Authorization:Bearer abc_DEF-123'
    ])
  })
})

describe('clientLabel', () => {
  it('names known AI tools', () => {
    expect(clientLabel('claude-code')).toBe('Claude Code')
    expect(clientLabel('codex-mcp-client')).toBe('Codex')
    expect(clientLabel('some-agent')).toBe('some-agent')
    expect(clientLabel(null)).toBe('An AI tool')
  })
})
