/**
 * Theme storage — one JSON file per theme under `themes/`.
 *
 * v1.0 ships with a single 'default' theme seeded on first run. v1.1 will
 * allow multiple themes. The `id` of the active theme is tracked in
 * settings.json (`activeThemeId`).
 */

import { readFile, readdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import type { Theme } from '@shared/types'
import { getThemesDir } from './paths'
import { atomicWriteJson } from './atomic'

export const DEFAULT_THEME: Theme = {
  id: 'default',
  name: 'Default',
  backgroundColor: '#000000',
  backgroundImagePath: null,
  backgroundVideoPath: null,
  textColor: '#ffffff',
  fontFamily: 'system-ui',
  fontSizePercent: 100,
  textAlign: 'center',
  textPosition: 'center',
  textEffect: 'none',
  highlightColor: '#ffffff',
  transition: 'fade',
  transitionDurationMs: 200,
  logoPath: null
}

/**
 * Merge a theme parsed from disk with DEFAULT_THEME so that newer fields
 * (e.g., `backgroundVideoPath` added in Phase 5) default cleanly for
 * users who have older JSON on disk. Preserves the stored id/name.
 *
 * Mirror of the `withDefaults` pattern in storage/settings.ts — same
 * problem, same solution. Every call site that parses a theme from
 * disk should route through this.
 */
function withThemeDefaults(stored: Partial<Theme> & { id: string }): Theme {
  return { ...DEFAULT_THEME, ...stored }
}

function themePath(id: string): string {
  return join(getThemesDir(), `${id}.json`)
}

/**
 * Seed the default theme if no themes directory content exists.
 * Safe to call on every startup — no-op if already present.
 */
export async function ensureDefaultTheme(): Promise<void> {
  const path = themePath('default')
  if (!existsSync(path)) {
    await atomicWriteJson(path, DEFAULT_THEME)
  }
}

export async function listThemes(): Promise<Theme[]> {
  const dir = getThemesDir()
  const files = await readdir(dir).catch(() => [] as string[])
  const themes = await Promise.all(
    files
      .filter((f) => f.endsWith('.json') && !f.endsWith('.tmp.json'))
      .map(async (f) => {
        try {
          const content = await readFile(join(dir, f), 'utf8')
          const parsed = JSON.parse(content) as Partial<Theme> & { id: string }
          return withThemeDefaults(parsed)
        } catch (error) {
          console.error(`[theme] Failed to read ${f}:`, error)
          return null
        }
      })
  )
  return themes.filter((t): t is Theme => t !== null)
}

export async function getTheme(id: string): Promise<Theme | null> {
  try {
    const content = await readFile(themePath(id), 'utf8')
    const parsed = JSON.parse(content) as Partial<Theme> & { id: string }
    return withThemeDefaults(parsed)
  } catch {
    return null
  }
}

export type UpdateThemePatch = Partial<Omit<Theme, 'id'>>

export async function updateTheme(id: string, patch: UpdateThemePatch): Promise<Theme> {
  const existing = await getTheme(id)
  if (!existing) throw new Error(`Theme not found: ${id}`)
  const updated: Theme = { ...existing, ...patch, id: existing.id }
  await atomicWriteJson(themePath(id), updated)
  return updated
}
