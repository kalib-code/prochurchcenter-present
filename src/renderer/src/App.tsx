import { useEffect } from 'react'
import { HashRouter, Route, Routes } from 'react-router-dom'
import { Home } from './pages/Home'
import { SongLibrary } from './pages/SongLibrary'
import { SongEditor } from './pages/SongEditor'
import { SetlistEditor } from './pages/SetlistEditor'
import { ServiceMode } from './pages/ServiceMode'
import { Settings } from './pages/Settings'
import { OutputView } from './output/OutputView'
import { StageView } from './output/StageView'
import { LowerThirdsView } from './output/LowerThirdsView'
import { useFontsStore } from './stores/useFontsStore'
import { useSetlistStore } from './stores/useSetlistStore'
import { useLibraryStore } from './stores/useLibraryStore'
import { AppShell } from './components/AppShell'
import { useRemoteControl } from './hooks/useRemoteControl'
import { useMidiInput } from './hooks/useMidiInput'

/**
 * Determine which renderer "kind" this window is by inspecting the
 * URL hash. Each on-demand projector window has its own dedicated
 * route so the renderer code paths stay separate and we don't ship
 * the operator UI bundle into every projector window.
 */
function windowKind(): 'operator' | 'output' | 'stage' | 'lowerthirds' {
  const hash = window.location.hash
  if (hash.includes('lowerthirds')) return 'lowerthirds'
  if (hash.includes('stage')) return 'stage'
  if (hash.includes('output')) return 'output'
  return 'operator'
}

function App(): JSX.Element {
  const kind = windowKind()

  // Load custom fonts on every renderer (operator AND output AND
  // stage AND lower thirds) so that theme.fontFamily values
  // referencing user-uploaded fonts resolve correctly in every
  // window. This also injects the @font-face style tag on first
  // load — without it, the projector would silently fall back to
  // system fonts whenever a custom font was selected.
  const loadCustomFonts = useFontsStore((s) => s.loadCustom)
  useEffect(() => {
    void loadCustomFonts()
  }, [loadCustomFonts])

  // AI tools (MCP) can add songs and setlist items while the operator
  // window is open. Keep the stores current so Home, the sidebar and the
  // library show the change; an open SetlistEditor also merges it into
  // its draft (see mergeExternalSetlist). Operator window only — the
  // projector windows never read these stores.
  useEffect(() => {
    if (kind !== 'operator') return
    return window.api.library.onExternalChange((change) => {
      if (change.kind === 'setlist') useSetlistStore.getState().applyExternal(change.setlist)
      else void useLibraryStore.getState().load()
    })
  }, [kind])

  // Remote cues (HTTP/OSC) forwarded by main: operator window only.
  useRemoteControl(kind === 'operator')
  useMidiInput(kind === 'operator')

  return (
    <HashRouter>
      <Routes>
        {kind === 'output' && (
          <Route path="/output" element={<OutputView />} />
        )}
        {kind === 'stage' && <Route path="/stage" element={<StageView />} />}
        {kind === 'lowerthirds' && (
          <Route path="/lowerthirds" element={<LowerThirdsView />} />
        )}
        {kind === 'operator' && (
          <>
            {/* Service Mode is full-screen: no sidebar while presenting. */}
            <Route path="/service/:setlistId" element={<ServiceMode />} />
            <Route element={<AppShell />}>
              <Route path="/" element={<Home />} />
              <Route path="/library" element={<SongLibrary />} />
              <Route path="/library/:id" element={<SongEditor />} />
              <Route path="/setlists/:id" element={<SetlistEditor />} />
              <Route path="/settings" element={<Settings />} />
            </Route>
          </>
        )}
      </Routes>
    </HashRouter>
  )
}

export default App
