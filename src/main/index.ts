import { app, shell, BrowserWindow, protocol, net } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { ensureDirectories } from './storage/paths'
import { ensureDefaultTheme } from './storage/theme'
import { getSettings } from './storage/settings'
import { readAllSetlists } from './storage/setlists'
import { sweepOrphanPdfs } from './canva/import'
import { registerAllIpcHandlers } from './ipc'
import { initMcp, shutdownMcp } from './mcp'
import { isAllowedExternalUrl } from './ipc/system'
import { attachOutputReplay } from './ipc/output'
import {
  getOperatorWindow,
  markAppQuitting,
  setOperatorWindow,
  setOutputWindow,
  setOutputWindowFactory
} from './windows'
import {
  createStageMonitorWindow,
  createLowerThirdsWindow,
  closeAllProjectorWindows,
  registerDisplayChangeHandlers,
  resolveProjectorDisplay
} from './projectorWindows'
import { initAutoUpdater } from './updater'
import { runAutoBackupOnLaunch } from './storage/autoBackup'
import { fromMediaUrl } from '@shared/mediaUrl'
import { pendingWriteCount, waitForPendingWrites } from './storage/atomic'

/**
 * Single-instance lock.
 *
 * Two running instances would both write the same canva-tokens.enc.
 * Canva rotates refresh tokens on every use, so instance A refreshing
 * invalidates B's stored token; B's next refresh then gets rejected and
 * (via requireReauth() in canva/auth.ts) clears the *valid* tokens A just
 * wrote — both end up disconnected with no explanation. A second
 * instance's startup orphan-PDF sweep (below) can also delete a
 * `.pdf.tmp` file the first instance is mid-rename() on — the exact
 * hazard sweepOrphanPdfs's own doc comment says startup-only timing
 * depends on.
 *
 * This is a pre-existing app-wide gap (not Canva-specific), but Canva
 * import is the first thing that makes a second instance destructive
 * rather than merely confusing, so it is closed here.
 *
 * MUST run before app.whenReady() — this is Electron's documented
 * pattern: requestSingleInstanceLock() must be called as early as
 * possible so a second instance can quit before doing any work at all.
 */
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = getOperatorWindow()
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })
}

/**
 * Chromium's autoplay policy blocks HTMLMediaElement.play() with audio
 * unless there has been a user gesture in the document. The OUTPUT
 * window is a kiosk projector — it never receives clicks — so without
 * this switch, a <video> slide could never auto-play with sound.
 *
 * `no-user-gesture-required` is the most permissive setting; the app
 * takes full responsibility for deciding when audio should play. That
 * matches our model: the operator hits N in the operator window, main
 * sends a slide payload, the output window's <video> autoplays.
 *
 * MUST be called before `app.whenReady()` — the command-line switch
 * has to land before Chromium's browser process starts.
 */
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

/**
 * Custom protocol for loading user-picked local media.
 *
 * Why not plain `file://`? In dev the renderer loads from
 * http://localhost:<vite-port>, and Chromium's same-origin policy
 * refuses to load `file://` resources from an http origin. That shows
 * up as "Not allowed to load local resource" in devtools and broken
 * <img>/<video> elements.
 *
 * Two ways to fix:
 *   (a) `webSecurity: false` on the BrowserWindow — simple but
 *       disables same-origin policy globally
 *   (b) Register a custom privileged scheme that main process handles
 *       via `protocol.handle` — this is the modern Electron way
 *
 * We use (b). The renderer prepends `present-media://local` to an
 * absolute path; the handler strips the prefix, converts to a real
 * file:// URL, and streams the file back via `net.fetch`.
 *
 * The scheme is `standard + secure + stream + bypassCSP` so it works
 * for both <img> (standard) and <video> (stream) and isn't blocked by
 * any future Content-Security-Policy.
 *
 * NOTE: this registration MUST happen before `app.ready`, so it lives
 * at module top level, not inside whenReady().
 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'present-media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true
    }
  }
])

function createWindows(): void {
  // Operator window — normal resizable window, menu bar hidden for minimal chrome
  const operatorWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: 'ProChurchCenter Present',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    operatorWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    operatorWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  operatorWindow.on('ready-to-show', () => {
    operatorWindow.show()
    if (is.dev) operatorWindow.webContents.openDevTools()
  })

  operatorWindow.webContents.setWindowOpenHandler((details) => {
    // Same scheme allowlist as the system:openExternal IPC handler —
    // a `window.open`/target=_blank URL is renderer-controlled too, and
    // shell.openExternal on e.g. `file:` or a custom app scheme can
    // launch arbitrary local programs.
    if (isAllowedExternalUrl(details.url)) {
      shell.openExternal(details.url).catch((err) => {
        console.error('[window] openExternal failed', err)
      })
    } else {
      console.warn('[window] Blocked window.open for disallowed scheme:', details.url)
    }
    return { action: 'deny' }
  })

  // The operator window is the only one with a frame/close button. When
  // it goes, take the frameless output / stage / lower-thirds windows
  // with it — otherwise they stay up with no way to close them, and on
  // Windows/Linux `window-all-closed` never fires so the app never quits.
  // On macOS the app stays alive with zero windows and the `activate`
  // handler recreates the full set, same as any other last-window close.
  operatorWindow.on('closed', () => {
    closeAllProjectorWindows()
  })

  // Register with the global registry so ipc/output.ts can reach the
  // operator (and so ensureOutputWindow knows the operator is alive).
  setOperatorWindow(operatorWindow)
  setOutputWindowFactory(createOutputWindow)
  createOutputWindow()

  // Restore stage monitor + lower thirds windows if the user had
  // them enabled in their last session. Created lazily (i.e. on
  // demand) so the app doesn't pay the cost of spawning two
  // additional renderers for users who don't use these features.
  void getSettings().then((settings) => {
    if (settings.stageMonitorEnabled) {
      createStageMonitorWindow(settings.stageMonitorDisplayId)
    }
    if (settings.lowerThirdsEnabled) {
      createLowerThirdsWindow(
        settings.lowerThirdsDisplayId,
        settings.lowerThirdsChromaKey,
        settings.lowerThirdsAlignment
      )
    }
  })
}

/**
 * Create the output (projector) window and register it. Called at
 * startup and again by ensureOutputWindow() (windows.ts) if the window
 * was closed mid-session. `displayId` overrides the saved
 * `outputDisplayId` (used when the operator picks a display while the
 * window is closed).
 */
