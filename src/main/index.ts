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
    title: 'Present',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  // Output window — fullscreen, alwaysOnTop (kiosk mode, so volunteers can't
  // accidentally minimize the projector during service)
  const outputWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    show: false,
    fullscreen: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    autoHideMenuBar: true,
    title: 'Present — Output',
    backgroundColor: '#000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

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
    if (savedId == null) return
    const target = screen.getAllDisplays().find((d) => d.id === savedId)
    if (!target) return // saved display disconnected; stay on primary
    // Same dance as ipc/output.ts setDisplay — exit fullscreen, move, re-enter.
    const wasFullscreen = outputWindow.isFullScreen()
    if (wasFullscreen) outputWindow.setFullScreen(false)
    outputWindow.setBounds(target.workArea)
    if (wasFullscreen) {
      setTimeout(() => {
        if (!outputWindow.isDestroyed()) outputWindow.setFullScreen(true)
      }, 50)
    }
  })
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.sundaytask.present')

  // Prepare persistent storage before anything else touches disk.
  ensureDirectories()
  await ensureDefaultTheme()

  // Register the present-media:// protocol handler. The renderer uses
  // URLs like `present-media://local/Users/kael/Downloads/logo.jpeg`.
  // We parse out the absolute path and stream the file back.
  protocol.handle('present-media', (request) => {
    try {
      const url = new URL(request.url)
      // url.host is 'local', url.pathname is '/Users/kael/Downloads/logo.jpeg'
      // decodeURIComponent reverses the encodeURI the renderer applied.
      const absPath = decodeURIComponent(url.pathname)
      // net.fetch on a file:// URL returns the file contents as a Response,
      // which Electron then hands to the requesting <img>/<video>. Using
      // pathToFileURL handles platform-specific encoding (Windows drive
      // letters, etc) correctly.
      return net.fetch(pathToFileURL(absPath).toString())
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
