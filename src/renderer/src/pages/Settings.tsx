/**
 * Settings — section nav, grouped setting rows, sticky live preview.
 *
 * Layout (inside the AppShell content panel):
 *   - PageHeader "Settings" across the top. The sidebar owns app nav, so
 *     there is no back link here.
 *   - Body, three columns:
 *       left   section nav (Display, Theme, Output, Data, About)
 *       middle the active section: a heading plus grouped Panels of
 *              setting rows (label + description left, control right);
 *              scrolls independently
 *       right  live preview — does not scroll, so it stays in view while
 *              the middle column scrolls
 *
 * Store behavior is unchanged — this is purely presentation. Every update
 * still flows through useSettingsStore.update and useThemeStore.update and
 * broadcasts to the output window.
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
import { CanvaConnectionCard } from '../components/CanvaConnectionCard'
import { FEATURES } from '@shared/features'
import { PageHeader } from '../components/ui/PageHeader'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { EmptyState } from '../components/ui/EmptyState'
import { Input, Select } from '../components/ui/Input'
import {
  ColorInput,
  Notice,
  RangeInput,
  SettingRow,
  SettingsGroup,
  Switch
} from '../components/settings/SettingsKit'
import {
  ArchiveIcon,
  InfoCircleIcon,
  LinkChainIcon,
  PaletteIcon,
  ProjectorIcon,
  RefreshCwIcon,
  TextLinesIcon,
  TrashIcon
} from '../components/icons'
import { cn } from '../lib/utils'
import { MAX_LINES_MAX, MAX_LINES_MIN, parseMaxLinesInput } from '../lib/maxLinesInput'

/** "1 song", "3 songs" — backup summaries used to say "1 themes". */
function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}

type Section = 'display' | 'theme' | 'output' | 'data' | 'connections' | 'about'

type IconComponent = (p: { size?: number; className?: string }) => JSX.Element

const ALL_SECTIONS: {
  id: Section
  label: string
  description: string
  icon: IconComponent
}[] = [
  {
    id: 'display',
    label: 'Display',
    description: 'How songs are split into slides before they reach the projector.',
    icon: TextLinesIcon
  },
  {
    id: 'theme',
    label: 'Theme',
    description: 'Typography, background and transitions for every slide.',
    icon: PaletteIcon
  },
  {
    id: 'output',
    label: 'Output',
    description: 'Which screens show the projector, stage monitor and lower thirds.',
    icon: ProjectorIcon
  },
  {
    id: 'data',
    label: 'Data',
    description:
      'Backups, restore, and moving your library between computers. An automatic backup runs once a day when the app opens.',
    icon: ArchiveIcon
  },
  {
    id: 'connections',
    label: 'Connections',
    description: 'Link Present to the other tools your church already uses.',
    icon: LinkChainIcon
  },
  {
    id: 'about',
    label: 'About',
    description: 'Version, updates and language.',
    icon: InfoCircleIcon
  }
]

// Connections only holds the Canva account card, so the whole tab hides
// while Canva is feature-flagged off (see shared/features.ts).
const SECTIONS = ALL_SECTIONS.filter((s) => s.id !== 'connections' || FEATURES.canva)

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
    case 'pptx-slide':
      return `PowerPoint slide ${payload.slideOrdinal} of ${payload.slideCount}`
    case 'countdown':
      return payload.label
  }
}

// The preview only reflects Display and Theme changes; the other sections
// give its column back to their (wider) rows.
const PREVIEW_SECTIONS: ReadonlySet<Section> = new Set<Section>(['display', 'theme'])

const PAGE_DESCRIPTION = 'Changes save as you make them and reach the projector right away.'

