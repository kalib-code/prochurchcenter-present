/**
 * Settings — KLB shell around the existing stores.
 *
 * Layout:
 *   - PageHeader at top, with the DISPLAY/THEME/OUTPUT/DATA/ABOUT tab row
 *     rendered as its `children`.
 *   - Two-column body: left = tab title/description + bordered control
 *     groups (520px, scrolls independently), right = live preview (does
 *     not scroll, so it stays in view while the left column scrolls —
 *     the redesign brief's "sticky" preview).
 *
 * Store behavior is unchanged — this is purely a layout / visual
 * overhaul. Every update still flows through useSettingsStore.update
 * and useThemeStore.update and broadcasts to the output window.
 *
 * The design file's Settings section (L699-747) draws each row as a
 * read-only value chip — it is mocking the shell, not the controls. Every
 * control below is the same real `<select>`/`<input>`/`<button>` the
 * pre-redesign Settings.tsx used; only the surrounding chrome changed.
 */

import { useEffect, useState } from 'react'
import type {
  SlidePayload,
  BackupListEntry,
  BackupImportMode,
  ManualUpdateCheckResult
} from '@shared/ipc-contract'
import { useSettingsStore } from '../stores/useSettingsStore'
import { useThemeStore } from '../stores/useThemeStore'
import { useServiceStore } from '../stores/useServiceStore'
import { SlideRenderer } from '../components/SlideRenderer'
import { ThemeFields } from '../components/ThemeFields'
import { PageHeader } from '../components/ui/PageHeader'
import { Button } from '../components/ui/Button'
import { Panel } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { MonoLabel } from '../components/ui/MonoLabel'
import { TitleDot } from '../components/ui/TitleDot'
import { EmptyState } from '../components/ui/EmptyState'
import { cn } from '../lib/utils'

type Section = 'display' | 'theme' | 'output' | 'data' | 'about'

const SECTIONS: { id: Section; label: string; description: string }[] = [
  {
    id: 'display',
    label: 'Display',
    description: 'How songs are broken up before they reach the projector.'
  },
  {
    id: 'theme',
    label: 'Theme',
    description: 'Typography, background, and transitions for every slide.'
  },
  {
    id: 'output',
    label: 'Output',
    description: 'Which monitor the fullscreen projector lives on.'
  },
  {
    id: 'data',
    label: 'Data',
    description:
      'Backups, restore, and library transfer between machines. Auto-backup runs daily on app launch.'
  },
  {
    id: 'about',
    label: 'About',
    description: 'Language, version, and project info.'
  }
]

const FALLBACK_LINES = [
  'For God so loved the world',
  'that he gave his one and only Son,',
  'that whoever believes in him shall not perish',
  'but have eternal life.'
]

function buildFallbackPayload(maxLines: number): SlidePayload {
  const safe = Math.max(1, Math.floor(maxLines))
  return {
    kind: 'text',
    sectionLabel: `John 3:16 (NIV) · first ${Math.min(safe, FALLBACK_LINES.length)} of ${FALLBACK_LINES.length}`,
    lines: FALLBACK_LINES.slice(0, safe)
  }
}

/** Operator-facing breadcrumb for the live preview's caption row. Every
 * SlidePayload kind is covered so a mid-service preview (which can be any
 * kind, not just text) still shows something meaningful. */
function slideCaption(payload: SlidePayload): string {
  switch (payload.kind) {
    case 'text':
      return payload.sectionLabel ?? 'Text slide'
    case 'image':
      return payload.caption ?? 'Image slide'
    case 'video':
      return payload.title ?? 'Video slide'
    case 'pdf-page':
      return `PDF · page ${payload.pageIndex} of ${payload.pageCount}`
    case 'countdown':
      return payload.label
  }
}

