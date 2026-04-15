/**
 * ThemeFields — the grouped theme-editor form.
 *
 * Rendered by TWO consumers:
 *   1. Settings.tsx — edits the global theme
 *   2. SongEditor.tsx — edits a per-song theme override
 *
 * Both pass a `theme` value to display and an `onChange(patch)` callback
 * that receives a partial theme diff. The caller decides what to do with
 * the patch (write to the global theme record vs spread into an override).
 *
 * This component does not own state; it's a pure render-prop of the
 * current theme value. Any "live preview" behavior lives in the parent
 * because the preview depends on the parent's context (current service
 * slide, current song draft, etc).
 *
 * The layout is identical to the one that used to live inline in
 * Settings.tsx; extracting kept all visual details the same so the
 * Settings page looks unchanged.
 */

import { useEffect } from 'react'
import type { Theme, TextAlign, TextPosition, TextEffect, Transition } from '@shared/types'
import type { PickFileKind } from '@shared/ipc-contract'
import { useFontsStore } from '../stores/useFontsStore'

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
    <div className="space-y-6">
      {/* Typography */}
      <Group title="Typography" description="Font and text color for song lyrics and scripture.">
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
          <div className="flex flex-col gap-1.5">
            <button
              type="button"
              onClick={() => {
                void uploadCustom()
              }}
              className="self-start rounded-md border border-border/60 bg-background px-2.5 py-1 text-xs hover:border-border"
            >
              Upload font file…
            </button>
            <p className="text-[11px] text-muted-foreground/80">
              .ttf, .otf, .woff, .woff2 — uploaded fonts are available
              to every theme.
            </p>
            {customFonts.length > 0 && (
              <ul className="mt-1 flex flex-col gap-0.5">
                {customFonts.map((f) => (
                  <li
                    key={f.family}
                    className="flex items-center justify-between gap-2 rounded border border-border/40 bg-background/40 px-2 py-1 text-[11px]"
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
                      className="text-muted-foreground hover:text-foreground"
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
              className="flex-1"
            />
            <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">
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
        title="Background"
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
      <Group title="Text placement" description="Where lyrics land on the slide.">
        <Row label="Horizontal">
          <SegmentedButtons<TextAlign>
            value={theme.textAlign}
            onChange={(v) => onChange({ textAlign: v })}
            options={[
              { value: 'left', label: 'Left' },
              { value: 'center', label: 'Center' },
              { value: 'right', label: 'Right' }
            ]}
          />
        </Row>

        <Row label="Vertical">
          <SegmentedButtons<TextPosition>
            value={theme.textPosition}
            onChange={(v) => onChange({ textPosition: v })}
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
        title="Text effects"
        description="Makes text legible against busy backgrounds."
      >
        <Row label="Effect">
          <SegmentedButtons<TextEffect>
            value={theme.textEffect}
            onChange={(v) => onChange({ textEffect: v })}
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
          <SegmentedButtons<Transition>
            value={theme.transition}
            onChange={(v) => onChange({ transition: v })}
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
                className="flex-1"
              />
              <span className="w-14 text-right text-xs tabular-nums text-muted-foreground">
                {theme.transitionDurationMs}ms
              </span>
            </div>
          </Row>
        )}
      </Group>

      {/* Standby */}
      <Group
        title="Standby image"
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
// Local layout primitives (identical to the ones that used to live in Settings.tsx)
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
    <section>
      <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      {description && (
        <p className="mt-0.5 text-[11px] text-muted-foreground/70">{description}</p>
      )}
      <div className="mt-2 space-y-2 rounded-lg border border-border/40 p-3">
        {children}
      </div>
    </section>
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
    <label className="flex items-center justify-between gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="min-w-0 flex-1 text-right">{children}</div>
    </label>
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
        className="h-7 w-10 cursor-pointer rounded-md border border-border/60 bg-transparent"
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-20 rounded-md border border-border/60 bg-background px-2 py-1 text-right font-mono text-[11px] outline-none focus:border-border"
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
            className="max-w-[10rem] truncate text-[10px] text-muted-foreground"
            title={value}
          >
            {displayFileName(value)}
          </span>
        )}
        <button
          onClick={handlePick}
          className="rounded-md border border-border/60 bg-background px-2 py-1 text-[11px] hover:border-border"
        >
          {value ? 'Change…' : 'Choose…'}
        </button>
        {value && (
          <button
            onClick={onClear}
            className="text-[11px] text-red-500 hover:underline"
          >
            clear
          </button>
        )}
      </div>
    </Row>
  )
}

function displayFileName(path: string): string {
  const parts = path.split(/[/\\]/)
  return parts[parts.length - 1] || path
}

function SegmentedButtons<T extends string>({
  value,
  onChange,
  options
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
}): JSX.Element {
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-border/60">
      {options.map((opt) => {
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={`px-2.5 py-1 text-[11px] transition-colors ${
              active
                ? 'bg-foreground text-background'
                : 'bg-background text-muted-foreground hover:text-foreground'
            }`}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

const selectClass =
  'w-48 rounded-md border border-border/60 bg-background px-2 py-1 text-xs outline-none focus:border-border'
