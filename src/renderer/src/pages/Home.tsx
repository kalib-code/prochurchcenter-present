/**
 * Home — the first screen Ate Rose sees when she opens Present.
 *
 * Renders inside AppShell, so there is no app header or nav here: the
 * sidebar owns Home / Songs / Settings and the always-visible
 * "New setlist" button.
 *
 * Next service card (`rounded-xl bg-raised`):
 *   - Left pane  : "Next service" / "Today" label, setlist name, date ·
 *                  items · slides meta, an amber one-line pre-flight
 *                  nudge (if any check needs attention), Start service /
 *                  Edit / Rehearse, and quiet Clone / Delete actions.
 *   - Right pane : Service plan — the first five items with neutral kind
 *                  badges, so the operator sees AT A GLANCE what the
 *                  service looks like without opening it.
 *
 * Below the card: the pre-flight checklist (checked on launch and on
 * demand — never polled), then the other saved setlists as a card grid.
 */

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { PreflightCheck, PreflightReport } from '@shared/ipc-contract'
import type { Song } from '@shared/types'
import { useSetlistStore } from '../stores/useSetlistStore'
import { useLibraryStore } from '../stores/useLibraryStore'
import {
  nextSundayISO,
  pickCloneSource,
  pickHero,
  suggestCloneDefaults
} from '../lib/setlist-helpers'
import { summarize } from '../lib/preflight'
import { Button } from '../components/ui/Button'
import { EmptyState } from '../components/ui/EmptyState'
import { PageHeader } from '../components/ui/PageHeader'
import { PreflightBanner, PreflightPanel } from '../components/PreflightPanel'
import { NextServiceCard } from '../components/home/NextServiceCard'
import { SetlistCard } from '../components/home/SetlistCard'
import { CalendarIcon, PlusIcon } from '../components/icons'

export function Home(): JSX.Element {
  const navigate = useNavigate()
  const { setlists, loading, error, load, create, remove, clone } = useSetlistStore()
  const { songs, load: loadSongs } = useLibraryStore()
  const [busy, setBusy] = useState(false)
  const [preflight, setPreflight] = useState<PreflightReport | null>(null)
  const [preflightBusy, setPreflightBusy] = useState(false)

  useEffect(() => {
    load()
    // Lazy-load the song library so hero + card previews can resolve
    // song titles. Cheap and cached by the store.
    if (songs.length === 0) loadSongs()
  }, [load, loadSongs, songs.length])

  const songsById = useMemo(() => {
    const m = new Map<string, Song>()
    for (const s of songs) m.set(s.id, s)
    return m
  }, [songs])

  const heroSetlist = pickHero(setlists)
  const otherSetlists = setlists.filter((s) => s.id !== heroSetlist?.id)
  const heroId = heroSetlist?.id ?? null

  // Pre-flight is checked once we know which setlist to check against
  // (heroId starts null until setlists finish loading, then settles),
  // and again on demand via RE-CHECK. Never polled.
  useEffect(() => {
    let cancelled = false
    window.api.system.getPreflight(heroId).then((report) => {
      if (!cancelled) setPreflight(report)
    })
    return () => {
      cancelled = true
    }
  }, [heroId])

  const handleRecheck = async (): Promise<void> => {
    setPreflightBusy(true)
    try {
      const report = await window.api.system.getPreflight(heroId)
      setPreflight(report)
    } finally {
      setPreflightBusy(false)
    }
  }

  const handlePreflightRemedy = (check: PreflightCheck): void => {
    const remedy = check.remedy
    if (!remedy) return
    if (remedy.kind === 'external') {
      window.api.system.openExternal(remedy.target)
    } else {
      navigate(remedy.target)
    }
  }

  const handleNew = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      const created = await create({
        name: 'New Service',
        date: nextSundayISO()
      })
      navigate(`/setlists/${created.id}`)
    } finally {
      setBusy(false)
    }
  }

  const handleCloneLast = async (): Promise<void> => {
    if (busy) return
    // Not setlists[0]: that's the newest by date, which may be a
    // pre-built future service rather than the one just used.
    const source = pickCloneSource(setlists)
    if (!source) return
    setBusy(true)
    try {
      const defaults = suggestCloneDefaults(source)
      const created = await clone(source.id, defaults.name, defaults.date)
      navigate(`/setlists/${created.id}`)
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async (id: string, name: string): Promise<void> => {
    const ok = window.confirm(`Delete "${name}"?`)
    if (!ok) return
    await remove(id)
  }

  const preflightSummary = preflight ? summarize(preflight.checks) : null
  const preflightNudge =
    preflightSummary && preflightSummary.firstWarning ? (
      <PreflightBanner
        check={preflightSummary.firstWarning}
        count={preflightSummary.warningCount}
        onAct={handlePreflightRemedy}
      />
    ) : null

  return (
    <div className="flex h-full w-full min-h-0 flex-col text-foreground">
      <PageHeader title="Home" />

      <div className="scroll-hairline flex-1 overflow-y-auto px-8 pb-12">
        {loading && !heroSetlist && (
          <p className="mb-4 text-[13px] text-muted-foreground">Loading setlists…</p>
        )}
        {error && (
          <p
            role="alert"
            className="mb-6 rounded-lg bg-live/10 px-3.5 py-2.5 text-[13px] text-live ring-1 ring-inset ring-live/25"
          >
            Couldn&apos;t load setlists: {error}
          </p>
        )}

        <div className="flex flex-col gap-10">
          {/* Next service */}
          {heroSetlist && (
            <NextServiceCard
              setlist={heroSetlist}
              songsById={songsById}
              preflightNudge={preflightNudge}
              onDelete={() => handleDelete(heroSetlist.id, heroSetlist.name)}
              onCloneLast={handleCloneLast}
              canCloneLast={setlists.length > 0}
              busy={busy}
            />
          )}

          {!heroSetlist && !loading && setlists.length === 0 && (
            <EmptyState
              icon={<CalendarIcon size={30} />}
              title="No setlists yet"
              description="Plan your first service to see it here. You can add songs, scripture, PDFs and videos."
              cta={
                <Button variant="primary" onClick={handleNew} disabled={busy}>
                  <PlusIcon size={16} />
                  New setlist
                </Button>
              }
            />
          )}

          {/* Pre-flight readiness */}
          <PreflightPanel
            report={preflight}
            onRecheck={handleRecheck}
            onAct={handlePreflightRemedy}
            busy={preflightBusy}
          />

          {/* Other setlists */}
          {otherSetlists.length > 0 && (
            <section aria-labelledby="other-setlists-heading">
              <div className="mb-3 flex items-baseline gap-3">
                <h2
                  id="other-setlists-heading"
                  className="text-[16px] font-semibold text-foreground"
                >
                  Other setlists
                </h2>
                <span className="text-[13px] tabular-nums text-muted-foreground">
                  {otherSetlists.length} saved
                </span>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {otherSetlists.map((s) => (
                  <SetlistCard
                    key={s.id}
                    setlist={s}
                    onDelete={() => handleDelete(s.id, s.name)}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
