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

import { ipcMain, screen, desktopCapturer, type BrowserWindow } from 'electron'
import {
  CHANNELS,
  type SlidePayload,
  type OutputMode,
  type VideoControl,
  type VideoTimeUpdate,
  type LowerThirdsContent,
  type StageContext
} from '@shared/ipc-contract'
import type { ThemeOverride } from '@shared/types'
import {
  getOutputWindow,
  ensureOutputWindow,
  getOperatorWindow,
  getAllProjectorWindows,
  getLowerThirdsWindow
} from '../windows'
import {
  createStageMonitorWindow,
  destroyStageMonitorWindow,
  moveStageMonitorWindow,
  createLowerThirdsWindow,
  destroyLowerThirdsWindow,
  moveLowerThirdsWindow
} from '../projectorWindows'
import { getSettings, updateSettings } from '../storage/settings'

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
// Latest lower thirds payload. Cached so the lower thirds window
// re-renders to the correct state on hot reload, and so newly-created
// stage / lower thirds windows can pick up the current content.
let lastLowerThirds: LowerThirdsContent = {
  visible: false,
  title: '',
  subtitle: ''
}
// Latest stage monitor context. Cached for the same reasons as
// lastSlide / lastLowerThirds — newly opened stage monitor windows
// (on-demand creation, dev hot reload) need to pick up where they
// left off rather than starting blank.
let lastStageContext: StageContext = {
  currentSlide: null,
  nextSlide: null,
  itemLabel: '',
  slideIndex: 0,
  totalSlides: 0,
  notes: ''
}

/**
 * Broadcast to every "projector-class" window that mirrors slide
 * content — currently the main output and (when enabled) the stage
 * monitor. Used by every slide/mode/theme/videoControl handler so
 * the stage monitor stays in lockstep with the output without
 * requiring any per-handler awareness of its existence.
 */
function sendToProjectors(channel: string, payload: unknown): void {
  // Recreate the output window if it was closed — otherwise every
  // broadcast for the rest of the service silently went nowhere. The
  // new window catches up via attachProjectorReplay on load.
  ensureOutputWindow()
  for (const win of getAllProjectorWindows()) {
    win.webContents.send(channel, payload)
  }
}

/**
 * Forward to the OPERATOR window (not the output). Used by the video
 * time-update broadcast — the output renderer is the SOURCE of those
 * events and must not also receive them, otherwise it would loop.
 */
function sendToOperator(channel: string, payload: unknown): void {
  const win = getOperatorWindow()
  if (!win || win.isDestroyed()) return
  win.webContents.send(channel, payload)
}