export function Settings(): JSX.Element {
  const { settings, loading, load: loadSettings, error: settingsError } = useSettingsStore()
  const { theme, load: loadTheme, update: updateTheme, error: themeError } = useThemeStore()
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

  const serviceRunning = serviceState.mode === 'running'
  const fallback = buildFallbackPayload(settings.maxLinesPerSlide)
  const previewPayload: SlidePayload =
    serviceState.mode === 'running'
      ? (serviceState.items[serviceState.itemIndex]?.slides[serviceState.slideIndex] ?? fallback)
      : fallback

  const activeSection = SECTIONS.find((s) => s.id === section)!
  const showPreview = PREVIEW_SECTIONS.has(section)

  return (
    <div className="flex h-full w-full min-h-0 flex-col text-foreground">
      <PageHeader title="Settings" description={PAGE_DESCRIPTION} />

      <div className="flex min-h-0 flex-1 border-t border-rule">
        {/* ── Left: section nav ───────────────────────────────────────── */}
        <nav
          className="flex w-[196px] shrink-0 flex-col gap-0.5 py-5 pl-5 pr-3"
          aria-label="Settings sections"
        >
          {SECTIONS.map((s) => {
            const active = s.id === section
            const Icon = s.icon
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setSection(s.id)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-left text-[13.5px] font-medium transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70',
                  active
                    ? 'bg-raised text-foreground'
                    : 'text-soft hover:bg-raised/60 hover:text-foreground'
                )}
              >
                <Icon size={17} className={active ? 'text-foreground' : 'text-muted-foreground'} />
                {s.label}
              </button>
            )
          })}
        </nav>

        {/* ── Middle: active section, scrolls ─────────────────────────── */}
        <section
          className="scroll-hairline min-h-0 min-w-0 flex-1 overflow-y-auto pb-10 pl-4 pr-7 pt-5"
          aria-labelledby="settings-section-title"
        >
          <div className="max-w-[680px]">
            <h2
              id="settings-section-title"
              className="text-[18px] font-semibold tracking-[-0.01em] text-foreground"
            >
              {activeSection.label}
            </h2>
            <p className="mb-5 mt-1 text-[13.5px] leading-relaxed text-soft">
              {activeSection.description}
            </p>

            {/* A failed save is rolled back by the store; say so instead of
                letting the control silently jump back. */}
            {(settingsError || themeError) && (
              <Notice tone="warn" className="mb-4">
                Couldn't save that change, so it was undone. {settingsError ?? themeError}
              </Notice>
            )}

            {section === 'display' && <DisplaySection />}

            {section === 'theme' && (
              <ThemeFields theme={theme} onChange={(patch) => void updateTheme(patch)} />
            )}

            {section === 'output' && <OutputDisplaySection />}

            {section === 'data' && <DataSection />}

            {section === 'connections' && FEATURES.canva && <CanvaConnectionCard />}

            {section === 'about' && <AboutSection />}
          </div>
        </section>

        {/* ── Right: live preview — does not scroll, stays in view ──── */}
        {showPreview && (
          <aside
            className="flex w-[clamp(300px,33%,440px)] shrink-0 flex-col pb-6 pl-2 pr-7 pt-5"
            aria-label="Live preview"
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-[13.5px] font-medium text-foreground">Live preview</h2>
              {serviceRunning ? (
                <Badge tone="neutral">Current service slide</Badge>
              ) : (
                <span className="text-[12.5px] text-muted-foreground">Updates as you edit</span>
              )}
            </div>

            <div className="aspect-video w-full overflow-hidden rounded-lg bg-black ring-1 ring-border">
              <SlideRenderer payload={previewPayload} mode="live" theme={theme} animate={false} />
            </div>

            <p className="mt-2.5 truncate text-[12.5px] text-muted-foreground">
              {slideCaption(previewPayload)}
            </p>
          </aside>
        )}
      </div>
    </div>
  )
}

// ─── Display (slide breaks) ────────────────────────────────────────────

function DisplaySection(): JSX.Element | null {
  const { settings, update } = useSettingsStore()
  if (!settings) return null

  return (
    <SettingsGroup title="Slide breaks">
      <SettingRow
        label="Max lines per slide"
        description="Lines beyond this start a new slide automatically."
        htmlFor="settings-max-lines"
      >
        <MaxLinesInput
          id="settings-max-lines"
          value={settings.maxLinesPerSlide}
          onCommit={(v) => void update({ maxLinesPerSlide: v })}
        />
      </SettingRow>

      <SettingRow
        label="Song intro slide"
        description="Adds an empty slide before each song's first verse, so the background can fade in before the lyrics appear."
        htmlFor="settings-song-intro"
      >
        <Switch
          id="settings-song-intro"
          checked={settings.songTransitionSlide}
          onChange={(e) => void update({ songTransitionSlide: e.target.checked })}
        />
      </SettingRow>
    </SettingsGroup>
  )
}

