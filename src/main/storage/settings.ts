/**
 * Settings storage — single JSON file at `<userData>/settings.json`.
 *
 * On first run, the file doesn't exist and we write defaults. Subsequent
 * reads return the saved state; updates merge into the existing object.
 */

import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
import type { Settings } from '@shared/types'
import { getSettingsPath } from './paths'
import { atomicWriteJson } from './atomic'

const DEFAULT_SETTINGS: Settings = {
  uiLanguage: 'en',
  outputDisplayId: null,
  firstRunCompleted: false,
  activeThemeId: 'default',
  maxLinesPerSlide: 4
}

/**
 * Merge stored settings with defaults so that adding a new field in a
 * later version doesn't leave returning users with `undefined` values.
 * Any field missing on disk falls back to the default.
 */
function withDefaults(stored: Partial<Settings>): Settings {
  return { ...DEFAULT_SETTINGS, ...stored }
}

export async function getSettings(): Promise<Settings> {
  const path = getSettingsPath()
  if (!existsSync(path)) {
    await atomicWriteJson(path, DEFAULT_SETTINGS)
    return DEFAULT_SETTINGS
  }
  try {
    const content = await readFile(path, 'utf8')
    return withDefaults(JSON.parse(content) as Partial<Settings>)
  } catch (error) {
    console.error('[settings] Failed to read settings.json, using defaults:', error)
    return DEFAULT_SETTINGS
  }
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings()
  const updated: Settings = { ...current, ...patch }
  await atomicWriteJson(getSettingsPath(), updated)
  return updated
}
