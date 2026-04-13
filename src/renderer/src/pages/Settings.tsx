/**
 * Settings — polished shell around the existing stores.
 *
 * Layout:
 *   - PageHeader at top
 *   - Two-column body: left = section tabs + form, right = live preview
 *   - Section tabs (Display / Theme / Output / About) split the form
 *     so the massive ThemeFields editor isn't competing with the
 *     short Display/Output rows for vertical real estate
 *
 * Stores behavior is unchanged — this is purely a layout / visual
 * overhaul. Every update still flows through useSettingsStore.update
 * and useThemeStore.update and broadcasts to the output window.
 */

import { useEffect, useState } from 'react'
import type { SlidePayload } from '@shared/ipc-contract'
import { useSettingsStore } from '../stores/useSettingsStore'
import { useThemeStore } from '../stores/useThemeStore'
import { useServiceStore } from '../stores/useServiceStore'
import { SlideRenderer } from '../components/SlideRenderer'
import { ThemeFields } from '../components/ThemeFields'
import { PageHeader } from '../components/ui/PageHeader'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { cn } from '../lib/utils'

type Section = 'display' | 'theme' | 'output' | 'about'

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

export function Settings(): JSX.Element {
  const { settings, loading, load: loadSettings, update: updateSettings } = useSettingsStore()
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
        subtitle="Changes save instantly. The projector restyles on the next frame."
        backTo="/"
      />

      <div className="flex flex-1 overflow-hidden">
        {/* ── Left: section tabs + form ─────────────────────────── */}
        <section className="flex w-[32rem] shrink-0 flex-col border-r border-border/40">
          {/* Section tabs */}
          <nav className="flex shrink-0 gap-1 border-b border-border/40 px-6 pt-4">
            {SECTIONS.map((s) => {
              const active = s.id === section
              return (
                <button
                  key={s.id}
                  onClick={() => setSection(s.id)}
                  className={cn(
                    'relative px-3 pb-3 pt-1 text-xs font-medium transition-colors',
                    active
                      ? 'text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {s.label}
                  {active && (
                    <span className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-brand" />
                  )}
                </button>
              )
            })}
          </nav>

          {/* Section description */}
          <div className="shrink-0 px-6 pt-4">
            <h2 className="text-lg font-semibold text-foreground">
              {activeSection.label}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {activeSection.description}
            </p>
          </div>

          {/* Section content */}
          <div className="flex-1 overflow-y-auto px-6 py-5">
            {section === 'display' && (
              <div className="space-y-4">
                <Card className="p-4">
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
                        const v = Math.max(
                          2,
                          Math.min(20, Math.floor(Number(e.target.value)))
                        )
                        if (v !== settings.maxLinesPerSlide) {
                          void updateSettings({ maxLinesPerSlide: v })
                        }
                      }}
                      className="h-9 w-20 rounded-md border border-border/60 bg-background/60 px-2 text-center text-sm outline-none focus:border-brand/50"
                    />
                  </Row>
                </Card>
              </div>
            )}

            {section === 'theme' && (
              <ThemeFields theme={theme} onChange={(patch) => void updateTheme(patch)} />
            )}

            {section === 'output' && <OutputDisplaySection />}

            {section === 'about' && <AboutSection />}
          </div>
        </section>

        {/* ── Right: live preview ───────────────────────────────── */}
        <aside className="flex flex-1 flex-col bg-background/60 p-8">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-brand/80">
                Live preview
              </div>
              <h3 className="mt-0.5 text-sm font-semibold text-foreground">
                {serviceState.mode === 'running'
                  ? 'Current service slide'
                  : 'Sample verse'}
              </h3>
            </div>
            <span className="text-[11px] text-muted-foreground">
              Reflects every change instantly
            </span>
          </div>

          <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-border/60 shadow-[0_30px_80px_-50px_hsl(var(--brand)/0.35)]">
            <SlideRenderer
              payload={previewPayload}
              mode="live"
              theme={theme}
              animate={false}
            />
          </div>

          <p className="mt-5 max-w-md text-[11px] leading-relaxed text-muted-foreground">
            Every change you make is immediately pushed to the projector
            window. There's no Save button — just close Settings when it
            looks the way you want.
          </p>
        </aside>
      </div>
    </div>
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
      <Card className="p-4">
        <Row label="Display" hint="Which monitor runs the fullscreen output window.">
          <select
            value={settings.outputDisplayId ?? ''}
            onChange={async (e) => {
              const raw = e.target.value
              const id = raw === '' ? null : Number(raw)
              await update({ outputDisplayId: id })
              await window.api.output.setDisplay(id)
            }}
            className="h-9 w-56 rounded-md border border-border/60 bg-background/60 px-2 text-sm outline-none focus:border-brand/50"
          >
            <option value="">Primary</option>
            {displays.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </Row>
      </Card>

      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={refresh}>
          ↻ Refresh display list
        </Button>
      </div>
    </div>
  )
}

// ─── About ───────────────────────────────────────────────────────────

function AboutSection(): JSX.Element {
  const { settings } = useSettingsStore()
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <Row label="Interface language" hint="Tagalog support lands in Phase 7.">
          <select
            disabled
            value={settings?.uiLanguage ?? 'en'}
            className="h-9 w-48 rounded-md border border-border/60 bg-background/40 px-2 text-sm opacity-60"
          >
            <option value="en">English</option>
            <option value="tl">Tagalog</option>
          </select>
        </Row>
      </Card>

      <Card className="p-5">
        <div className="font-editorial text-xl font-semibold text-foreground">
          Present
        </div>
        <p className="mt-1 text-[11px] uppercase tracking-[0.18em] text-brand/80">
          Sunday Task
        </p>
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          A minimal church presenter built for Filipino worship teams.
          Designed to be reliable on Sunday morning, editable on Saturday
          night, and learnable in one rehearsal.
        </p>
      </Card>
    </div>
  )
}

// ─── Local row primitive ─────────────────────────────────────────────

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
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-foreground">{label}</div>
        {hint && (
          <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>
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
      <PageHeader eyebrow="Workspace" title="Settings" backTo="/" />
      <main className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        {children}
      </main>
    </div>
  )
}
