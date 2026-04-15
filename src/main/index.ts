import { app, shell, BrowserWindow, protocol, net } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { screen } from 'electron'
import { ensureDirectories } from './storage/paths'
import { ensureDefaultTheme } from './storage/theme'
import { getSettings } from './storage/settings'
import { registerAllIpcHandlers } from './ipc'
import { attachOutputReplay } from './ipc/output'
import { setOperatorWindow, setOutputWindow } from './windows'
import {
  createStageMonitorWindow,
  createLowerThirdsWindow
} from './projectorWindows'
import { initAutoUpdater } from './updater'

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

  // Load windows — same bundle, different hash routes
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    operatorWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    outputWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#/output`)
  } else {
    operatorWindow.loadFile(join(__dirname, '../renderer/index.html'))
    outputWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'output' })
  }

  operatorWindow.on('ready-to-show', () => {
    operatorWindow.show()
    if (is.dev) operatorWindow.webContents.openDevTools()
  })

  outputWindow.on('ready-to-show', () => {
    // Pick the best default display for the output window:
    //   1. If there's a non-primary display attached (i.e. a projector
    //      or external monitor is plugged in), use that — Ate Rose
    //      plugs in the projector and expects the slides to land
    //      there immediately, not on her laptop screen.
    //   2. Otherwise (laptop only / dev), fall back to primary so
    //      the window is at least visible and developers can iterate.
    //
    // The async settings load below will further override this if
    // the user has explicitly picked a display in Settings.
    const displays = screen.getAllDisplays()
    const primary = screen.getPrimaryDisplay()
    const defaultTarget =
      displays.find((d) => d.id !== primary.id) ?? primary
    outputWindow.setBounds(defaultTarget.workArea)
    outputWindow.show()
    // Open devtools on the output window in dev mode too — otherwise
    // errors in the renderer that runs the projector view (image loads,
    // font decoding, etc) are invisible because the operator window's
    // devtools only shows the operator renderer's console.
    if (is.dev) outputWindow.webContents.openDevTools({ mode: 'detach' })
  })

  operatorWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Register the two windows with the global registry so ipc/output.ts
  // can broadcast slide payloads into the output renderer.
  setOperatorWindow(operatorWindow)
  setOutputWindow(outputWindow)
  attachOutputReplay(outputWindow)

  // Restore saved output display. Fire-and-forget — if settings can't be
  // read or the saved display no longer exists, the window stays on
  // primary (which is where it was just created) and the user can pick
  // a different display from Settings.
  void getSettings().then((settings) => {
    const savedId = settings.outputDisplayId
    if (savedId != null) {
      const target = screen.getAllDisplays().find((d) => d.id === savedId)
      if (target) {
        // Borderless windowed approach: moving is a straight setBounds
        // call. No fullscreen API to toggle.
        outputWindow.setBounds(target.workArea)
      }
    }

    // Restore stage monitor + lower thirds windows if the user had
    // them enabled in their last session. Created lazily (i.e. on
    // demand) so the app doesn't pay the cost of spawning two
    // additional renderers for users who don't use these features.
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

app.whenReady().then(async () => {
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
  protocol.handle('present-media', (request) => {
    try {
      const url = new URL(request.url)
      // url.host is 'local', url.pathname is '/Users/kael/Downloads/logo.jpeg'
      // decodeURIComponent reverses the encodeURI the renderer applied.
      const absPath = decodeURIComponent(url.pathname)
      // Forward request headers so Range requests reach the file
      // layer. pathToFileURL handles platform-specific encoding
      // (Windows drive letters, etc) correctly.
      return net.fetch(pathToFileURL(absPath).toString(), {
        headers: request.headers
      })
    } catch (err) {
      console.error('[present-media] failed to load', request.url, err)
      return new Response('Not Found', { status: 404 })
    }
  })

  // Register every IPC handler the renderer can call.
  registerAllIpcHandlers()

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindows()

  // Wire auto-updater after windows are created. The updater is a
  // no-op in dev mode (app.isPackaged === false) so this is safe at
  // every startup. See src/main/updater.ts for the full lifecycle.
  initAutoUpdater()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindows()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