export function Settings(): JSX.Element {
  const { settings, loading, load: loadSettings } = useSettingsStore()
  const { theme, load: loadTheme, update: updateTheme } = useThemeStore()
  const serviceState = useServiceStore((s) => s.state)

  const [section, setSection] = useState<Section>('display')

  useEffect(() => {
    loadSettings()
    loadTheme()
  }, [loadSettings, loadTheme])

  if (loading && !settings) {
    return <Shell>Loading settings…</Shell>
  }
  if (!settings || !theme) {
    return <Shell>Loading…</Shell>
  }

  const fallback = buildFallbackPayload(settings.maxLinesPerSlide)
  const previewPayload: SlidePayload =
    serviceState.mode === 'running'
      ? serviceState.items[serviceState.itemIndex]?.slides[
          serviceState.slideIndex
        ] ?? fallback
      : fallback

  const activeSection = SECTIONS.find((s) => s.id === section)!

  return (
    <div className="flex h-screen w-screen flex-col bg-background text-foreground">
      <PageHeader
        eyebrow="Workspace"
        title="Settings"
        description="Changes save instantly. The projector restyles on the next frame."
        back={{ to: '/', label: 'Home' }}
      >
        <nav className="flex gap-0" aria-label="Settings sections">
          {SECTIONS.map((s) => {
            const active = s.id === section
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setSection(s.id)}
                aria-pressed={active}
                className={cn(
                  'border-b-2 bg-transparent px-[18px] py-3 font-mono text-[9.5px] font-semibold uppercase tracking-[0.12em] transition-colors',
                  active
                    ? 'border-signal text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                )}
              >
                {s.label}
              </button>
            )
          })}
        </nav>
      </PageHeader>

      <div className="grid min-h-0 flex-1 grid-cols-[520px_1fr]">
        {/* ── Left: tab title/description + bordered control groups ──── */}
        <section className="scroll-hairline min-h-0 overflow-y-auto border-r border-border bg-card p-6">
          <h2 className="text-[20px] font-extrabold tracking-[-0.02em] text-foreground">
            {activeSection.label}
          </h2>
          <p className="mb-[22px] mt-1.5 text-[12.5px] leading-[1.6] text-soft">
            {activeSection.description}
          </p>

          {section === 'display' && <DisplaySection />}

          {section === 'theme' && (
            <ThemeFields theme={theme} onChange={(patch) => void updateTheme(patch)} />
          )}

          {section === 'output' && <OutputDisplaySection />}

          {section === 'data' && <DataSection />}

          {section === 'about' && <AboutSection />}
        </section>

        {/* ── Right: live preview — does not scroll, stays in view ──── */}
        <aside className="flex min-h-0 flex-col bg-background p-6">
          <div className="mb-3 flex items-baseline justify-between">
            <MonoLabel tone="signal">Live preview</MonoLabel>
            <MonoLabel tone="muted">Reflects every change instantly</MonoLabel>
          </div>

          <div className="aspect-video w-full overflow-hidden border border-border bg-black">
            <SlideRenderer
              payload={previewPayload}
              mode="live"
              theme={theme}
              animate={false}
            />
          </div>

          <div className="mt-3 flex items-center justify-between gap-3">
            <MonoLabel tone="muted" className="truncate">
              {slideCaption(previewPayload)}
            </MonoLabel>
            <MonoLabel tone="dim" className="shrink-0">
              No save button — close when it looks right
            </MonoLabel>
          </div>
        </aside>
      </div>
    </div>
  )
}

// ─── Display (slide breaks) ────────────────────────────────────────────

function DisplaySection(): JSX.Element | null {
  const { settings, update } = useSettingsStore()
  if (!settings) return null

  return (
    <Panel title="SLIDE BREAKS">
      <Row
        label="Max lines per slide"
        hint="Lines beyond this split into a new slide automatically."
      >
        <input
          type="number"
          min={2}
          max={20}
          step={1}
          value={settings.maxLinesPerSlide}
          onChange={(e) => {
            const v = Math.max(2, Math.min(20, Math.floor(Number(e.target.value))))
            if (v !== settings.maxLinesPerSlide) {
              void update({ maxLinesPerSlide: v })
            }
          }}
          className="h-9 w-20 border border-border bg-background px-2 text-center text-[13px] text-foreground outline-none focus:border-signal/50"
        />
      </Row>

      <Row
        label="Song intro slide"
        hint="Adds an empty intro slide before each song's first verse so the background can transition in before lyrics appear."
      >
        <label className="flex items-center gap-2 text-[13px] text-foreground">
          <input
            type="checkbox"
            checked={settings.songTransitionSlide}
            onChange={(e) => void update({ songTransitionSlide: e.target.checked })}
            className="h-4 w-4 border-border bg-background accent-signal"
          />
          <span>Insert intro slide for each song</span>
        </label>
      </Row>
    </Panel>
  )
}

// ─── Output display ──────────────────────────────────────────────────

interface DisplayInfo {
  id: number
  label: string
  primary: boolean
}

