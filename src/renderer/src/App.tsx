import { HashRouter, Route, Routes } from 'react-router-dom'
import { Home } from './pages/Home'
import { SongLibrary } from './pages/SongLibrary'
import { SongEditor } from './pages/SongEditor'
import { SetlistEditor } from './pages/SetlistEditor'
import { ServiceMode } from './pages/ServiceMode'
import { Settings } from './pages/Settings'
import { OutputView } from './output/OutputView'

function App(): JSX.Element {
  const isOutput = window.location.hash.includes('output')

  return (
    <HashRouter>
      <Routes>
        {isOutput ? (
          <Route path="/output" element={<OutputView />} />
        ) : (
          <>
            <Route path="/" element={<Home />} />
            <Route path="/library" element={<SongLibrary />} />
            <Route path="/library/:id" element={<SongEditor />} />
            <Route path="/setlists/:id" element={<SetlistEditor />} />
            <Route path="/service/:setlistId" element={<ServiceMode />} />
            <Route path="/settings" element={<Settings />} />
          </>
        )}
      </Routes>
    </HashRouter>
  )
}

export default App
