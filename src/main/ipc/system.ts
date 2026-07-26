/**
 * Pre-flight readiness checks.
 *
 * Composes the four things that actually break a Sunday service, each
 * with the specific numbers filled in and a remedy where the operator
 * can act. Runs on Home mount and on RE-CHECK — never polled.
 */

import { ipcMain, screen, shell, systemPreferences } from 'electron'
import { access } from 'fs/promises'
import {
  CHANNELS,
  type PreflightCheck,
  type PreflightReport
} from '@shared/ipc-contract'
import type { Setlist } from '@shared/types'
import { mediaPathOf } from '@shared/setlist-media'
import { getSettings } from '../storage/settings'
import { getSetlist } from '../storage/setlists'
import { listBackups } from '../storage/backup'

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

async function checkDisplay(): Promise<PreflightCheck> {
  const displays = screen.getAllDisplays()
  const settings = await getSettings()
  const saved = settings.outputDisplayId

  if (displays.length < 2) {
    return {
      id: 'display',
      status: 'warning',
      name: 'Output display',
      detail:
        'Only one display detected. The projector window will cover this screen — plug in the projector before the service.',
      remedy: { label: 'OPEN SETTINGS', kind: 'in-app', target: '/settings' }
    }
  }

  if (saved !== null && !displays.some((d) => d.id === saved)) {
    return {
      id: 'display',
      status: 'warning',
      name: 'Output display',
      detail:
        'The display this was pointed at is no longer connected. Output will fall back to the primary screen.',
      remedy: { label: 'PICK A DISPLAY', kind: 'in-app', target: '/settings' }
    }
  }

  const target = saved === null ? screen.getPrimaryDisplay() : displays.find((d) => d.id === saved)!
  return {
    id: 'display',
    status: 'ready',
    name: 'Output display',
    detail: `${target.size.width}×${target.size.height} — projector window has a display to land on.`
  }
}

/**
 * macOS only. Service Mode's confidence monitor mirrors the output
 * window through desktopCapturer (see OutputMirror.tsx; the stage
 * monitor and Settings' live preview use the same mechanism via
 * VideoSlideOperator in SlideRenderer.tsx), so without this permission
 * they genuinely render black mid-service.
 *
 * Returns null on every other platform so the caller can omit the check
 * rather than show a meaningless disabled row.
 */
function checkScreenRecording(): PreflightCheck | null {
  if (process.platform !== 'darwin') return null

  const status = systemPreferences.getMediaAccessStatus('screen')
  if (status === 'granted') {
    return {
      id: 'screenRecording',
      status: 'ready',
      name: 'Screen Recording',
      detail: 'Granted — the confidence monitor can mirror the projector.'
    }
  }

  return {
    id: 'screenRecording',
    status: 'warning',
    name: 'Screen Recording',
    detail:
      'macOS permission is off, so your confidence monitor will be black. System Settings → Privacy & Security → Screen Recording.',
    remedy: {
      label: 'SHOW ME HOW',
      kind: 'external',
      target:
        'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
    }
  }
}

async function checkMedia(setlistId: string | null): Promise<PreflightCheck | null> {
  if (!setlistId) return null

  let setlist: Setlist | null = null
  try {
    setlist = await getSetlist(setlistId)
  } catch {
    setlist = null
  }
  if (!setlist) return null

  const paths = setlist.items
    .map(mediaPathOf)
    .filter((p): p is string => p !== null)
  if (paths.length === 0) {
    return {
      id: 'media',
      status: 'ready',
      name: 'Media files',
      detail: 'No image, video, or PDF items in this setlist — nothing to go missing.'
    }
  }

  let found = 0
  for (const p of paths) {
    try {
      await access(p)
      found += 1
    } catch {
      // counted as missing below
    }
  }

  const missing = paths.length - found
  if (missing === 0) {
    return {
      id: 'media',
      status: 'ready',
      name: 'Media files',
      detail: `All ${paths.length} found.`
    }
  }

  return {
    id: 'media',
    status: 'warning',
    name: 'Media files',
    detail: `${found} of ${paths.length} found. ${missing === 1 ? 'One file has' : `${missing} files have`} moved — open the setlist to relink.`,
    remedy: { label: 'OPEN SETLIST', kind: 'in-app', target: `/setlists/${setlistId}` }
  }
}

async function checkBackup(): Promise<PreflightCheck> {
  let newest: { createdAt: string } | undefined
  try {
    newest = (await listBackups())[0]
  } catch {
    newest = undefined
  }

  if (!newest) {
    return {
      id: 'backup',
      status: 'warning',
      name: 'Backup',
      detail: 'No backups yet. One bad restore and the library is gone.',
      remedy: { label: 'BACK UP NOW', kind: 'in-app', target: '/settings' }
    }
  }

  const ageMs = Date.now() - new Date(newest.createdAt).getTime()
  const days = Math.floor(ageMs / (24 * 60 * 60 * 1000))
  const hours = Math.floor(ageMs / (60 * 60 * 1000))
  const ago = days >= 1 ? `${days} day${days === 1 ? '' : 's'} ago` : `${hours} hour${hours === 1 ? '' : 's'} ago`

  if (ageMs > SEVEN_DAYS_MS) {
    return {
      id: 'backup',
      status: 'warning',
      name: 'Backup',
      detail: `Last backup ${ago}. Auto-backup may not be running.`,
      remedy: { label: 'BACK UP NOW', kind: 'in-app', target: '/settings' }
    }
  }

  return {
    id: 'backup',
    status: 'ready',
    name: 'Backup',
    detail: `Last automatic backup ${ago}.`
  }
}

export function registerSystemHandlers(): void {
  ipcMain.handle(
    CHANNELS.system.getPreflight,
    async (_, setlistId: string | null): Promise<PreflightReport> => {
      const checks: PreflightCheck[] = [await checkDisplay()]

      const screenCheck = checkScreenRecording()
      if (screenCheck) checks.push(screenCheck)

      const mediaCheck = await checkMedia(setlistId)
      if (mediaCheck) checks.push(mediaCheck)

      checks.push(await checkBackup())

      return { checks, checkedAt: new Date().toISOString() }
    }
  )

  ipcMain.handle(CHANNELS.system.openExternal, async (_, url: string): Promise<void> => {
    if (typeof url !== 'string') return
    if (!isAllowedExternalUrl(url)) {
      console.warn('[system] Blocked openExternal for disallowed scheme:', url)
      return
    }
    await shell.openExternal(url)
  })
}

/**
 * Every scheme `openExternal` is allowed to hand to the OS shell.
 * Callers today are all main-process constants (the "SHOW ME HOW"
 * pre-flight remedy, the update-check page), but the IPC channel itself
 * accepts any string the renderer sends — `shell.openExternal` on an
 * unvalidated string can launch arbitrary apps/URIs, so this allowlist
 * is the actual boundary, not just belt-and-suspenders.
 *   - `https:` — the only web scheme we ever launch
 *   - `x-apple.systempreferences:` — macOS's deep link into System
 *     Settings, used by the Screen Recording permission remedy above
 */
const ALLOWED_EXTERNAL_SCHEMES = ['https:', 'x-apple.systempreferences:']

function isAllowedExternalUrl(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  return ALLOWED_EXTERNAL_SCHEMES.includes(parsed.protocol)
}