function createOutputWindow(displayId?: number | null): BrowserWindow {
  // Output window — borderless (no title bar or traffic lights),
  // manually sized to cover the target display, kept above everything
  // via alwaysOnTop. We deliberately DO NOT use Electron's fullscreen
  // or simpleFullscreen APIs on macOS because both escalate the
  // window to a high NSWindowLevel that filters it out of
  // CGWindowListCopyWindowInfo — which means desktopCapturer can't
  // see it, which breaks Option C (confidence-monitor pixel mirror).
  //
  // The borderless + cover-the-screen + alwaysOnTop combination gives
  // the congregation the same visual result (an entire screen full
  // of slide content with nothing else visible) while keeping the
  // window a plain enumerable NSFloatingWindowLevel entry that
  // desktopCapturer and other capture APIs can find normally.
  // Deliberate absences in this config (each one breaks Option C
  // pixel mirroring in a specific way on macOS):
  //
  //   * `skipTaskbar: true`   — maps to NSWindowCollectionBehaviorTransient,
  //                             excludes from CGWindowListCopyWindowInfo.
  //   * `alwaysOnTop: true`   — sets NSFloatingWindowLevel, which
  //                             Chromium's desktop_capturer_mac filters
  //                             out (it only enumerates windows at
  //                             kCGWindowLayer == 0).
  //   * `resizable: false`    — locks NSWindow size constraints to
  //                             constructor dimensions, causing
  //                             subsequent setBounds() to no-op.
  //   * `fullscreen: true`    — moves the window into its own Mission
  //                             Control space on macOS, hiding it from
  //                             desktopCapturer's window list.
  //
  // In production the operator and output will be on separate
  // monitors, so losing "always on top" costs nothing. In dev on a
  // single monitor, clicking the operator brings it forward of the
  // output — that's acceptable for development.
  //
  // `frame: false` + bounds-covering-the-display + alwaysOnTop-
  // equivalent achieved via manual re-raising (see moveTop handler
  // below) gives us the kiosk look while staying capturable.
  const outputWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    show: false,
    frame: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    title: 'ProChurchCenter Present — Output',
    backgroundColor: '#000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  // Pin the output window's OS-level title so the renderer's <title> tag
  // can't overwrite it. Necessary because desktopCapturer identifies
  // windows by title, and if both windows end up with the same title
  // after their HTML loads, the confidence monitor's screen-mirror ends
  // up capturing the operator window (i.e. itself) — recursion city.
  //
  // Belt + suspenders: preventDefault on page-title-updated AND a forced
  // setTitle on did-finish-load. The preventDefault was flaky across
  // Electron versions on macOS historically, so we don't trust it alone.
  // The did-finish-load handler also covers dev HMR reloads that can
  // re-trigger document-title mutation independently of the event.
  const OUTPUT_TITLE = 'ProChurchCenter Present — Output'
  outputWindow.on('page-title-updated', (event) => {
    event.preventDefault()
  })
  outputWindow.webContents.on('did-finish-load', () => {
    if (!outputWindow.isDestroyed()) outputWindow.setTitle(OUTPUT_TITLE)
  })

  // Forward the output renderer's console messages into the main-
  // process terminal (the one running `pnpm dev`). The output
  // window is borderless and on a single-monitor dev setup its
  // detached devtools are easy to lose track of, so piping logs
  // back to the always-visible terminal makes debugging far less
  // painful. Only enabled in dev — production builds keep the
  // renderer console isolated.
  if (is.dev) {
    outputWindow.webContents.on(
      'console-message',
      (_event, level, message, line, sourceId) => {
        // Chromium console levels: 0=verbose, 1=info, 2=warning, 3=error.
        // Map to corresponding console method on main side.
        const prefix = '[output-renderer]'
        if (level >= 3) console.error(prefix, message, `(${sourceId}:${line})`)
        else if (level === 2) console.warn(prefix, message)
        else console.log(prefix, message)
      }
    )
  }

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    outputWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#/output`)
  } else {
    outputWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'output' })
  }

  // Target display: the explicit/saved one if it is still attached,
  // otherwise the first non-primary display (Ate Rose plugs in the
  // projector and expects slides to land there, not on her laptop),
  // otherwise primary. Resolved once, applied at ready-to-show — the
  // old code applied the saved display in a separate settings callback
  // that could run BEFORE ready-to-show, whose default then won.
  const savedDisplayId: Promise<number | null> =
    displayId !== undefined
      ? Promise.resolve(displayId)
      : getSettings()
          .then((s) => s.outputDisplayId)
          .catch(() => null)

  outputWindow.on('ready-to-show', () => {
    void savedDisplayId.then((id) => {
      if (outputWindow.isDestroyed()) return
      // Borderless windowed approach: moving is a straight setBounds
      // call. No fullscreen API to toggle.
      outputWindow.setBounds(resolveProjectorDisplay(id).workArea)
      outputWindow.show()
      // Open devtools on the output window in dev mode too — otherwise
      // errors in the renderer that runs the projector view (image loads,
      // font decoding, etc) are invisible because the operator window's
      // devtools only shows the operator renderer's console.
      if (is.dev) outputWindow.webContents.openDevTools({ mode: 'detach' })
    })
  })

  // Register with the global registry so ipc/output.ts can broadcast
  // slide payloads into the output renderer; replay brings a new (or
  // recreated) window up on the current slide.
  setOutputWindow(outputWindow)
  attachOutputReplay(outputWindow)
  return outputWindow
}

