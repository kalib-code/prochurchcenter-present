/**
 * Settings storage — single JSON file at `<userData>/settings.json`.
 *
 * On first run, the file doesn't exist and we write defaults. Subsequent
 * reads return the saved state; updates merge into the existing object.
 */

import { copyFile, readFile } from 'fs/promises'
import { constants as fsConstants, existsSync } from 'fs'
import { dirname, join } from 'path'
import type { Settings } from '@shared/types'
import { getSettingsPath } from './paths'
import { atomicWriteJson, withFileLock } from './atomic'

const DEFAULT_SETTINGS: Settings = {
  uiLanguage: 'en',
  outputDisplayId: null,
  firstRunCompleted: false,
  activeThemeId: 'default',
  maxLinesPerSlide: 4,
  songTransitionSlide: true,
  stageMonitorEnabled: false,
  stageMonitorDisplayId: null,
  lowerThirdsEnabled: false,
  lowerThirdsDisplayId: null,
  // Bright magenta-ish green that's effectively never present in
  // photographic content. Standard chroma key for green-screen
  // workflows; matches the OBS default for chroma key filter setup.
  lowerThirdsChromaKey: '#00FF00',
  lowerThirdsAlignment: 'left',
  lowerThirdsFontSize: 36,
  lowerThirdsTextColor: '#FFFFFF',
  lowerThirdsBoxColor: '#0F121C',
  lowerThirdsBoxOpacity: 92,
  lowerThirdsTextEffect: 'shadow'
}

/**
 * Merge stored settings with defaults so that adding a new field in a
 * later version doesn't leave returning users with `undefined` values.
 * Any field missing on disk falls back to the default.
 */
function withDefaults(stored: Partial<Settings>): Settings {
  return { ...DEFAULT_SETTINGS, ...stored }
}

/**
 * Parse settings.json text into a stored-settings object, or null when
 * it isn't JSON or isn't a plain object (`null`, `[]`, `"x"` would
 * otherwise spread garbage over the defaults). Shared with backup
 * restore, which must not install a settings file we can't read.
 */
export function parseStoredSettings(content: string): Partial<Settings> | null {
  try {
    const parsed: unknown = JSON.parse(content)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Partial<Settings>
  } catch {
    return null
  }
}

/** Corrupt contents already copied aside this session (avoid one copy per read). */
let preservedCorruptContent: string | null = null

/**
 * Copy an unreadable settings.json to `settings.corrupt-<timestamp>.json`
 * next to it. Why: getSettings falls back to defaults, and the very next
 * updateSettings writes those defaults over the file — destroying a file
 * that was often one stray byte away from recoverable (display ids,
 * lower-thirds styling, etc). Best-effort: failing to copy must not stop
 * the app from starting on defaults.
 */
async function preserveCorruptSettings(path: string, content: string): Promise<void> {
  if (preservedCorruptContent === content) return
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dest = join(dirname(path), `settings.corrupt-${stamp}.json`)
  try {
    await copyFile(path, dest, fsConstants.COPYFILE_EXCL)
    preservedCorruptContent = content
    console.error(`[settings] settings.json is unreadable; preserved a copy at ${dest}`)
  } catch (err) {
    console.error('[settings] Failed to preserve corrupt settings.json:', err)
  }
}

export async function getSettings(): Promise<Settings> {
  const path = getSettingsPath()
  if (!existsSync(path)) {
    await atomicWriteJson(path, DEFAULT_SETTINGS)
    return DEFAULT_SETTINGS
  }
  let content: string
  try {
    content = await readFile(path, 'utf8')
  } catch (error) {
    console.error('[settings] Failed to read settings.json, using defaults:', error)
    return DEFAULT_SETTINGS
  }
  const stored = parseStoredSettings(content)
  if (!stored) {
    // Copy it aside BEFORE returning defaults — the caller may be
    // updateSettings, which overwrites the file right after this.
    await preserveCorruptSettings(path, content)
    return DEFAULT_SETTINGS
  }
  return withDefaults(stored)
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const path = getSettingsPath()
  // Lock across read AND write: two overlapping patches (e.g. toggling
  // stage monitor while the output display is being saved) would
  // otherwise both read the same old file and the later write would
  // silently drop the earlier patch's field. The lock is re-entrant, so
  // getSettings() seeding defaults via atomicWriteJson inside is fine.
  return withFileLock(path, async () => {
    const current = await getSettings()
    const updated: Settings = { ...current, ...patch }
    await atomicWriteJson(path, updated)
    return updated
  })
}