/**
 * Max-lines field. Holds the typed text locally and commits (clamp + save)
 * only on blur or Enter: clamping every keystroke turned the "1" of "12"
 * into 2 and saved it, so two-digit values were nearly impossible to type.
 */
function MaxLinesInput({
  id,
  value,
  onCommit
}: {
  id?: string
  value: number
  onCommit: (v: number) => void
}): JSX.Element {
  const [text, setText] = useState(String(value))
  const [editing, setEditing] = useState(false)

  // Follow the saved value (e.g. a rollback) whenever not mid-edit.
  useEffect(() => {
    if (!editing) setText(String(value))
  }, [value, editing])

  const commit = (): void => {
    setEditing(false)
    const v = parseMaxLinesInput(text)
    if (v === null) {
      setText(String(value))
      return
    }
    setText(String(v))
    if (v !== value) onCommit(v)
  }

  return (
    <Input
      id={id}
      type="number"
      min={MAX_LINES_MIN}
      max={MAX_LINES_MAX}
      step={1}
      value={text}
      onFocus={() => setEditing(true)}
      onChange={(e) => {
        setEditing(true)
        setText(e.target.value)
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          setText(String(value))
          setEditing(false)
        }
      }}
      className="w-20 px-2 text-center tabular-nums"
    />
  )
}

// ─── Output display ──────────────────────────────────────────────────

interface DisplayInfo {
  id: number
  label: string
  primary: boolean
}

