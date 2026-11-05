/**
 * ThemeOverrideEditor — chip-promotion editor for a song's per-song theme
 * override. Replaces the old `ThemeOverrideSection` (which embedded the
 * full `ThemeFields` form) with a model where only OVERRIDDEN fields show
 * an editable row; everything else is a dashed "promote me" chip.
 *
 * Reference: design L188-356, override block L234-335 (Task 12 brief).
 *
 * The defining interaction: promoting an inherited field seeds the
 * override at its CURRENT EFFECTIVE value (global merged with whatever
 * is already overridden), so adding a field to the override is a visual
 * no-op until the operator actually edits it. Every control kind below
 * (including the background-media row) preserves that property.
 *
 * ── The two-key background-media problem ──────────────────────────────
 * `THEME_FIELDS` lists ONE row for "Background media", keyed on
 * `backgroundImagePath`. But `Theme` stores image and video backgrounds
 * as two independent fields, and video wins visually when both are set
 * (see the Theme doc comment in shared/types.ts). A naive generic handler
 * — `onChange({ [def.key]: pickedPath })` — would:
 *   - write a picked .mp4 straight into `backgroundImagePath`, which the
 *     render layer treats as an image path;
 *   - leave any previously-set `backgroundVideoPath` stale, so the
 *     projector keeps showing the OLD video;
 *   - make a song that overrides only `backgroundVideoPath` read as "not
 *     overridden" (override-active checks only tested `backgroundImagePath`).
 *
 * Fix: `ThemeFieldDef`'s 'file' variant carries an optional
 * `companionKey` (see themeFields.ts). Every place that treats THEME_FIELDS
 * as "one row per field" — override-active detection, revert, chip
 * promotion, and the picked-file router below — treats `key` and
 * `companionKey` as ONE logical field:
 *   - overridden  := override[key] !== undefined || override[companionKey] !== undefined
 *   - revert      := delete both keys
 *   - promote     := seed BOTH keys from the effective theme
 *   - pick        := route by extension, mirroring ThemeFields.tsx's
 *                    mutual-clear rule (picking video clears image, and
 *                    vice versa) so global and per-song stay consistent
 *   - display     := whichever of the two effective values is actually set
 *
 * This mirrors ThemeFields.tsx's MediaPickerRow behaviour exactly (L192-210)
 * without touching that file — it still drives the global Settings editor.
 *
 * Presentation (2026-11 redesign): sentence case throughout (the field
 * table in lib/themeFields is sentence case at the source). Accent marks
 * only the current selection
 * (the chosen swatch); there is no decorative orange.
 *
 * All of the actual override-manipulation logic (isFieldOverridden,
 * effectiveDisplayValue, promoteField, revertField, pickField, etc.) is
 * pure and lives in `../lib/themeOverrideFields.ts`, tested directly in
 * `themeOverrideFields.test.ts`. This file keeps only JSX and the event
 * wiring (including the one bit that genuinely needs to live here: the
 * async `window.api.dialog.pickFile` call).
 */

import type { Theme, ThemeOverride } from '@shared/types'
import type { SlidePayload } from '@shared/ipc-contract'
import { mergeThemeOverride } from '../lib/themeOverride'
import { THEME_FIELDS, formatFieldValue, type ThemeFieldDef } from '../lib/themeFields'
import {
  effectiveDisplayValue,
  fieldPatch,
  isFieldOverridden,
  applyOverridePatch,
  pickField,
  promoteField,
  revertField
} from '../lib/themeOverrideFields'
import { SlideRenderer } from './SlideRenderer'
import { Button } from './ui/Button'
import { Badge } from './ui/Badge'
import { Panel } from './ui/Card'
import { Select } from './ui/Input'
import { Segmented } from './ui/Segmented'
import { PaletteIcon, PlusIcon } from './icons'
import { cn } from '../lib/utils'

interface ThemeOverrideEditorProps {
  /** null = this song has no override and inherits the global theme entirely. */
  override: ThemeOverride | null
  globalTheme: Theme
  onChange: (next: ThemeOverride | null) => void
  /** The song's first real slide (or a placeholder), rendered with the
   * effective theme so the operator sees exactly what the projector will show. */
  previewSlide: SlidePayload
}

export function ThemeOverrideEditor({
  override,
  globalTheme,
  onChange,
  previewSlide
}: ThemeOverrideEditorProps): JSX.Element {
  if (override === null) {
    return (
      <div className="flex items-center gap-4 rounded-xl border border-dashed border-border px-4 py-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-raised text-soft">
          <PaletteIcon size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold text-foreground">Theme override</div>
          <div className="text-[13px] text-soft">
            This song uses the global theme. Override it to give this one song its own look.
          </div>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="shrink-0"
          onClick={() => onChange({})}
        >
          Override theme
        </Button>
      </div>
    )
  }

  return (
    <ActiveOverrideEditor
      override={override}
      globalTheme={globalTheme}
      onChange={onChange}
      previewSlide={previewSlide}
    />
  )
}