function OutputDisplaySection(): JSX.Element | null {
  const { settings, update } = useSettingsStore()
  const [displays, setDisplays] = useState<DisplayInfo[]>([])

  const refresh = (): void => {
    void window.api.output.listDisplays().then(setDisplays)
  }

  useEffect(() => {
    refresh()
  }, [])

  if (!settings) return null

  return (
    <div className="space-y-4">
      <Panel
        title="PROJECTOR OUTPUT"
        action={
          <Button size="sm" variant="ghost" onClick={refresh}>
            ↻ Refresh display list
          </Button>
        }
      >
        <Row label="Display" hint="Which monitor runs the fullscreen output window.">
          <select
            value={settings.outputDisplayId ?? ''}
            onChange={async (e) => {
              const raw = e.target.value
              const id = raw === '' ? null : Number(raw)
              await update({ outputDisplayId: id })
              await window.api.output.setDisplay(id)
            }}
            className={selectClass}
          >
            <option value="">Primary</option>
            {displays.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </Row>
      </Panel>

      {/* Stage monitor — second projector facing the speaker */}
      <Panel title="STAGE MONITOR">
        <Row
          label="Stage monitor"
          hint="A second projector facing the speaker on stage. Mirrors the main output, no audio."
        >
          <label className="flex items-center gap-2 text-[13px] text-foreground">
            <input
              type="checkbox"
              checked={settings.stageMonitorEnabled}
              onChange={async (e) => {
                const enabled = e.target.checked
                await update({ stageMonitorEnabled: enabled })
                await window.api.output.setStageMonitorEnabled(enabled)
              }}
              className="h-4 w-4 border-border bg-background accent-signal"
            />
            <span>Enable stage monitor window</span>
          </label>
        </Row>
        {settings.stageMonitorEnabled && (
          <Row label="Stage display" hint="Which monitor the stage view appears on.">
            <select
              value={settings.stageMonitorDisplayId ?? ''}
              onChange={async (e) => {
                const raw = e.target.value
                const id = raw === '' ? null : Number(raw)
                await update({ stageMonitorDisplayId: id })
                await window.api.output.setStageMonitorDisplay(id)
              }}
              className={selectClass}
            >
              <option value="">Auto (next display)</option>
              {displays.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
          </Row>
        )}
      </Panel>

      {/* Lower thirds — chroma key window for OBS feeds */}
      <Panel title="LOWER THIRDS">
        <Row
          label="Lower thirds"
          hint="A chroma-key window for OBS / live stream feeds. Operator types content in the service-mode bottom strip."
        >
          <label className="flex items-center gap-2 text-[13px] text-foreground">
            <input
              type="checkbox"
              checked={settings.lowerThirdsEnabled}
              onChange={async (e) => {
                const enabled = e.target.checked
                await update({ lowerThirdsEnabled: enabled })
                await window.api.output.setLowerThirdsEnabled(enabled)
              }}
              className="h-4 w-4 border-border bg-background accent-signal"
            />
            <span>Enable lower thirds window</span>
          </label>
        </Row>
        {settings.lowerThirdsEnabled && (
          <>
            <Row label="Display" hint="Which monitor the chroma window appears on.">
              <select
                value={settings.lowerThirdsDisplayId ?? ''}
                onChange={async (e) => {
                  const raw = e.target.value
                  const id = raw === '' ? null : Number(raw)
                  await update({ lowerThirdsDisplayId: id })
                  await window.api.output.setLowerThirdsDisplay(id)
                }}
                className={selectClass}
              >
                <option value="">Auto (next display)</option>
                {displays.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                  </option>
                ))}
              </select>
            </Row>
            <Row
              label="Chroma key color"
              hint="OBS keys this color out of the broadcast. Bright #00FF00 is the standard."
            >
              <input
                type="color"
                value={settings.lowerThirdsChromaKey}
                onChange={async (e) => {
                  await update({ lowerThirdsChromaKey: e.target.value })
                  // Note: changing the key requires re-creating the
                  // window because the BrowserWindow backgroundColor
                  // is set at construction. Toggle off + on:
                  if (settings.lowerThirdsEnabled) {
                    await window.api.output.setLowerThirdsEnabled(false)
                    await window.api.output.setLowerThirdsEnabled(true)
                  }
                }}
                className="h-9 w-16 cursor-pointer border border-border bg-background"
              />
            </Row>
            <Row
              label="Text alignment"
              hint="Where the lyric graphic sits on the strip and how its text wraps."
            >
              <select
                value={settings.lowerThirdsAlignment}
                onChange={async (e) => {
                  const align = e.target.value as 'left' | 'center' | 'right'
                  await update({ lowerThirdsAlignment: align })
                  // Same as chroma — the URL param is set at
                  // window construction so we re-create the window.
                  if (settings.lowerThirdsEnabled) {
                    await window.api.output.setLowerThirdsEnabled(false)
                    await window.api.output.setLowerThirdsEnabled(true)
                  }
                }}
                className="h-9 w-32 border border-border bg-background px-2 text-[13px] text-foreground outline-none focus:border-signal/50"
              >
                <option value="left">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
              </select>
            </Row>
            {/* Theme fields below are bundled into the broadcast
                payload (not URL params), so changes propagate
                instantly — no window re-creation needed. */}
            <Row
              label="Font size"
              hint="Pixel size of the lyric text in the lower third graphic."
            >
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={20}
                  max={72}
                  step={2}
                  value={settings.lowerThirdsFontSize}
                  onChange={(e) => {
                    void update({
                      lowerThirdsFontSize: Number(e.target.value)
                    })
                  }}
                  className="w-24"
                />
                <span className="w-12 text-right text-[11px] tabular-nums text-muted-foreground">
                  {settings.lowerThirdsFontSize}px
                </span>
              </div>
            </Row>
            <Row label="Text color">
              <input
                type="color"
                value={settings.lowerThirdsTextColor}
                onChange={(e) => {
                  void update({ lowerThirdsTextColor: e.target.value })
                }}
                className="h-9 w-16 cursor-pointer border border-border bg-background"
              />
            </Row>
            <Row
              label="Box color"
              hint="Background color of the graphic box behind the text."
            >
              <input
                type="color"
                value={settings.lowerThirdsBoxColor}
                onChange={(e) => {
                  void update({ lowerThirdsBoxColor: e.target.value })
                }}
                className="h-9 w-16 cursor-pointer border border-border bg-background"
              />
            </Row>
            <Row
              label="Box opacity"
              hint="0 = no box, text floats on chroma. 100 = solid box."
            >
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={settings.lowerThirdsBoxOpacity}
                  onChange={(e) => {
                    void update({
                      lowerThirdsBoxOpacity: Number(e.target.value)
                    })
                  }}
                  className="w-24"
                />
                <span className="w-12 text-right text-[11px] tabular-nums text-muted-foreground">
                  {settings.lowerThirdsBoxOpacity}%
                </span>
              </div>
            </Row>
            <Row
              label="Text effect"
              hint="Drop shadow or outline keeps text legible against any background."
            >
              <select
                value={settings.lowerThirdsTextEffect}
                onChange={(e) => {
                  void update({
                    lowerThirdsTextEffect: e.target.value as
                      | 'none'
                      | 'shadow'
                      | 'outline'
                  })
                }}
                className="h-9 w-32 border border-border bg-background px-2 text-[13px] text-foreground outline-none focus:border-signal/50"
              >
                <option value="none">None</option>
                <option value="shadow">Shadow</option>
                <option value="outline">Outline</option>
              </select>
            </Row>
          </>
        )}
      </Panel>
    </div>
  )
}