export function registerOutputHandlers(): void {
  ipcMain.handle(CHANNELS.output.setSlide, async (_, payload: SlidePayload) => {
    lastSlide = payload
    sendToProjectors(CHANNELS.output.eventSlide, payload)
  })

  ipcMain.handle(CHANNELS.output.setBlack, async () => {
    currentMode = 'black'
    sendToProjectors(CHANNELS.output.eventMode, currentMode)
  })

  ipcMain.handle(CHANNELS.output.setLogo, async () => {
    currentMode = 'logo'
    sendToProjectors(CHANNELS.output.eventMode, currentMode)
  })

  ipcMain.handle(CHANNELS.output.setLive, async () => {
    currentMode = 'live'
    sendToProjectors(CHANNELS.output.eventMode, currentMode)
    // Also resend the last slide in case the projector(s) were showing
    // black/logo and need to redraw the live content immediately.
    if (lastSlide) sendToProjectors(CHANNELS.output.eventSlide, lastSlide)
  })

  ipcMain.handle(
    CHANNELS.output.setItemThemeOverride,
    async (_, override: ThemeOverride | null) => {
      lastItemOverride = override
      sendToProjectors(CHANNELS.output.eventItemThemeOverride, override)
    }
  )

  ipcMain.handle(
    CHANNELS.output.setVideoControl,
    async (_, control: VideoControl) => {
      lastVideoControl = control
      sendToProjectors(CHANNELS.output.eventVideoControl, control)
    }
  )

  // High-frequency video position broadcast: output -> operator only.
  // No caching (it's continuous live state, no point replaying on
  // hot-reload). Doesn't echo back to the sender.
  ipcMain.handle(
    CHANNELS.output.setVideoTimeUpdate,
    async (_, update: VideoTimeUpdate) => {
      sendToOperator(CHANNELS.output.eventVideoTimeUpdate, update)
    }
  )

  // One-shot "video reached natural end" notification: output ->
  // operator only. Forwarded so ServiceMode can auto-advance the
  // setlist for non-looping videos. Not cached because this is an
  // edge-triggered event — replaying it after a hot-reload would
  // re-trigger a setlist advance that already happened.
  ipcMain.handle(
    CHANNELS.output.setVideoEnded,
    async (_, payload: { videoPath: string }) => {
      sendToOperator(CHANNELS.output.eventVideoEnded, payload)
    }
  )

  // Option C: mirror the output window's pixels into the operator
  // confidence monitor for video playback. Because the output window
  // uses simpleFullscreen (not native macOS fullscreen), it stays in
  // the OS-level window list and can be captured directly by
  // desktopCapturer's window source. We match by title — the em-dash
  // "— Output" is a safe unique marker that can't collide with
  // anything on a typical user's desktop, and the title is pinned
  // via page-title-updated + did-finish-load handlers in main/index.ts.
  ipcMain.handle(CHANNELS.output.getCaptureSourceId, async () => {
    const outputWin = getOutputWindow()
    if (!outputWin || outputWin.isDestroyed()) return null

    // Force the title back once more immediately before querying — if
    // a renderer just HMR-reloaded and pushed a new document title,
    // the did-finish-load correction may not have fired yet by the
    // time we're asked to look up the source.
    outputWin.setTitle('ProChurchCenter Present — Output')

    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 0, height: 0 },
      fetchWindowIcons: false
    })

    const MARKER = '— Output'
    const match = sources.find((s) => s.name.includes(MARKER))
    if (!match) {
      console.warn(
        `[output:getCaptureSourceId] no window source matched marker="${MARKER}". ` +
          `candidates: ${sources
            .map((s) => JSON.stringify(s.name))
            .join(', ')}`
      )
    }
    return match?.id ?? null
  })

  ipcMain.handle(CHANNELS.output.listDisplays, async () => {
    const primary = screen.getPrimaryDisplay()
    return screen.getAllDisplays().map((d) => ({
      id: d.id,
      label: `${d.size.width}×${d.size.height}${d.id === primary.id ? ' (primary)' : ''}`,
      primary: d.id === primary.id
    }))
  })

  ipcMain.handle(CHANNELS.output.setDisplay, async (_, displayId: number | null) => {
    // Explicit operator action: bring a closed output window back on the
    // display they just picked (the new window places itself there).
    const existing = getOutputWindow()
    if (!existing || existing.isDestroyed()) {
      ensureOutputWindow(displayId)
      return
    }
    const win = existing

    // Resolve the target display. null means "primary". A saved id that no
    // longer exists (monitor unplugged since last run) also falls back to
    // primary — safest behavior for non-technical volunteers: they plug in
    // the projector, launch the app, output goes to *something* visible.
    const allDisplays = screen.getAllDisplays()
    const target =
      displayId == null
        ? screen.getPrimaryDisplay()
        : allDisplays.find((d) => d.id === displayId) ?? screen.getPrimaryDisplay()

    // Borderless windowed (see main/index.ts output window options)
    // — moving between displays is just a setBounds call with the
    // target display's workArea.
    win.setBounds(target.workArea)
  })

  // ── Stage monitor lifecycle ───────────────────────────────────────
  ipcMain.handle(
    CHANNELS.output.setStageMonitorEnabled,
    async (_, enabled: boolean) => {
      await updateSettings({ stageMonitorEnabled: enabled })
      if (enabled) {
        const settings = await getSettings()
        createStageMonitorWindow(settings.stageMonitorDisplayId)
      } else {
        destroyStageMonitorWindow()
      }
    }
  )

  ipcMain.handle(
    CHANNELS.output.setStageMonitorDisplay,
    async (_, displayId: number | null) => {
      await updateSettings({ stageMonitorDisplayId: displayId })
      moveStageMonitorWindow(displayId)
    }
  )

  // ── Lower thirds lifecycle ────────────────────────────────────────
  ipcMain.handle(
    CHANNELS.output.setLowerThirdsEnabled,
    async (_, enabled: boolean) => {
      await updateSettings({ lowerThirdsEnabled: enabled })
      if (enabled) {
        const settings = await getSettings()
        createLowerThirdsWindow(
          settings.lowerThirdsDisplayId,
          settings.lowerThirdsChromaKey,
          settings.lowerThirdsAlignment
        )
      } else {
        destroyLowerThirdsWindow()
      }
    }
  )

  ipcMain.handle(
    CHANNELS.output.setLowerThirdsDisplay,
    async (_, displayId: number | null) => {
      await updateSettings({ lowerThirdsDisplayId: displayId })
      moveLowerThirdsWindow(displayId)
    }
  )

  ipcMain.handle(
    CHANNELS.output.setLowerThirdsContent,
    async (_, content: LowerThirdsContent) => {
      console.log('[ipc:setLowerThirdsContent]', content)
      lastLowerThirds = content
      const win = getLowerThirdsWindow()
      if (!win || win.isDestroyed()) {
        console.warn(
          '[ipc:setLowerThirdsContent] no lower thirds window — payload cached only'
        )
        return
      }
      win.webContents.send(CHANNELS.output.eventLowerThirdsContent, content)
    }
  )

  // Stage monitor context broadcast. Operator-driven, sent on every
  // slide change so the speaker-facing window always knows what the
  // current and next slide are without having to peek into the
  // operator's setlist store.
  //
  // Also delivered to the main output window (via sendToProjectors,
  // same as every other handler in this file — this used to be the one
  // handler that special-cased "stage monitor only"). The output window
  // doesn't use this for anything it renders — it still renders purely
  // from output:event:slide — but it DOES use the `nextSlide` field to
  // warm a PowerPoint deck's parse (loadPptxDeck) one slide ahead of the
  // operator actually advancing into it. Without this, the output
  // window has zero lookahead (onSlide only ever tells it about the
  // CURRENT slide, at the same moment it needs to render it), so the
  // first advance into any pptx deck pays the full cold-parse cost live,
  // in front of the congregation. See PptxSlideView.tsx / OutputView.tsx.
  ipcMain.handle(
    CHANNELS.output.setStageContext,
    async (_, context: StageContext) => {
      lastStageContext = context
      sendToProjectors(CHANNELS.output.eventStageContext, context)
    }
  )
}

