/**
 * Output IPC handlers — the bridge between the operator renderer and
 * the output window.
 *
 * Flow:
 *   operator  invoke('output:setSlide', payload)
 *             ↓
 *   main      cache payload + send 'output:event:slide' to output window
 *             ↓
 *   output    ipcRenderer.on('output:event:slide', render)
 *
 * Main also caches the last slide + mode so that a hot-reloaded output
 * window (common in dev) immediately re-syncs to the current state by
 * requesting a "replay" the moment its dom-ready fires. In production
 * this also means the operator can close and reopen the output window
 * mid-service without losing state.
 */

import { ipcMain, screen, type BrowserWindow } from 'electron'
import {
  CHANNELS,
  type SlidePayload,
  type OutputMode,
  type VideoControl
} from '@shared/ipc-contract'
import type { ThemeOverride } from '@shared/types'
import { getOutputWindow } from '../windows'

// Cached state — main holds the current truth so late-joining renderers
// can resync. All reset at process start.
let lastSlide: SlidePayload | null = null
let currentMode: OutputMode = 'live'
// Latest per-item theme override pushed by the service store. Replayed
// on output-window did-finish-load so dev hot reloads don't lose the
// per-song theme when the service is mid-flight.
let lastItemOverride: ThemeOverride | null = null
// Latest video control (pause/mute) state. Replayed on did-finish-load
// so a hot-reloaded output window recovers the right playback state
// mid-video instead of restarting from the default.
let lastVideoControl: VideoControl = { paused: false, muted: false }

function sendToOutput(channel: string, payload: unknown): void {
  const win = getOutputWindow()
  if (!win || win.isDestroyed()) return
  win.webContents.send(channel, payload)
}

export function registerOutputHandlers(): void {
  ipcMain.handle(CHANNELS.output.setSlide, async (_, payload: SlidePayload) => {
    lastSlide = payload
    sendToOutput(CHANNELS.output.eventSlide, payload)
  })

  ipcMain.handle(CHANNELS.output.setBlack, async () => {
    currentMode = 'black'
    sendToOutput(CHANNELS.output.eventMode, currentMode)
  })

  ipcMain.handle(CHANNELS.output.setLogo, async () => {
    currentMode = 'logo'
    sendToOutput(CHANNELS.output.eventMode, currentMode)
  })

  ipcMain.handle(CHANNELS.output.setLive, async () => {
    currentMode = 'live'
    sendToOutput(CHANNELS.output.eventMode, currentMode)
    // Also resend the last slide in case the output window was showing
    // black/logo and needs to redraw the live content immediately.
    if (lastSlide) sendToOutput(CHANNELS.output.eventSlide, lastSlide)
  })

  ipcMain.handle(
    CHANNELS.output.setItemThemeOverride,
    async (_, override: ThemeOverride | null) => {
      lastItemOverride = override
      sendToOutput(CHANNELS.output.eventItemThemeOverride, override)
    }
  )

  ipcMain.handle(
    CHANNELS.output.setVideoControl,
    async (_, control: VideoControl) => {
      lastVideoControl = control
      sendToOutput(CHANNELS.output.eventVideoControl, control)
    }
  )

  ipcMain.handle(CHANNELS.output.listDisplays, async () => {
    const primary = screen.getPrimaryDisplay()
    return screen.getAllDisplays().map((d) => ({
      id: d.id,
      label: `${d.size.width}×${d.size.height}${d.id === primary.id ? ' (primary)' : ''}`,
      primary: d.id === primary.id
    }))
  })

  ipcMain.handle(CHANNELS.output.setDisplay, async (_, displayId: number | null) => {
    const win = getOutputWindow()
    if (!win || win.isDestroyed()) return

    // Resolve the target display. null means "primary". A saved id that no
    // longer exists (monitor unplugged since last run) also falls back to
    // primary — safest behavior for non-technical volunteers: they plug in
    // the projector, launch the app, output goes to *something* visible.
    const allDisplays = screen.getAllDisplays()
    const target =
      displayId == null
        ? screen.getPrimaryDisplay()
        : allDisplays.find((d) => d.id === displayId) ?? screen.getPrimaryDisplay()

    // Fullscreen + setBounds fight each other on macOS and Windows —
    // you must exit fullscreen, move, then re-enter. We also unset
    // alwaysOnTop briefly because some window managers ignore setBounds
    // on a top-most window mid-transition.
    const wasFullscreen = win.isFullScreen()
    if (wasFullscreen) win.setFullScreen(false)

    win.setBounds(target.workArea)

    // Re-enter fullscreen after a microtask so the OS picks up the new
    // position as the anchor for fullscreen. Without the delay macOS can
    // occasionally re-fullscreen on the OLD display.
    setTimeout(() => {
      if (win.isDestroyed()) return
      if (wasFullscreen) win.setFullScreen(true)
    }, 50)
  })
}

/**
 * Attach a did-finish-load listener that replays the last-known state
 * when the output window loads or reloads (common in dev hot reload;
 * safe no-op at first load since lastSlide is null).
 *
 * Called from main/index.ts AFTER the output window is created, since
 * registerOutputHandlers runs at app.whenReady before any window exists.
 */
export function attachOutputReplay(outputWindow: BrowserWindow): void {
  outputWindow.webContents.on('did-finish-load', () => {
    if (lastSlide) sendToOutput(CHANNELS.output.eventSlide, lastSlide)
    sendToOutput(CHANNELS.output.eventMode, currentMode)
    // Replay the current item override (may be null) so the output
    // window comes up with the correct per-song theme on dev reload.
    sendToOutput(CHANNELS.output.eventItemThemeOverride, lastItemOverride)
    // Replay video control (pause/mute) so a hot-reloaded output
    // window re-enters the right playback state.
    sendToOutput(CHANNELS.output.eventVideoControl, lastVideoControl)
  })
}