function ActiveOverrideEditor({
  override,
  globalTheme,
  onChange,
  previewSlide
}: {
  override: ThemeOverride
  globalTheme: Theme
  onChange: (next: ThemeOverride | null) => void
  previewSlide: SlidePayload
}): JSX.Element {
  const effective = mergeThemeOverride(globalTheme, override)
  const activeDefs = THEME_FIELDS.filter((def) => isFieldOverridden(def, override))
  const inheritedDefs = THEME_FIELDS.filter((def) => !isFieldOverridden(def, override))
  const overriddenCount = activeDefs.length

  // Real edits (seg/swatch/step/select/file changes) — see
  // applyOverridePatch's doc comment for why nulls get stripped.
  const handleApplyPatch = (patch: Partial<Theme>): void => {
    onChange(applyOverridePatch(override, patch))
  }

  const handleRevert = (def: ThemeFieldDef): void => {
    onChange(revertField(override, def))
  }

  const handlePromote = (def: ThemeFieldDef): void => {
    onChange(promoteField(override, def, globalTheme))
  }

  // The one bit of IO in this file: ask the native dialog for a path,
  // then hand it to the pure pickField() to route by extension.
  const handlePickFile = async (def: ThemeFieldDef & { kind: 'file' }): Promise<void> => {
    const picked = await window.api.dialog.pickFile(def.pickKind)
    if (!picked) return
    onChange(pickField(override, def, picked))
  }

  return (
    <Panel
      title={
        <span className="flex items-center gap-2.5">
          <span className="text-[14px] font-semibold text-foreground">Theme override</span>
          <Badge tone="neutral">This song only</Badge>
        </span>
      }
      action={
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
          Remove override
        </Button>
      }
    >
      {/* Live preview — the song's first real slide, styled with the
          effective (global + override) theme. */}
      <div className="p-4 pb-3">
        <div className="aspect-video overflow-hidden rounded-lg ring-1 ring-inset ring-white/5">
          <SlideRenderer payload={previewSlide} mode="live" theme={effective} animate={false} />
        </div>
        <div className="mt-2 text-[12.5px] text-muted-foreground">
          This song&apos;s first slide with the override applied
        </div>
      </div>

      {/* Count row */}
      <div className="flex min-h-[44px] items-center justify-between gap-3 border-t border-rule px-4 py-1.5">
        <span className="text-[13px] tabular-nums text-soft">
          {overriddenCount} of {THEME_FIELDS.length} fields overridden
        </span>
        {overriddenCount > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="-mr-2 shrink-0"
            onClick={() => onChange({})}
          >
            Revert all
          </Button>
        )}
      </div>

      {overriddenCount === 0 && (
        <div className="border-t border-rule px-4 py-6 text-center">
          <div className="mb-1 text-[14px] font-semibold text-foreground">Nothing overridden yet</div>
          <p className="mx-auto max-w-[46ch] text-[13px] leading-[1.55] text-soft">
            This song looks exactly like the global theme. Add only the fields you want
            different — everything else keeps following the global theme, even when you
            change it later.
          </p>
        </div>
      )}

      {activeDefs.map((def) => (
        <ActiveFieldRow
          key={def.key}
          def={def}
          effective={effective}
          onRevert={() => handleRevert(def)}
          onApplyPatch={handleApplyPatch}
          onPickFile={() => handlePickFile(def as ThemeFieldDef & { kind: 'file' })}
        />
      ))}

      {/* Override-another-field tray */}
      {inheritedDefs.length > 0 && (
        <div className="border-t border-rule px-4 py-4">
          <div className="text-[13px] font-medium text-quiet">Override another field</div>
          <p className="mb-3 text-[12.5px] text-muted-foreground">
            Everything below follows the global theme.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {inheritedDefs.map((def) => (
              <button
                key={def.key}
                type="button"
                onClick={() => handlePromote(def)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border px-2.5 py-1.5 text-left transition-colors hover:border-solid hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
              >
                <PlusIcon size={13} className="shrink-0 text-muted-foreground" />
                <span className="text-[13px] font-medium text-bone">{def.label}</span>
                <span className="max-w-[16ch] truncate text-[12px] text-muted-foreground">
                  {formatFieldValue(def, effectiveDisplayValue(def, effective))}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="border-t border-rule px-4 py-3 text-[12.5px] leading-[1.5] text-muted-foreground">
        Anything you don&apos;t set here is inherited from the global theme — clearing a field
        never wipes the global one.
      </div>
    </Panel>
  )
}

// ─── Active field row + per-kind controls ──────────────────────────────

function ActiveFieldRow({
  def,
  effective,
  onRevert,
  onApplyPatch,
  onPickFile
}: {
  def: ThemeFieldDef
  effective: Theme
  onRevert: () => void
  onApplyPatch: (patch: Partial<Theme>) => void
  onPickFile: () => void
}): JSX.Element {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-rule px-4 py-3">
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-[13.5px] font-medium text-foreground">{def.label}</span>
          <span className="text-[12px] text-muted-foreground">{def.group}</span>
        </div>
        {def.hint && <div className="truncate text-[12.5px] text-soft">{def.hint}</div>}
      </div>
      <div className="ml-auto flex min-w-0 items-center gap-2">
        <FieldControl
          def={def}
          effective={effective}
          onApplyPatch={onApplyPatch}
          onPickFile={onPickFile}
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="-mr-2 shrink-0 px-2"
          onClick={onRevert}
          aria-label={`Revert ${def.label} to the global theme`}
        >
          Revert
        </Button>
      </div>
    </div>
  )
}

function FieldControl({
  def,
  effective,
  onApplyPatch,
  onPickFile
}: {
  def: ThemeFieldDef
  effective: Theme
  onApplyPatch: (patch: Partial<Theme>) => void
  onPickFile: () => void
}): JSX.Element {
  if (def.kind === 'seg') {
    return (
      <Segmented
        options={def.options.map((o) => ({ value: o.value, label: o.label }))}
        value={String(effective[def.key])}
        onChange={(v) => onApplyPatch(fieldPatch(def.key, v))}
        size="sm"
      />
    )
  }

  if (def.kind === 'swatch') {
    const current = String(effective[def.key] ?? '')
    return (
      <div className="flex items-center gap-2">
        {def.options.map((opt) => {
          const selected = opt.value === current
          return (
            <button
              key={opt.value}
              type="button"
              title={opt.label}
              aria-label={opt.label}
              aria-pressed={selected}
              onClick={() => onApplyPatch(fieldPatch(def.key, opt.value))}
              className={cn(
                'h-7 w-7 rounded-md border border-white/10 transition-shadow',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70',
                selected && 'ring-2 ring-accent ring-offset-2 ring-offset-raised'
              )}
              style={{ backgroundColor: opt.value }}
            />
          )
        })}
        <span className="min-w-[72px] rounded-md bg-panel px-2 py-1.5 text-center text-[12px] text-soft">
          {formatFieldValue(def, current)}
        </span>
      </div>
    )
  }

  if (def.kind === 'step') {
    const current = Number(effective[def.key] ?? def.min)
    const clamp = (v: number): number => Math.min(def.max, Math.max(def.min, v))
    return (
      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="w-8 px-0 text-[15px]"
          aria-label={`Decrease ${def.label}`}
          onClick={() => onApplyPatch(fieldPatch(def.key, clamp(current - def.step)))}
        >
          −
        </Button>
        <span className="min-w-[64px] text-center text-[13px] tabular-nums text-foreground">
          {formatFieldValue(def, current)}
        </span>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="w-8 px-0 text-[15px]"
          aria-label={`Increase ${def.label}`}
          onClick={() => onApplyPatch(fieldPatch(def.key, clamp(current + def.step)))}
        >
          +
        </Button>
      </div>
    )
  }

  if (def.kind === 'select') {
    const current = String(effective[def.key] ?? '')
    const known = def.options.some((o) => o.value === current)
    return (
      <Select
        value={current}
        onChange={(e) => onApplyPatch(fieldPatch(def.key, e.target.value))}
        aria-label={def.label}
        className="h-8 w-[200px] text-[13px]"
      >
        {def.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
        {/* Defensive fallback: a value this select doesn't know about
            (e.g. a custom/system font picked in Settings) must still
            show as itself rather than silently snapping to the first
            option. Mirrors ThemeFields.tsx's own "Custom value" guard. */}
        {!known && current && <option value={current}>Custom value</option>}
      </Select>
    )
  }

  // 'file' — the basename plus a Choose… button. Extension-based
  // image/video routing (for the companion-key media row) happens in
  // pickField, up in ActiveOverrideEditor.
  const value = effectiveDisplayValue(def, effective)
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span className="min-w-0 max-w-[180px] truncate text-[13px] text-soft">
        {formatFieldValue(def, value)}
      </span>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="shrink-0"
        onClick={onPickFile}
      >
        Choose…
      </Button>
    </div>
  )
}