/**
 * Attach a did-finish-load listener that replays the last-known
 * slide / mode / theme / video-control state to a projector-class
 * window when it loads or reloads (common in dev hot reload, also
 * fires when the stage monitor is created on demand mid-service).
 *
 * Called from main/index.ts (for the main output window) and from
 * the stage monitor enable handler (for the stage monitor window
 * once it exists).
 */
export function attachProjectorReplay(projectorWindow: BrowserWindow): void {
  const send = (channel: string, payload: unknown): void => {
    if (projectorWindow.isDestroyed()) return
    projectorWindow.webContents.send(channel, payload)
  }
  projectorWindow.webContents.on('did-finish-load', () => {
    if (lastSlide) send(CHANNELS.output.eventSlide, lastSlide)
    send(CHANNELS.output.eventMode, currentMode)
    // Replay the current item override (may be null) so the window
    // comes up with the correct per-song theme on reload / on-demand
    // creation.
    send(CHANNELS.output.eventItemThemeOverride, lastItemOverride)
    // Replay video control (pause/mute) so a hot-reloaded projector
    // window re-enters the right playback state.
    send(CHANNELS.output.eventVideoControl, lastVideoControl)
    // Replay the last stage context too, now that the output window also
    // consumes it (for pptx deck warming — see the setStageContext
    // handler above). A dev hot-reload or on-demand recreation of the
    // output window would otherwise sit with no lookahead until the
    // operator's next slide change.
    send(CHANNELS.output.eventStageContext, lastStageContext)
  })
}

/**
 * Backwards-compat alias for the old name. Existing callers in
 * main/index.ts don't need to change.
 */
export const attachOutputReplay = attachProjectorReplay

/**
 * Attach the lower-thirds-content replay to the lower thirds window.
 * Smaller surface than the projector replay because lower thirds
 * only has one piece of state (the current title/subtitle/visibility).
 */
export function attachLowerThirdsReplay(lowerThirdsWindow: BrowserWindow): void {
  lowerThirdsWindow.webContents.on('did-finish-load', () => {
    if (lowerThirdsWindow.isDestroyed()) return
    console.log(
      '[attachLowerThirdsReplay] replaying cached content',
      lastLowerThirds
    )
    lowerThirdsWindow.webContents.send(
      CHANNELS.output.eventLowerThirdsContent,
      lastLowerThirds
    )
  })
}

/**
 * Attach the stage-context replay to the stage monitor window.
 * Sends the full StageContext snapshot the moment the renderer
 * finishes loading so an on-demand or hot-reloaded stage monitor
 * comes up displaying the same current/next/notes the operator was
 * already broadcasting.
 */
export function attachStageReplay(stageWindow: BrowserWindow): void {
  stageWindow.webContents.on('did-finish-load', () => {
    if (stageWindow.isDestroyed()) return
    stageWindow.webContents.send(
      CHANNELS.output.eventStageContext,
      lastStageContext
    )
  })
}