app.whenReady().then(async () => {
  // A second instance already called app.quit() above, before this
  // callback could ever run. app.quit() does not synchronously halt
  // remaining module execution, so without this guard a second instance
  // would still create windows and run the orphan-PDF sweep below —
  // exactly the concurrent-startup hazard the single-instance lock exists
  // to prevent — in the brief window before quit takes effect.
  if (!gotSingleInstanceLock) return

  electronApp.setAppUserModelId('com.prochurchcenter.present')

  // Prepare persistent storage before anything else touches disk.
  ensureDirectories()
  await ensureDefaultTheme()

  // Register the present-media:// protocol handler. The renderer uses
  // URLs like `present-media://local/Users/kael/Downloads/logo.jpeg`.
  // We parse out the absolute path and stream the file back.
  //
  // CRITICAL: forward the request's headers (especially Range) to
  // net.fetch so byte-range requests propagate to the underlying
  // file fetch. Without this, Chromium's <video> element can't seek
  // back to position 0 to loop, and `currentTime` writes silently
  // fail because the response doesn't include Content-Range /
  // Accept-Ranges headers. This was the root cause of "videos
  // stop instead of looping" — videos played fine until the loop
  // point, where the browser tried to seek and gave up.
  protocol.handle('present-media', async (request) => {
    try {
      // Shared decoder (src/shared/mediaUrl.ts) — the exact inverse of
      // the renderer's toMediaUrl, including `#`/`?` in filenames and
      // Windows drive paths (`/C:/Users/...` → `C:/Users/...`).
      const absPath = fromMediaUrl(request.url)
      if (!absPath) return new Response('Not Found', { status: 404 })
      // Forward request headers so Range requests reach the file
      // layer. pathToFileURL handles platform-specific encoding
      // (Windows drive letters, etc) correctly.
      //
      // `await` matters: net.fetch rejects asynchronously for a missing
      // file (net::ERR_FILE_NOT_FOUND). Returning the bare promise would
      // let that rejection escape this try/catch instead of becoming a 404.
      return await net.fetch(pathToFileURL(absPath).toString(), {
        headers: request.headers
      })
    } catch (err) {
      console.error('[present-media] failed to load', request.url, err)
      return new Response('Not Found', { status: 404 })
    }
  })

  // Register every IPC handler the renderer can call.
  registerAllIpcHandlers()

  // Housekeeping: drop Canva PDFs no setlist references any more.
  // Refresh deletes the file it supersedes, but deleting a setlist item
  // does not — without this, media/canva/ grows without bound.
  //
  // Fire-and-forget: startup must never block or fail on housekeeping.
  void (async () => {
    try {
      const { setlists, failed } = await readAllSetlists()
      // A setlist we couldn't read may still reference PDFs here; with
      // it missing from `referenced`, its PDFs would look orphaned and
      // be deleted. Skip the whole sweep — a leftover PDF costs disk
      // space, a deleted one breaks a service.
      if (failed.length > 0) {
        console.warn(
          `[canva] skipping orphan sweep: ${failed.length} setlist file(s) unreadable`,
          failed
        )
        return
      }
      // Every deck's pdfPath counts as referenced, not just ones with a
      // `canva` key. A deck can point into media/canva/ without that key
      // (a hand-picked PDF that happens to live there, or one that lost
      // its `canva` key via the "Change PDF…" fix in SetlistItemCard.tsx)
      // — narrowing to `item.canva` here would let this sweep delete a
      // file a setlist still uses. Widening costs nothing: sweeping is
      // strictly about removing files nothing references any more.
      const referenced = setlists.flatMap((s) =>
        s.items.flatMap((item) => (item.kind === 'deck' ? [item.pdfPath] : []))
      )
      const removed = await sweepOrphanPdfs(referenced)
      if (removed > 0) console.log(`[canva] removed ${removed} orphaned PDF(s)`)
    } catch (err) {
      console.error('[canva] orphan sweep failed', err)
    }
  })()

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindows()

  // Keep frameless projector windows on a real screen when a display is
  // unplugged, and move them back when it returns. Registered once
  // (screen events are app-wide), after windows exist.
  registerDisplayChangeHandlers()

  // Wire auto-updater after windows are created. The updater is a
  // no-op in dev mode (app.isPackaged === false) so this is safe at
  // every startup. See src/main/updater.ts for the full lifecycle.
  initAutoUpdater()

  // Kick off the daily auto-backup check. Fire-and-forget — the
  // scheduler waits 5s internally before doing any I/O so the first
  // paint of the operator window isn't competing with a zip write.
  // Errors are caught inside the scheduler; they never propagate
  // here. See src/main/storage/autoBackup.ts.
  void runAutoBackupOnLaunch()

  // AI connections: start the local MCP server if the operator left it
  // on. After createWindows so its first status broadcast has a window
  // to reach. Failures (port taken) land in Settings, never here.
  void initMcp().catch((err) => console.error('[mcp] init failed', err))

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindows()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

/**
 * Hold the quit until in-flight library writes land.
 *
 * Why: the operator renderer flushes its autosave on window close, which
 * reaches main as an IPC → atomicWriteJson. Quitting mid-write leaves
 * the tmp file un-renamed and the edit lost. So if writes are pending,
 * cancel this quit, wait (bounded — a wedged disk must not make the app
 * unquittable), then quit again.
 *
 * Both events: `before-quit` covers writes already running when quit
 * starts; `will-quit` (after all windows have closed) covers the flush
 * the closing window itself just sent.
 *
 * Loop guard: each event holds the quit at most once per process (so
 * the re-issued app.quit() always goes through), and a quit that
 * arrives while we're already draining is swallowed — the drain
 * finishes with its own app.quit().
 */
const QUIT_WRITE_DRAIN_TIMEOUT_MS = 3000
let quitDrainInProgress = false
const quitHoldsUsed = new Set<'before-quit' | 'will-quit'>()

function holdQuitForPendingWrites(
  event: Electron.Event,
  phase: 'before-quit' | 'will-quit'
): void {
  if (quitDrainInProgress) {
    event.preventDefault()
    return
  }
  if (quitHoldsUsed.has(phase) || pendingWriteCount() === 0) return
  event.preventDefault()
  quitHoldsUsed.add(phase)
  quitDrainInProgress = true
  void waitForPendingWrites(QUIT_WRITE_DRAIN_TIMEOUT_MS).then((drained) => {
    if (!drained) {
      console.warn(
        `[quit] ${pendingWriteCount()} write(s) still pending after ${QUIT_WRITE_DRAIN_TIMEOUT_MS}ms; quitting anyway`
      )
    }
    quitDrainInProgress = false
    app.quit()
  })
}

app.on('before-quit', (event) => {
  // Windows closing as part of the quit must not trigger output-window
  // recreation (see ensureOutputWindow in windows.ts).
  markAppQuitting()
  holdQuitForPendingWrites(event, 'before-quit')
})
app.on('will-quit', (event) => holdQuitForPendingWrites(event, 'will-quit'))

// Close the AI-connections listener so the port is free for the next
// launch straight away. Process exit would close it too; this is tidy.
app.on('will-quit', () => {
  void shutdownMcp()
})
