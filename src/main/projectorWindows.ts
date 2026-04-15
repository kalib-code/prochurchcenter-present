/**
 * Creators for the on-demand projector-class windows: the stage
 * monitor and the lower thirds window. Lives in its own file so
 * main/index.ts doesn't balloon with three near-identical
 * BrowserWindow blocks.
 *
 * Both windows follow the same recipe as the main output window:
 *   - frame: false (borderless)
 *   - no fullscreen / simpleFullscreen / skipTaskbar / alwaysOnTop
 *     (those flags break desktopCapturer enumeration on macOS — see
 *     the long debugging saga in main/index.ts comments)
 *   - sized to cover their target display via setBounds(workArea)
 *   - title set explicitly to a unique marker so they're discoverable
 *     in capture APIs if the user wires them into OBS as a window
 *     source rather than a screen source
 */

import { BrowserWindow, screen, type Display } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import {
  setStageMonitorWindow,
  setLowerThirdsWindow,
  getStageMonitorWindow,
  getLowerThirdsWindow
} from './windows'
import {
  attachProjectorReplay,
  attachLowerThirdsReplay,
  attachStageReplay
} from './ipc/output'

const STAGE_TITLE = 'ProChurchCenter Present — Stage Monitor'
const LOWER_THIRDS_TITLE = 'ProChurchCenter Present — Lower Thirds'

/**
 * Pick the best default display for a secondary projector-class
 * window. Prefers any non-primary display (presumably the projector
 * or stage screen). On a single-monitor machine, falls back to
 * primary.
 */
function pickDefaultProjectorDisplay(): Display {
  const displays = screen.getAllDisplays()
  const primary = screen.getPrimaryDisplay()
  return displays.find((d) => d.id !== primary.id) ?? primary
}

/**
 * Resolve a saved display id to an actual Display object. Falls back
 * to the smart default if the saved id no longer exists (monitor was
 * unplugged since last run) — same forgiving behavior as the main
 * output window's setDisplay handler.
 */
function resolveDisplay(displayId: number | null): Display {
  if (displayId == null) return pickDefaultProjectorDisplay()
  return (
    screen.getAllDisplays().find((d) => d.id === displayId) ??
    pickDefaultProjectorDisplay()
  )
}

/**
 * Create the stage monitor window. Idempotent — if the window
 * already exists this is a no-op (callers should call
 * `getStageMonitorWindow()` first). Loads the renderer with the
 * `#/stage` hash route, which mounts a stripped-down OutputView with
 * audio disabled (the speaker hears the main output, not a second
 * audio source).
 */