// ─── Data / Backup ───────────────────────────────────────────────────

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function formatBackupTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  })
}

function DataSection(): JSX.Element {
  const [backups, setBackups] = useState<BackupListEntry[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [lastMessage, setLastMessage] = useState<string | null>(null)

  const refresh = async (): Promise<void> => {
    const list = await window.api.backup.list()
    setBackups(list)
  }

  useEffect(() => {
    void refresh()
  }, [])

  const exportNow = async (): Promise<void> => {
    setBusy('export')
    try {
      const entry = await window.api.backup.exportNow()
      setLastMessage(
        `Backup created — ${entry.manifest?.counts.songs ?? 0} songs, ${
          entry.manifest?.counts.setlists ?? 0
        } setlists, ${formatBytes(entry.sizeBytes)}.`
      )
      await refresh()
    } finally {
      setBusy(null)
    }
  }

  const restore = async (
    entry: BackupListEntry,
    mode: BackupImportMode
  ): Promise<void> => {
    const verb = mode === 'replace' ? 'REPLACE your entire library' : 'merge into your library'
    const ok = window.confirm(
      `Restore from ${entry.filename}?\n\nThis will ${verb}. A safety snapshot of your current library is always saved first so you can roll back.`
    )
    if (!ok) return
    setBusy(entry.absolutePath)
    try {
      const result = await window.api.backup.restore(entry.absolutePath, mode)
      setLastMessage(
        `Restored — ${result.imported.songs} songs, ${result.imported.setlists} setlists, ${result.imported.themes} themes. Safety snapshot: ${result.safetyBackupPath
          .split('/')
          .pop()}`
      )
      await refresh()
      // Signal the rest of the app to re-read data.
      window.location.reload()
    } finally {
      setBusy(null)
    }
  }

  const remove = async (entry: BackupListEntry): Promise<void> => {
    const ok = window.confirm(`Delete ${entry.filename}? This cannot be undone.`)
    if (!ok) return
    setBusy(entry.absolutePath)
    try {
      await window.api.backup.delete(entry.absolutePath)
      await refresh()
    } finally {
      setBusy(null)
    }
  }

  const openFolder = async (): Promise<void> => {
    await window.api.backup.openFolder()
  }

  const importFromFile = async (mode: BackupImportMode): Promise<void> => {
    const verb = mode === 'replace' ? 'REPLACE your entire library' : 'merge into your library'
    const ok = window.confirm(
      `Choose a backup file to restore.\n\nThis will ${verb}. A safety snapshot is saved first.`
    )
    if (!ok) return
    setBusy('import-file')
    try {
      const result = await window.api.backup.importFromFile(mode)
      if (result) {
        setLastMessage(
          `Imported — ${result.imported.songs} songs, ${result.imported.setlists} setlists, ${result.imported.themes} themes.`
        )
        await refresh()
        window.location.reload()
      }
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-4">
      {/* Create backup + open folder */}
      <Panel title="BACKUP">
        <Row
          label="Create a backup now"
          hint="Writes a timestamped zip of your songs, setlists, themes, fonts, and settings. Runs instantly — no waiting."
        >
          <Button size="sm" onClick={exportNow} disabled={busy !== null}>
            {busy === 'export' ? 'Creating…' : 'Backup now'}
          </Button>
        </Row>
        <Row
          label="Open backup folder"
          hint="Power-user escape hatch — reveals the hidden backups folder in Finder / Explorer so you can copy a zip to a USB drive."
        >
          <Button size="sm" variant="ghost" onClick={openFolder}>
            Open folder
          </Button>
        </Row>
        <Row
          label="Restore from a zip file"
          hint="Use this when someone sent you a backup zip to restore. Otherwise pick a backup from the list below."
        >
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void importFromFile('merge')}
              disabled={busy !== null}
            >
              Merge from file…
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void importFromFile('replace')}
              disabled={busy !== null}
            >
              Replace from file…
            </Button>
          </div>
        </Row>
      </Panel>

      {/* Status line */}
      {lastMessage && (
        <div className="border border-signal/30 bg-signal/5 px-3.5 py-2.5 text-[12px] text-foreground">
          {lastMessage}
        </div>
      )}

      {/* Backup list */}
      <Panel
        title={`AVAILABLE BACKUPS (${backups.length})`}
        action={
          <Button size="sm" variant="ghost" onClick={() => void refresh()}>
            ↻ Refresh
          </Button>
        }
      >
        <div className="border-b border-rule px-4 py-2.5 text-[11px] leading-[1.5] text-muted-foreground">
          Auto-backup keeps the 7 most recent. Pre-import safety snapshots are kept separately.
        </div>

        {backups.length === 0 ? (
          <EmptyState
            title="No backups yet"
            description="Click Backup now to create the first one."
            className="border-0 bg-transparent px-4 py-8"
          />
        ) : (
          <ul>
            {backups.map((entry, i) => {
              const isSafety = entry.filename.startsWith('pre-import-')
              const isBusy = busy === entry.absolutePath
              return (
                <li
                  key={entry.absolutePath}
                  className={cn(
                    'flex items-start justify-between gap-3 px-4 py-3',
                    i > 0 && 'border-t border-rule',
                    entry.manifest === null && 'opacity-60'
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-semibold text-foreground">
                        {formatBackupTime(entry.createdAt)}
                      </span>
                      {isSafety && <Badge tone="neutral">Safety snapshot</Badge>}
                      {entry.manifest === null && <Badge tone="signal">Corrupt</Badge>}
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      {entry.manifest
                        ? `${entry.manifest.counts.songs} songs · ${entry.manifest.counts.setlists} setlists · ${entry.manifest.counts.themes} themes · ${formatBytes(entry.sizeBytes)}`
                        : formatBytes(entry.sizeBytes)}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={entry.manifest === null || isBusy || busy !== null}
                      onClick={() => void restore(entry, 'merge')}
                    >
                      Merge
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={entry.manifest === null || isBusy || busy !== null}
                      onClick={() => void restore(entry, 'replace')}
                    >
                      Replace
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={isBusy || busy !== null}
                      onClick={() => void remove(entry)}
                    >
                      ✕
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Panel>
    </div>
  )
}

// ─── About ───────────────────────────────────────────────────────────

/**
 * Render the human-readable status line for the most recent manual
 * update check. Null return means "show nothing" (i.e., the user
 * hasn't clicked the button yet).
 */
function describeCheckResult(result: ManualUpdateCheckResult | null): string | null {
  if (!result) return null
  switch (result.status) {
    case 'up-to-date':
      return `You're on the latest version (v${result.currentVersion}).`
    case 'update-available':
      return `Update v${result.newVersion} is downloading in the background. You'll see a "Restart now?" prompt when it's ready.`
    case 'dev':
      return `Running a dev build (v${result.currentVersion}). Auto-update is disabled in dev.`
    case 'error':
      return `Check failed: ${result.message}. Your internet may be down — try again later.`
  }
}

function AboutSection(): JSX.Element {
  const { settings } = useSettingsStore()
  const [version, setVersion] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [checkResult, setCheckResult] = useState<ManualUpdateCheckResult | null>(null)

  useEffect(() => {
    void window.api.updater.getVersion().then(setVersion)
  }, [])

  const checkNow = async (): Promise<void> => {
    setChecking(true)
    try {
      const result = await window.api.updater.checkNow()
      setCheckResult(result)
    } finally {
      setChecking(false)
    }
  }

  const statusLine = describeCheckResult(checkResult)

  return (
    <div className="space-y-4">
      <Panel title="VERSION">
        <Row
          label="Current version"
          hint="Auto-update checks GitHub Releases on every launch. Mac users: see the INSTALL guide — signed updates are coming in a later release."
        >
          <span className="font-mono text-[13px] text-foreground">
            {version ? `v${version}` : '…'}
          </span>
        </Row>
        <Row
          label="Check for updates"
          hint="Manually check GitHub for a newer release. Downloads happen in the background; you'll be prompted to restart when ready."
        >
          <Button size="sm" onClick={checkNow} disabled={checking}>
            {checking ? 'Checking…' : 'Check now'}
          </Button>
        </Row>
        {statusLine && (
          <div
            className={cn(
              'border px-4 py-3 text-[12px]',
              checkResult?.status === 'error'
                ? 'border-signal-deep/40 bg-signal-deep/10 text-signal-deep'
                : 'border-signal/30 bg-signal/5 text-foreground'
            )}
          >
            {statusLine}
          </div>
        )}
      </Panel>

      <Panel title="LANGUAGE">
        <Row label="Interface language" hint="Tagalog support lands in Phase 7.">
          <select
            disabled
            value={settings?.uiLanguage ?? 'en'}
            className="h-9 w-48 border border-border bg-background/40 px-2 text-[13px] text-foreground opacity-60"
          >
            <option value="en">English</option>
            <option value="tl">Tagalog</option>
          </select>
        </Row>
      </Panel>

      <Panel title="ABOUT">
        <div className="p-4">
          <div className="text-[20px] font-extrabold tracking-[-0.02em] text-foreground">
            ProChurchCenter — Present
            <TitleDot />
          </div>
          <p className="mt-1 text-[11px] uppercase tracking-[0.18em] text-signal">
            Sunday Task
          </p>
          <p className="mt-3 text-[12px] leading-relaxed text-soft">
            A minimal church presenter built for Filipino worship teams.
            Designed to be reliable on Sunday morning, editable on Saturday
            night, and learnable in one rehearsal.
          </p>
        </div>
      </Panel>
    </div>
  )
}

// ─── Local row primitive ─────────────────────────────────────────────

const selectClass =
  'h-9 w-56 border border-border bg-background px-2 text-[13px] text-foreground outline-none focus:border-signal/50'

function Row({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <div className="flex items-center gap-4 border-b border-rule px-4 py-3.5 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-foreground">{label}</div>
        {hint && (
          <div className="mt-[3px] text-[11.5px] leading-[1.55] text-soft">
            {hint}
          </div>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

// ─── Loading shell ───────────────────────────────────────────────────

function Shell({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className="flex h-screen w-screen flex-col bg-background text-foreground">
      <PageHeader eyebrow="Workspace" title="Settings" back={{ to: '/', label: 'Home' }} />
      <main className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        {children}
      </main>
    </div>
  )
}
