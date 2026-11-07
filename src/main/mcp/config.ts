/**
 * AI connections config — `<userData>/mcp.json`.
 *
 * Separate from settings.json on purpose: settings.json travels inside
 * backups, and the token is a standing grant to write into this
 * computer's library. Moving a backup to another machine must not carry
 * that grant with it. backup.ts collects named files only, so a new file
 * here stays out of backups without any change there.
 */

import { chmod, readFile } from 'fs/promises'
import { join } from 'path'
import { randomBytes } from 'crypto'
import { app } from 'electron'
import { MCP_DEFAULT_PORT } from '@shared/mcp'
import { atomicWriteJson } from '../storage/atomic'

export interface McpConfig {
  enabled: boolean
  port: number
  token: string
}

function configPath(): string {
  return join(app.getPath('userData'), 'mcp.json')
}

export function newToken(): string {
  // 32 random bytes, URL-safe — pasted into shell commands and TOML.
  return randomBytes(32).toString('base64url')
}

export function isValidPort(port: unknown): port is number {
  return typeof port === 'number' && Number.isInteger(port) && port >= 1024 && port <= 65535
}

/** Fill gaps in a stored config; never throws on a damaged file. */
export function normalizeConfig(raw: unknown): McpConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<McpConfig>
  return {
    enabled: r.enabled === true,
    port: isValidPort(r.port) ? r.port : MCP_DEFAULT_PORT,
    token: typeof r.token === 'string' && r.token.length >= 32 ? r.token : newToken()
  }
}

/** Owner read/write only: the token is a credential. No-op on Windows. */
const CONFIG_MODE = 0o600

export async function loadMcpConfig(): Promise<McpConfig> {
  // Tighten a file written with looser permissions (or copied in by hand).
  await chmod(configPath(), CONFIG_MODE).catch(() => {})
  let raw: unknown = null
  try {
    raw = JSON.parse(await readFile(configPath(), 'utf8'))
  } catch {
    // Missing or unreadable: start from defaults (off, fresh token).
  }
  const config = normalizeConfig(raw)
  // Persist a generated token straight away, so the token shown in
  // Settings is the one that still works after a restart.
  if (JSON.stringify(raw) !== JSON.stringify(config)) await saveMcpConfig(config)
  return config
}

export async function saveMcpConfig(config: McpConfig): Promise<void> {
  // atomicWriteJson takes the per-file lock itself.
  await atomicWriteJson(configPath(), config, { mode: CONFIG_MODE })
}