export function createStageMonitorWindow(displayId: number | null): void {
  if (getStageMonitorWindow()) return

  const target = resolveDisplay(displayId)
  const win = new BrowserWindow({
    width: target.workArea.width,
    height: target.workArea.height,
    x: target.workArea.x,
    y: target.workArea.y,
    show: false,
    frame: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    title: STAGE_TITLE,
    backgroundColor: '#000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  // Pin the title so the renderer's <title> tag can't overwrite it
  // (same defense as the main output window).
  win.on('page-title-updated', (event) => event.preventDefault())
  win.webContents.on('did-finish-load', () => {
    if (!win.isDestroyed()) win.setTitle(STAGE_TITLE)
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#/stage`)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'stage' })
  }

  win.on('ready-to-show', () => {
    win.setBounds(target.workArea)
    win.show()
    // Open devtools in dev so we can debug stage rendering.
    if (is.dev) win.webContents.openDevTools({ mode: 'detach' })
  })

  // Replay current slide / mode / theme / video-control state into
  // the new window the moment it finishes loading, so the speaker
  // sees the same content as the projector instantly — they don't
  // have to wait for the operator to advance a slide.
  attachProjectorReplay(win)
  // Plus the rich stage context (current + next, notes, progress).
  attachStageReplay(win)
  setStageMonitorWindow(win)
}

export function destroyStageMonitorWindow(): void {
  const win = getStageMonitorWindow()
  if (win && !win.isDestroyed()) win.close()
  setStageMonitorWindow(null)
}

export function moveStageMonitorWindow(displayId: number | null): void {
  const win = getStageMonitorWindow()
  if (!win || win.isDestroyed()) return
  const target = resolveDisplay(displayId)
  win.setBounds(target.workArea)
}

/**
 * Height of the lower-thirds strip in pixels. The window is a thin
 * full-width strip at the bottom of the target display rather than
 * a full-screen window, for two reasons:
 *
 *   1. On a single-monitor dev setup, a full-screen lower-thirds
 *      window would be completely covered by the operator window
 *      and the user would never see it. A 280-pixel strip at the
 *      bottom remains visible regardless of operator-window state.
 *   2. OBS only captures the actual window bounds, so a 1920×280
 *      capture is much cheaper than a 1920×1080 capture where 88%
 *      of the pixels are wasted chroma green anyway.
 *
 * 280 pixels is enough vertical room for a two-line lower third
 * (title + subtitle) with comfortable padding above and below.
 */
const LOWER_THIRDS_HEIGHT = 280

/**
 * Create the lower thirds window. Sized as a full-width strip at
 * the bottom of the target display (see LOWER_THIRDS_HEIGHT for the
 * height rationale). Same minimal kiosk recipe as the stage monitor:
 * borderless, no fullscreen, no skipTaskbar, no alwaysOnTop.
 *
 * OBS captures this window as a Window Capture source. The
 * chroma-key filter in OBS keys out the configured background
 * color, leaving only the non-keyed pixels (the lower-third
 * graphic) visible in the broadcast.
 */
export function createLowerThirdsWindow(
  displayId: number | null,
  chromaKey: string,
  alignment: 'left' | 'center' | 'right' = 'left'
): void {
  if (getLowerThirdsWindow()) return

  const target = resolveDisplay(displayId)
  const stripBounds = {
    x: target.workArea.x,
    y: target.workArea.y + target.workArea.height - LOWER_THIRDS_HEIGHT,
    width: target.workArea.width,
    height: LOWER_THIRDS_HEIGHT
  }
  const win = new BrowserWindow({
    width: stripBounds.width,
    height: stripBounds.height,
    x: stripBounds.x,
    y: stripBounds.y,
    show: false,
    frame: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    title: LOWER_THIRDS_TITLE,
    backgroundColor: chromaKey,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  win.on('page-title-updated', (event) => event.preventDefault())
  win.webContents.on('did-finish-load', () => {
    if (!win.isDestroyed()) win.setTitle(LOWER_THIRDS_TITLE)
  })

  // Pass the chroma key color and text alignment via URL query.
  // The chroma is needed so the renderer paints the body background
  // to match the BrowserWindow background (otherwise the React app's
  // dark theme would overlay the chroma and OBS would have nothing
  // to key out). Alignment is passed at creation time rather than
  // via per-broadcast IPC because it's a global setting that rarely
  // changes — the window is re-created when the user changes it.
  const params = new URLSearchParams({
    chroma: chromaKey,
    align: alignment
  })
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(
      `${process.env['ELECTRON_RENDERER_URL']}#/lowerthirds?${params.toString()}`
    )
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), {
      hash: `lowerthirds?${params.toString()}`
    })
  }

  win.on('ready-to-show', () => {
    // Re-set the strip bounds explicitly. macOS sometimes ignores
    // the constructor x/y/width/height when the window is created
    // off-screen; setting again after show is reliable.
    win.setBounds(stripBounds)
    win.show()
    // Open devtools in dev so we can debug the chroma key window's
    // IPC subscription — without this, debugging the lower thirds
    // requires manually right-clicking on a window with no chrome.
    if (is.dev) win.webContents.openDevTools({ mode: 'detach' })
  })

  // Replay the last lower-thirds content payload so a window that's
  // been closed and re-opened comes up displaying whatever the
  // operator had set, not blank.
  attachLowerThirdsReplay(win)
  setLowerThirdsWindow(win)
}

export function destroyLowerThirdsWindow(): void {
  const win = getLowerThirdsWindow()
  if (win && !win.isDestroyed()) win.close()
  setLowerThirdsWindow(null)
}

export function moveLowerThirdsWindow(displayId: number | null): void {
  const win = getLowerThirdsWindow()
  if (!win || win.isDestroyed()) return
  const target = resolveDisplay(displayId)
  win.setBounds({
    x: target.workArea.x,
    y: target.workArea.y + target.workArea.height - LOWER_THIRDS_HEIGHT,
    width: target.workArea.width,
    height: LOWER_THIRDS_HEIGHT
  })
}
