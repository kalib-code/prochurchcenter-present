/**
 * ThemeFields — the grouped theme-editor form.
 *
 * Rendered by ONE consumer now: Settings.tsx's THEME tab, editing the
 * global theme. (SongEditor.tsx moved to ThemeOverrideEditor.tsx for its
 * per-song override chips — see that file's doc comment.)
 *
 * The caller passes a `theme` value to display and an `onChange(patch)`
 * callback that receives a partial theme diff. The caller decides what to
 * do with the patch (write to the global theme record).
 *
 * This component does not own state; it's a pure render-prop of the
 * current theme value. Any "live preview" behavior lives in the parent
 * because the preview depends on the parent's context (current service
 * slide, current song draft, etc).
 *
 * Presentation matches the KLB row layout used throughout Settings.tsx —
 * bordered `Panel` groups with a mono head, each row a
 * `flex items-center gap-4 border-b border-rule px-4 py-3.5` with the
 * label on the left and the control on the right. The props and
 * `onChange` patch contract are unchanged from the pre-redesign version;
 * only presentation moved.
 */

import { useEffect } from 'react'
import type { Theme, TextAlign, TextPosition, TextEffect, Transition } from '@shared/types'
import type { PickFileKind } from '@shared/ipc-contract'
import { useFontsStore } from '../stores/useFontsStore'
import { Button } from './ui/Button'
import { Panel } from './ui/Card'
import { Segmented } from './ui/Segmented'

const BUILT_IN_FONT_OPTIONS: { label: string; value: string }[] = [
  { label: 'System', value: 'system-ui, -apple-system, Segoe UI, sans-serif' },
  { label: 'Inter', value: 'Inter, system-ui, sans-serif' },
  { label: 'Helvetica', value: 'Helvetica Neue, Helvetica, Arial, sans-serif' },
  { label: 'Arial', value: 'Arial, sans-serif' },
  { label: 'Georgia (serif)', value: 'Georgia, serif' },
  { label: 'Times', value: 'Times New Roman, Times, serif' },
  { label: 'Courier (mono)', value: 'Menlo, Courier New, monospace' }
]

interface ThemeFieldsProps {
  /** Current effective theme — drives the displayed values. */
  theme: Theme
  /** Fires whenever a field changes. The patch contains only the changed keys. */
  onChange: (patch: Partial<Theme>) => void
}