const selectWidth = 'w-56'

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
      <SettingsGroup
        title="Projector"
        action={
          <Button size="sm" variant="ghost" onClick={refresh}>
            <RefreshCwIcon size={15} />
            Refresh displays
          </Button>
        }
      >
        <SettingRow
          label="Display"
          description="Which monitor runs the fullscreen output window."
          htmlFor="settings-output-display"
        >
          <Select
            id="settings-output-display"
            value={settings.outputDisplayId ?? ''}
            onChange={async (e) => {
              const raw = e.target.value
              const id = raw === '' ? null : Number(raw)
              if (!(await update({ outputDisplayId: id }))) return
              await window.api.output.setDisplay(id)
            }}
            className={selectWidth}
          >
            <option value="">Primary</option>
            {displays.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </Select>
        </SettingRow>
      </SettingsGroup>

      {/* Stage monitor — second projector facing the speaker */}
      <SettingsGroup title="Stage monitor">
        <SettingRow
          label="Stage monitor window"
          description="A second screen facing the speaker on stage. Mirrors the main output, without audio."
          htmlFor="settings-stage-enabled"
        >
          <Switch
            id="settings-stage-enabled"
            checked={settings.stageMonitorEnabled}
            onChange={async (e) => {
              const enabled = e.target.checked
              if (!(await update({ stageMonitorEnabled: enabled }))) return
              await window.api.output.setStageMonitorEnabled(enabled)
            }}
          />
        </SettingRow>
        {settings.stageMonitorEnabled && (
          <SettingRow
            label="Stage display"
            description="Which monitor the stage view appears on."
            htmlFor="settings-stage-display"
          >
            <Select
              id="settings-stage-display"
              value={settings.stageMonitorDisplayId ?? ''}
              onChange={async (e) => {
                const raw = e.target.value
                const id = raw === '' ? null : Number(raw)
                if (!(await update({ stageMonitorDisplayId: id }))) return
                await window.api.output.setStageMonitorDisplay(id)
              }}
              className={selectWidth}
            >
              <option value="">Auto (next display)</option>
              {displays.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </Select>
          </SettingRow>
        )}
      </SettingsGroup>

      {/* Lower thirds — chroma key window for OBS feeds */}
      <SettingsGroup title="Lower thirds">
        <SettingRow
          label="Lower thirds window"
          description="A chroma-key window for OBS and live-stream feeds. Type its text in the strip at the bottom of Service Mode."
          htmlFor="settings-lt-enabled"
        >
          <Switch
            id="settings-lt-enabled"
            checked={settings.lowerThirdsEnabled}
            onChange={async (e) => {
              const enabled = e.target.checked
              if (!(await update({ lowerThirdsEnabled: enabled }))) return
              await window.api.output.setLowerThirdsEnabled(enabled)
            }}
          />
        </SettingRow>
        {settings.lowerThirdsEnabled && (
          <>
            <SettingRow
              label="Display"
              description="Which monitor the chroma window appears on."
              htmlFor="settings-lt-display"
            >
              <Select
                id="settings-lt-display"
                value={settings.lowerThirdsDisplayId ?? ''}
                onChange={async (e) => {
                  const raw = e.target.value
                  const id = raw === '' ? null : Number(raw)
                  if (!(await update({ lowerThirdsDisplayId: id }))) return
                  await window.api.output.setLowerThirdsDisplay(id)
                }}
                className={selectWidth}
              >
                <option value="">Auto (next display)</option>
                {displays.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                  </option>
                ))}
              </Select>
            </SettingRow>
            <SettingRow
              label="Chroma key color"
              description="OBS keys this color out of the broadcast. Bright green (#00FF00) is the standard."
              htmlFor="settings-lt-chroma"
            >
              <ColorInput
                id="settings-lt-chroma"
                value={settings.lowerThirdsChromaKey}
                onChange={async (e) => {
                  if (!(await update({ lowerThirdsChromaKey: e.target.value }))) return
                  // Note: changing the key requires re-creating the
                  // window because the BrowserWindow backgroundColor
                  // is set at construction. Toggle off + on:
                  if (settings.lowerThirdsEnabled) {
                    await window.api.output.setLowerThirdsEnabled(false)
                    await window.api.output.setLowerThirdsEnabled(true)
                  }
                }}
              />
            </SettingRow>
            <SettingRow
              label="Text alignment"
              description="Where the text sits on the strip and how it wraps."
              htmlFor="settings-lt-align"
            >
              <Select
                id="settings-lt-align"
                value={settings.lowerThirdsAlignment}
                onChange={async (e) => {
                  const align = e.target.value as 'left' | 'center' | 'right'
                  if (!(await update({ lowerThirdsAlignment: align }))) return
                  // Same as chroma — the URL param is set at
                  // window construction so we re-create the window.
                  if (settings.lowerThirdsEnabled) {
                    await window.api.output.setLowerThirdsEnabled(false)
                    await window.api.output.setLowerThirdsEnabled(true)
                  }
                }}
                className="w-36"
              >
                <option value="left">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
              </Select>
            </SettingRow>
            {/* Theme fields below are bundled into the broadcast
                payload (not URL params), so changes propagate
                instantly — no window re-creation needed. */}
            <SettingRow
              label="Font size"
              description="Size of the text in the lower-third graphic."
              htmlFor="settings-lt-font-size"
            >
              <RangeInput
                id="settings-lt-font-size"
                min={20}
                max={72}
                step={2}
                value={settings.lowerThirdsFontSize}
                onChange={(e) => {
                  void update({
                    lowerThirdsFontSize: Number(e.target.value)
                  })
                }}
                readout={`${settings.lowerThirdsFontSize}px`}
              />
            </SettingRow>
            <SettingRow label="Text color" htmlFor="settings-lt-text-color">
              <ColorInput
                id="settings-lt-text-color"
                value={settings.lowerThirdsTextColor}
                onChange={(e) => {
                  void update({ lowerThirdsTextColor: e.target.value })
                }}
              />
            </SettingRow>
            <SettingRow
              label="Box color"
              description="Background of the box behind the text."
              htmlFor="settings-lt-box-color"
            >
              <ColorInput
                id="settings-lt-box-color"
                value={settings.lowerThirdsBoxColor}
                onChange={(e) => {
                  void update({ lowerThirdsBoxColor: e.target.value })
                }}
              />
            </SettingRow>
            <SettingRow
              label="Box opacity"
              description="0 shows no box, so text floats on the chroma color. 100 is a solid box."
              htmlFor="settings-lt-box-opacity"
            >
              <RangeInput
                id="settings-lt-box-opacity"
                min={0}
                max={100}
                step={5}
                value={settings.lowerThirdsBoxOpacity}
                onChange={(e) => {
                  void update({
                    lowerThirdsBoxOpacity: Number(e.target.value)
                  })
                }}
                readout={`${settings.lowerThirdsBoxOpacity}%`}
              />
            </SettingRow>
            <SettingRow
              label="Text effect"
              description="A shadow or outline keeps text readable on any background."
              htmlFor="settings-lt-effect"
            >
              <Select
                id="settings-lt-effect"
                value={settings.lowerThirdsTextEffect}
                onChange={(e) => {
                  void update({
                    lowerThirdsTextEffect: e.target.value as 'none' | 'shadow' | 'outline'
                  })
                }}
                className="w-36"
              >
                <option value="none">None</option>
                <option value="shadow">Shadow</option>
                <option value="outline">Outline</option>
              </Select>
            </SettingRow>
          </>
        )}
      </SettingsGroup>
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
        `Backup created: ${plural(entry.manifest?.counts.songs ?? 0, 'song')}, ${plural(entry.manifest?.counts.setlists ?? 0, 'setlist')}, ${formatBytes(entry.sizeBytes)}.`
      )
      await refresh()
    } finally {
      setBusy(null)
    }
  }

  const restore = async (entry: BackupListEntry, mode: BackupImportMode): Promise<void> => {
    const verb = mode === 'replace' ? 'REPLACE your entire library' : 'merge into your library'
    const ok = window.confirm(
      `Restore from ${entry.filename}?\n\nThis will ${verb}. A safety snapshot of your current library is always saved first so you can roll back.`
    )
    if (!ok) return
    setBusy(entry.absolutePath)
    try {
      const result = await window.api.backup.restore(entry.absolutePath, mode)
      setLastMessage(
        `Restored ${plural(result.imported.songs, 'song')}, ${plural(result.imported.setlists, 'setlist')} and ${plural(result.imported.themes, 'theme')}. Safety snapshot: ${result.safetyBackupPath
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
          `Imported ${plural(result.imported.songs, 'song')}, ${plural(result.imported.setlists, 'setlist')} and ${plural(result.imported.themes, 'theme')}.`
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
      <SettingsGroup title="Backup">
        <SettingRow
          label="Create a backup now"
          description="Saves a dated zip of your songs, setlists, themes, fonts and settings."
        >
          <Button size="sm" variant="secondary" onClick={exportNow} disabled={busy !== null}>
            {busy === 'export' ? 'Creating…' : 'Back up now'}
          </Button>
        </SettingRow>
        <SettingRow
          label="Backup folder"
          description="Opens the backups folder in Finder or Explorer, so you can copy a zip to a USB drive."
        >
          <Button size="sm" variant="ghost" onClick={openFolder}>
            Open folder
          </Button>
        </SettingRow>
        <SettingRow
          label="Restore from a zip file"
          description="For a backup zip someone sent you. Otherwise, pick a backup from the list below."
          below={
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void importFromFile('merge')}
                disabled={busy !== null}
              >
                Merge from file…
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void importFromFile('replace')}
                disabled={busy !== null}
              >
                Replace from file…
              </Button>
            </div>
          }
        />
      </SettingsGroup>

      {/* Status line */}
      {lastMessage && <Notice tone="ok">{lastMessage}</Notice>}

      {/* Backup list */}
      <SettingsGroup
        title={`Available backups (${backups.length})`}
        description="Automatic backups keep the 7 most recent. Safety snapshots taken before a restore are kept separately."
        action={
          <Button size="sm" variant="ghost" onClick={() => void refresh()}>
            <RefreshCwIcon size={15} />
            Refresh
          </Button>
        }
      >
        {backups.length === 0 ? (
          <EmptyState
            title="No backups yet"
            description="Choose Back up now to create the first one."
            className="rounded-none border-0 bg-transparent px-4 py-8"
          />
        ) : (
          backups.map((entry) => {
            const isSafety = entry.filename.startsWith('pre-import-')
            const isBusy = busy === entry.absolutePath
            const corrupt = entry.manifest === null
            return (
              <div
                key={entry.absolutePath}
                className="group flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-hover/50"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'truncate text-[13.5px] font-medium',
                        corrupt ? 'text-soft' : 'text-foreground'
                      )}
                    >
                      {formatBackupTime(entry.createdAt)}
                    </span>
                    {isSafety && <Badge tone="neutral">Safety snapshot</Badge>}
                    {corrupt && <Badge tone="warn">Unreadable</Badge>}
                  </div>
                  <div className="mt-0.5 text-[12.5px] tabular-nums text-muted-foreground">
                    {entry.manifest
                      ? `${plural(entry.manifest.counts.songs, 'song')} · ${plural(entry.manifest.counts.setlists, 'setlist')} · ${plural(entry.manifest.counts.themes, 'theme')} · ${formatBytes(entry.sizeBytes)}`
                      : formatBytes(entry.sizeBytes)}
                  </div>
                </div>
                <div
                  className={cn(
                    'flex shrink-0 items-center gap-1 transition-opacity',
                    isBusy
                      ? 'opacity-100'
                      : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
                  )}
                >
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={corrupt || isBusy || busy !== null}
                    onClick={() => void restore(entry, 'merge')}
                  >
                    Merge
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={corrupt || isBusy || busy !== null}
                    onClick={() => void restore(entry, 'replace')}
                  >
                    Replace
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    className="w-8 px-0"
                    aria-label={`Delete backup from ${formatBackupTime(entry.createdAt)}`}
                    title="Delete backup"
                    disabled={isBusy || busy !== null}
                    onClick={() => void remove(entry)}
                  >
                    <TrashIcon size={15} />
                  </Button>
                </div>
              </div>
            )
          })
        )}
      </SettingsGroup>
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
      return `Update v${result.newVersion} is downloading in the background. You'll be asked to restart when it's ready.`
    case 'dev':
      return `Running a development build (v${result.currentVersion}). Auto-update is off in development.`
    case 'error':
      return `Couldn't check for updates: ${result.message}. You may be offline — try again later.`
  }
}

function checkResultTone(result: ManualUpdateCheckResult): 'ok' | 'warn' | 'neutral' {
  switch (result.status) {
    case 'up-to-date':
      return 'ok'
    case 'error':
      return 'warn'
    default:
      return 'neutral'
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
      <div className="flex items-start gap-3.5 rounded-xl border border-border/70 bg-raised/60 p-4">
        <span
          aria-hidden="true"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent text-[20px] font-bold text-app"
        >
          P
        </span>
        <div className="min-w-0">
          <div className="text-[16px] font-semibold text-foreground">Present</div>
          <p className="text-[13px] text-soft">ProChurchCenter · by Sunday Task</p>
          <p className="mt-2 text-[13px] leading-relaxed text-soft">
            A minimal church presenter built for Filipino worship teams. Reliable on Sunday morning,
            editable on Saturday night, and learnable in one rehearsal.
          </p>
        </div>
      </div>

      <SettingsGroup title="Updates">
        <SettingRow
          label="Current version"
          description="Present checks GitHub Releases for updates every time it opens. On a Mac, see the install guide; signed updates arrive in a later release."
        >
          <span className="text-[13.5px] tabular-nums text-foreground">
            {version ? `v${version}` : '…'}
          </span>
        </SettingRow>
        <SettingRow
          label="Check for updates"
          description="Looks for a newer release now. Updates download in the background, and you'll be asked to restart when ready."
          below={
            statusLine && checkResult ? (
              <Notice tone={checkResultTone(checkResult)}>{statusLine}</Notice>
            ) : undefined
          }
        >
          <Button size="sm" variant="secondary" onClick={checkNow} disabled={checking}>
            {checking ? 'Checking…' : 'Check now'}
          </Button>
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="Language">
        <SettingRow
          label="Interface language"
          description="Tagalog is coming in a later release."
          htmlFor="settings-ui-language"
        >
          <Select
            id="settings-ui-language"
            disabled
            value={settings?.uiLanguage ?? 'en'}
            className="w-48"
          >
            <option value="en">English</option>
            <option value="tl">Tagalog</option>
          </Select>
        </SettingRow>
      </SettingsGroup>
    </div>
  )
}

// ─── Loading shell ───────────────────────────────────────────────────

function Shell({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className="flex h-full w-full min-h-0 flex-col text-foreground">
      <PageHeader title="Settings" description={PAGE_DESCRIPTION} />
      <div className="flex flex-1 items-center justify-center text-[14px] text-muted-foreground">
        {children}
      </div>
    </div>
  )
}
