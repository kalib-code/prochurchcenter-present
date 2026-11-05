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
 * Presentation uses the shared Settings vocabulary (components/settings/
 * SettingsKit): `SettingsGroup` panels with a sentence-case title and
 * description, and `SettingRow`s with the label on the left and the
 * control on the right. The props and `onChange` patch contract are
 * unchanged from the pre-redesign version; only presentation moved.
 */

import { useEffect, useState } from 'react'
import type { Theme, TextAlign, TextPosition, TextEffect, Transition } from '@shared/types'
import type { PickFileKind } from '@shared/ipc-contract'
import { useFontsStore } from '../stores/useFontsStore'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { Input, Select } from './ui/Input'
import { Segmented } from './ui/Segmented'
import { ColorInput, RangeInput, SettingRow, SettingsGroup } from './settings/SettingsKit'

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
      <Group title="Typography" description="Font and text color for song lyrics and scripture.">
        <Row label="Font" htmlFor="theme-font">
          <Select
            id="theme-font"
            value={theme.fontFamily}
            onChange={(e) => onChange({ fontFamily: e.target.value })}
            className="w-56"
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
            {![
              ...BUILT_IN_FONT_OPTIONS.map((f) => f.value),
              ...customFonts.map((f) => `"${f.family}"`),
              ...systemFonts.map((f) => `"${f}"`)
            ].includes(theme.fontFamily) && <option value={theme.fontFamily}>Custom value</option>}
          </Select>
        </Row>

        <Row
          label="Custom fonts"
          description=".ttf, .otf, .woff or .woff2. Uploaded fonts are available to every theme."
          below={
            customFonts.length > 0 ? (
              <ul className="flex flex-col gap-1">
                {customFonts.map((f) => (
                  <li
                    key={f.family}
                    className="flex items-center justify-between gap-3 rounded-md bg-hover/60 px-3 py-1.5 text-[13.5px] text-bone"
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
                      className="shrink-0 rounded px-1.5 py-0.5 text-[12.5px] text-muted-foreground transition-colors hover:text-live focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
                      title="Remove font"
                      aria-label={`Remove font ${f.family}`}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            ) : undefined
          }
        >
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              void uploadCustom()
            }}
          >
            Upload font…
          </Button>
        </Row>

        <Row label="Size" htmlFor="theme-font-size">
          <RangeInput
            id="theme-font-size"
            min={50}
            max={150}
            step={5}
            value={theme.fontSizePercent}
            onChange={(e) => onChange({ fontSizePercent: Number(e.target.value) })}
            readout={`${theme.fontSizePercent}%`}
          />
        </Row>

        <Row label="Text color">
          <ColorField value={theme.textColor} onChange={(v) => onChange({ textColor: v })} />
        </Row>
      </Group>

      {/* Background */}
      <Group
        title="Background"
        description="The layer behind every slide. Choosing an image clears the video, and the other way round."
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
          onPick={(path) => onChange({ backgroundImagePath: path, backgroundVideoPath: null })}
          onClear={() => onChange({ backgroundImagePath: null })}
        />

        <MediaPickerRow
          label="Video"
          value={theme.backgroundVideoPath}
          kind="video"
          onPick={(path) => onChange({ backgroundVideoPath: path, backgroundImagePath: null })}
          onClear={() => onChange({ backgroundVideoPath: null })}
        />
      </Group>

      {/* Placement */}
      <Group title="Text placement" description="Where lyrics land on the slide.">
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
      <Group title="Text effects" description="Makes text legible against busy backgrounds.">
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
      <Group title="Transitions" description="How one slide hands off to the next.">
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
          <Row label="Duration" htmlFor="theme-transition-duration">
            <RangeInput
              id="theme-transition-duration"
              min={50}
              max={1000}
              step={50}
              value={theme.transitionDurationMs}
              onChange={(e) => onChange({ transitionDurationMs: Number(e.target.value) })}
              readout={`${theme.transitionDurationMs} ms`}
            />
          </Row>
        )}
      </Group>

      {/* Standby */}
      <Group
        title="Standby image"
        description="Shown when you press L during a service, such as your church logo."
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
// Local layout primitives — thin aliases over the shared Settings kit
// ─────────────────────────────────────────────────────────────────────────────

const Group = SettingsGroup
const Row = SettingRow

function ColorField({
  value,
  onChange
}: {
  value: string
  onChange: (v: string) => void
}): JSX.Element {
  return (
    <div className="flex items-center justify-end gap-2">
      <ColorInput
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Pick color"
      />
      <Input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Hex color"
        spellCheck={false}
        className="w-28 px-2.5 text-[13px] tabular-nums"
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

  // Flag a theme file that has been moved or deleted: the projector
  // silently drops a missing background, so say so where it's fixed.
  const [missing, setMissing] = useState(false)
  useEffect(() => {
    let cancelled = false
    if (!value) {
      setMissing(false)
      return
    }
    window.api.files
      .checkExists([value])
      .then((r) => {
        if (!cancelled) setMissing(r[value] === false)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [value])

  return (
    <Row
      label={label}
      description={
        value ? (
          <span className="flex max-w-[18rem] items-center gap-1.5" title={value}>
            <span className={missing ? 'truncate text-warn' : 'truncate text-soft'}>
              {displayFileName(value)}
            </span>
            {missing && <Badge tone="warn">Missing</Badge>}
          </span>
        ) : (
          'None'
        )
      }
    >
      <div className="flex items-center justify-end gap-1.5">
        {value && (
          <Button type="button" variant="ghost" size="sm" onClick={onClear}>
            Clear
          </Button>
        )}
        <Button type="button" variant="secondary" size="sm" onClick={handlePick}>
          {value ? 'Change…' : 'Choose…'}
        </Button>
      </div>
    </Row>
  )
}

function displayFileName(path: string): string {
  const parts = path.split(/[/\\]/)
  return parts[parts.length - 1] || path
}