export function ThemeFields({ theme, onChange }: ThemeFieldsProps): JSX.Element {
  // Custom + system fonts come from the fonts store. Loaded lazily so
  // theme editing for someone who's never opened Settings doesn't pay
  // the cost of querying every font installed on their machine.
  const customFonts = useFontsStore((s) => s.custom)
  const systemFonts = useFontsStore((s) => s.system)
  const loadingSystem = useFontsStore((s) => s.loadingSystem)
  const systemError = useFontsStore((s) => s.systemError)
  const loadSystem = useFontsStore((s) => s.loadSystem)
  const uploadCustom = useFontsStore((s) => s.uploadCustom)
  const deleteCustom = useFontsStore((s) => s.deleteCustom)

  useEffect(() => {
    if (systemFonts.length === 0 && !loadingSystem && !systemError) {
      void loadSystem()
    }
  }, [systemFonts.length, loadingSystem, systemError, loadSystem])

  return (
    <div className="space-y-4">
      {/* Typography */}
      <Group title="TYPOGRAPHY" description="Font and text color for song lyrics and scripture.">
        <Row label="Font">
          <select
            value={theme.fontFamily}
            onChange={(e) => onChange({ fontFamily: e.target.value })}
            className={selectClass}
          >
            <optgroup label="Built-in">
              {BUILT_IN_FONT_OPTIONS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </optgroup>
            {customFonts.length > 0 && (
              <optgroup label="Custom (uploaded)">
                {customFonts.map((f) => (
                  <option key={f.family} value={`"${f.family}"`}>
                    {f.family}
                  </option>
                ))}
              </optgroup>
            )}
            {systemFonts.length > 0 && (
              <optgroup label="System fonts">
                {systemFonts.map((family) => (
                  <option key={family} value={`"${family}"`}>
                    {family}
                  </option>
                ))}
              </optgroup>
            )}
            {/* Fallback option for legacy themes whose fontFamily
                doesn't match any of the above (e.g. older saved value). */}
            {![...BUILT_IN_FONT_OPTIONS.map((f) => f.value),
               ...customFonts.map((f) => `"${f.family}"`),
               ...systemFonts.map((f) => `"${f}"`)].includes(theme.fontFamily) && (
              <option value={theme.fontFamily}>Custom value</option>
            )}
          </select>
        </Row>

        <Row label="Custom fonts">
          <div className="flex flex-col items-end gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                void uploadCustom()
              }}
            >
              Upload font file…
            </Button>
            <p className="max-w-[220px] text-right text-[10.5px] leading-[1.5] text-muted-foreground">
              .ttf, .otf, .woff, .woff2 — uploaded fonts are available
              to every theme.
            </p>
            {customFonts.length > 0 && (
              <ul className="mt-1 flex w-full flex-col gap-1">
                {customFonts.map((f) => (
                  <li
                    key={f.family}
                    className="flex items-center justify-between gap-2 border border-rule px-2 py-1 text-[11px]"
                  >
                    <span
                      className="truncate"
                      style={{ fontFamily: `"${f.family}"` }}
                      title={f.filename}
                    >
                      {f.family}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        void deleteCustom(f.family)
                      }}
                      className="shrink-0 text-muted-foreground hover:text-signal"
                      title="Remove font"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Row>

        <Row label="Size">
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={50}
              max={150}
              step={5}
              value={theme.fontSizePercent}
              onChange={(e) =>
                onChange({ fontSizePercent: Number(e.target.value) })
              }
              className="w-28"
            />
            <span className="w-12 text-right text-[11px] tabular-nums text-muted-foreground">
              {theme.fontSizePercent}%
            </span>
          </div>
        </Row>

        <Row label="Text color">
          <ColorField
            value={theme.textColor}
            onChange={(v) => onChange({ textColor: v })}
          />
        </Row>
      </Group>

      {/* Background */}
      <Group
        title="BACKGROUND"
        description="The base layer behind every slide. Picking an image clears the video and vice versa."
      >
        <Row label="Color">
          <ColorField
            value={theme.backgroundColor}
            onChange={(v) => onChange({ backgroundColor: v })}
          />
        </Row>

        <MediaPickerRow
          label="Image"
          value={theme.backgroundImagePath}
          kind="image"
          onPick={(path) =>
            onChange({ backgroundImagePath: path, backgroundVideoPath: null })
          }
          onClear={() => onChange({ backgroundImagePath: null })}
        />

        <MediaPickerRow
          label="Video"
          value={theme.backgroundVideoPath}
          kind="video"
          onPick={(path) =>
            onChange({ backgroundVideoPath: path, backgroundImagePath: null })
          }
          onClear={() => onChange({ backgroundVideoPath: null })}
        />
      </Group>

      {/* Placement */}
      <Group title="TEXT PLACEMENT" description="Where lyrics land on the slide.">
        <Row label="Horizontal">
          <Segmented<TextAlign>
            value={theme.textAlign}
            onChange={(v) => onChange({ textAlign: v })}
            size="sm"
            options={[
              { value: 'left', label: 'Left' },
              { value: 'center', label: 'Center' },
              { value: 'right', label: 'Right' }
            ]}
          />
        </Row>

        <Row label="Vertical">
          <Segmented<TextPosition>
            value={theme.textPosition}
            onChange={(v) => onChange({ textPosition: v })}
            size="sm"
            options={[
              { value: 'top', label: 'Top' },
              { value: 'center', label: 'Middle' },
              { value: 'bottom', label: 'Bottom' }
            ]}
          />
        </Row>
      </Group>

      {/* Effects */}
      <Group
        title="TEXT EFFECTS"
        description="Makes text legible against busy backgrounds."
      >
        <Row label="Effect">
          <Segmented<TextEffect>
            value={theme.textEffect}
            onChange={(v) => onChange({ textEffect: v })}
            size="sm"
            options={[
              { value: 'none', label: 'None' },
              { value: 'shadow', label: 'Shadow' },
              { value: 'outline', label: 'Outline' },
              { value: 'highlight', label: 'Highlight' }
            ]}
          />
        </Row>

        {theme.textEffect === 'highlight' && (
          <Row label="Highlight color">
            <ColorField
              value={theme.highlightColor}
              onChange={(v) => onChange({ highlightColor: v })}
            />
          </Row>
        )}
      </Group>

      {/* Transitions */}
      <Group title="TRANSITIONS" description="How one slide hands off to the next.">
        <Row label="Type">
          <Segmented<Transition>
            value={theme.transition}
            onChange={(v) => onChange({ transition: v })}
            size="sm"
            options={[
              { value: 'fade', label: 'Fade' },
              { value: 'instant', label: 'Instant' }
            ]}
          />
        </Row>

        {theme.transition === 'fade' && (
          <Row label="Duration">
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={50}
                max={1000}
                step={50}
                value={theme.transitionDurationMs}
                onChange={(e) =>
                  onChange({ transitionDurationMs: Number(e.target.value) })
                }
                className="w-28"
              />
              <span className="w-14 text-right text-[11px] tabular-nums text-muted-foreground">
                {theme.transitionDurationMs}ms
              </span>
            </div>
          </Row>
        )}
      </Group>

      {/* Standby */}
      <Group
        title="STANDBY IMAGE"
        description="Shown when you press L during a service (e.g. church logo)."
      >
        <MediaPickerRow
          label="Image"
          value={theme.logoPath}
          kind="image"
          onPick={(path) => onChange({ logoPath: path })}
          onClear={() => onChange({ logoPath: null })}
        />
      </Group>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Local layout primitives
// ─────────────────────────────────────────────────────────────────────────────

function Group({
  title,
  description,
  children
}: {
  title: string
  description?: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <Panel title={title}>
      {description && (
        <div className="border-b border-rule px-4 py-2.5 text-[11px] leading-[1.5] text-muted-foreground">
          {description}
        </div>
      )}
      {children}
    </Panel>
  )
}

function Row({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <div className="flex items-center gap-4 border-b border-rule px-4 py-3.5 last:border-b-0">
      <span className="text-[13px] font-semibold text-foreground">{label}</span>
      <div className="min-w-0 flex-1 text-right">{children}</div>
    </div>
  )
}

function ColorField({
  value,
  onChange
}: {
  value: string
  onChange: (v: string) => void
}): JSX.Element {
  return (
    <div className="flex items-center justify-end gap-2">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-11 cursor-pointer border border-border bg-transparent"
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-24 border border-border bg-background px-2 py-1 text-right font-mono text-[11px] text-foreground outline-none focus:border-signal/50"
      />
    </div>
  )
}

function MediaPickerRow({
  label,
  value,
  kind,
  onPick,
  onClear
}: {
  label: string
  value: string | null
  kind: PickFileKind
  onPick: (path: string) => void
  onClear: () => void
}): JSX.Element {
  const handlePick = async (): Promise<void> => {
    const picked = await window.api.dialog.pickFile(kind)
    if (picked) onPick(picked)
  }

  return (
    <Row label={label}>
      <div className="flex items-center justify-end gap-2">
        {value && (
          <span
            className="max-w-[10rem] truncate font-mono text-[10px] text-muted-foreground"
            title={value}
          >
            {displayFileName(value)}
          </span>
        )}
        <Button type="button" variant="outline" size="sm" onClick={handlePick}>
          {value ? 'Change…' : 'Choose…'}
        </Button>
        {value && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-signal-deep hover:text-signal"
            onClick={onClear}
          >
            Clear
          </Button>
        )}
      </div>
    </Row>
  )
}

function displayFileName(path: string): string {
  const parts = path.split(/[/\\]/)
  return parts[parts.length - 1] || path
}

const selectClass =
  'w-56 border border-border bg-background px-2 py-1.5 text-[13px] text-foreground outline-none focus:border-signal/50'
