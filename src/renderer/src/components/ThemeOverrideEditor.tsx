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
 * without touching that file — it is restyled separately in Task 21 and
 * still drives the global Settings editor.
 */

import type { Theme, ThemeOverride } from '@shared/types'
import type { SlidePayload } from '@shared/ipc-contract'
import { mergeThemeOverride } from '../lib/themeOverride'
import { THEME_FIELDS, formatFieldValue, type ThemeFieldDef } from '../lib/themeFields'
import { SlideRenderer } from './SlideRenderer'
import { Button } from './ui/Button'
import { Panel } from './ui/Card'
import { MonoLabel } from './ui/MonoLabel'
import { Segmented } from './ui/Segmented'
import { cn } from '../lib/utils'

// Mirrors main/ipc/dialog.ts's 'video' filter extensions exactly, so the
// image/video routing decision here always agrees with what the native
// picker actually let the operator choose.
const VIDEO_EXTENSION_RE = /\.(mp4|mov|webm|mkv|m4v)$/i

function isVideoPath(path: string): boolean {
  return VIDEO_EXTENSION_RE.test(path)
}

/** True when this def's key IS present in the override, OR (for the
 * background-media row) its companion key is. Treats a file row + its
 * companion as one logical field, per the module doc above. */
function isFieldOverridden(def: ThemeFieldDef, override: ThemeOverride): boolean {
  if (def.kind === 'file' && def.companionKey) {
    return override[def.key] !== undefined || override[def.companionKey] !== undefined
  }
  return override[def.key] !== undefined
}

/** The value to DISPLAY for a field, given the effective (merged) theme.
 * For the background-media row this is whichever of image/video is
 * actually set, preferring video since it wins the render priority. */
function effectiveDisplayValue(def: ThemeFieldDef, effective: Theme): unknown {
  if (def.kind === 'file' && def.companionKey) {
    return effective[def.companionKey] ?? effective[def.key]
  }
  return effective[def.key]
}

function fieldPatch(key: keyof ThemeOverride, value: unknown): Partial<Theme> {
  return { [key]: value } as Partial<Theme>
}

function fieldsPatch(entries: Array<[keyof ThemeOverride, unknown]>): Partial<Theme> {
  const obj: Record<string, unknown> = {}
  for (const [k, v] of entries) obj[k] = v
  return obj as Partial<Theme>
}

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
      <div className="flex items-center justify-between gap-4 border border-dashed border-dim p-[18px]">
        <div>
          <div className="mb-1 text-[14px] font-bold text-foreground">Theme override</div>
          <div className="text-[12px] text-dim">
            This song uses the global theme. Override it to give this one song its own look.
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="md"
          className="shrink-0"
          onClick={() => onChange({})}
        >
          OVERRIDE THEME
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

  // Real edits (seg/swatch/step/select/file changes). Mirrors the old
  // ThemeOverrideSection.handleFieldChange: spread the patch onto the
  // current override, then drop any resulting null/undefined entries —
  // mergeThemeOverride treats "field is null in the override" as
  // "inherit", not "force null on the projector" (see its doc comment),
  // so a cleared media field must fall OUT of the override entirely
  // rather than persist as an explicit null.
  const applyPatch = (patch: Partial<Theme>): void => {
    const merged: Record<string, unknown> = { ...override, ...patch }
    const cleaned: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(merged)) {
      if (value !== null && value !== undefined) cleaned[key] = value
    }
    onChange(cleaned as ThemeOverride)
  }

  // REVERT — deletes the key(s) entirely, not just clears them to null/
  // undefined via applyPatch's cleaning. This is the one place a
  // companion key must be well and truly ABSENT from the override
  // afterward, so isFieldOverridden reports this field as inherited
  // again for both the count and the chip tray.
  const revertField = (def: ThemeFieldDef): void => {
    const next: Record<string, unknown> = { ...override }
    delete next[def.key]
    if (def.kind === 'file' && def.companionKey) delete next[def.companionKey]
    onChange(next as ThemeOverride)
  }

  // Promote an inherited chip — seed the override at its CURRENT
  // EFFECTIVE value, straight onto `override` (NOT through applyPatch,
  // which would strip a null value right back out and make a
  // promoted-but-still-empty file field indistinguishable from
  // "never promoted"). Because `effective` is computed from `override`
  // BEFORE this field is added, effective[key] here equals whatever the
  // song already showed — so the merge below is a no-op visually.
  const promoteField = (def: ThemeFieldDef): void => {
    const patch: Record<string, unknown> = { [def.key]: effective[def.key] }
    if (def.kind === 'file' && def.companionKey) {
      patch[def.companionKey] = effective[def.companionKey]
    }
    onChange({ ...override, ...patch } as ThemeOverride)
  }

  // Route a picked file by extension, mirroring ThemeFields.tsx's
  // mutual-clear rule for the two background-media fields exactly:
  // picking a video clears the image key and vice versa.
  const pickField = async (def: ThemeFieldDef & { kind: 'file' }): Promise<void> => {
    const picked = await window.api.dialog.pickFile(def.pickKind)
    if (!picked) return
    if (def.companionKey) {
      const patch = isVideoPath(picked)
        ? fieldsPatch([
            [def.companionKey, picked],
            [def.key, null]
          ])
        : fieldsPatch([
            [def.key, picked],
            [def.companionKey, null]
          ])
      applyPatch(patch)
    } else {
      applyPatch(fieldPatch(def.key, picked))
    }
  }

  return (
    <Panel
      emphasis
      title={<MonoLabel tone="signal">THEME OVERRIDE · THIS SONG ONLY</MonoLabel>}
      action={
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-signal-deep hover:text-signal"
          onClick={() => onChange(null)}
        >
          REMOVE OVERRIDE
        </Button>
      }
    >
      {/* Live preview — the song's first real slide, styled with the
          effective (global + override) theme. */}
      <div className="border-b border-border p-4">
        <div className="aspect-video overflow-hidden border border-border">
          <SlideRenderer payload={previewSlide} mode="live" theme={effective} animate={false} />
        </div>
        <div className="mt-2 font-mono text-[9px] font-medium tracking-[0.08em] text-dim">
          LIVE — THIS SONG&apos;S FIRST SLIDE WITH THE OVERRIDE APPLIED
        </div>
      </div>

      {/* Count row */}
      <div className="flex items-center justify-between border-b border-border px-4 py-[14px]">
        <MonoLabel size="xs" tone="soft">
          {overriddenCount} OF {THEME_FIELDS.length} FIELDS OVERRIDDEN · REST INHERITED
        </MonoLabel>
        {overriddenCount > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-soft hover:text-signal"
            onClick={() => onChange({})}
          >
            REVERT ALL
          </Button>
        )}
      </div>

      {overriddenCount === 0 && (
        <div className="border-b border-border px-4 py-[22px] text-center">
          <div className="mb-1.5 text-[14px] font-bold text-foreground">Nothing overridden yet</div>
          <p className="mx-auto max-w-[46ch] text-[12px] leading-[1.6] text-dim">
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
          onRevert={() => revertField(def)}
          onApplyPatch={applyPatch}
          onPickFile={() => pickField(def as ThemeFieldDef & { kind: 'file' })}
        />
      ))}

      {/* Override-another-field tray */}
      <div className="px-4 py-[14px]">
        <MonoLabel size="xs" className="mb-1 block">
          OVERRIDE ANOTHER FIELD
        </MonoLabel>
        <p className="mb-2.5 text-[11px] text-dim">Everything below follows the global theme.</p>
        <div className="flex flex-wrap gap-[6px]">
          {inheritedDefs.map((def) => (
            <button
              key={def.key}
              type="button"
              onClick={() => promoteField(def)}
              className="flex items-baseline gap-[7px] border border-dashed border-dim bg-transparent px-[10px] py-[7px] hover:border-signal hover:border-solid"
            >
              <MonoLabel size="xs" tone="dim">
                {def.group}
              </MonoLabel>
              <span className="text-[11.5px] font-medium text-bone">{def.label}</span>
              <span className="font-mono text-[10px] text-dim">
                {formatFieldValue(def, effectiveDisplayValue(def, effective))}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="border-t border-border px-4 py-[11px] text-[11px] leading-[1.5] text-soft">
        Anything you don&apos;t set here is inherited from the global theme — clearing a
        field never wipes the global one.
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
    <div className="border-b border-rule">
      <div className="flex items-center justify-between gap-3 px-4 py-[11px]">
        <div className="flex min-w-0 items-baseline gap-[9px]">
          <MonoLabel tone="signal" size="xs" className="shrink-0">
            {def.group}
          </MonoLabel>
          <span className="shrink-0 text-[12.5px] font-semibold text-foreground">{def.label}</span>
          {def.hint && (
            <span className="truncate text-[11px] text-soft">{def.hint}</span>
          )}
        </div>
        <button
          type="button"
          onClick={onRevert}
          className="shrink-0 font-mono text-[8.5px] font-semibold uppercase tracking-[0.08em] text-dim hover:text-signal"
        >
          REVERT
        </button>
      </div>
      <div className="flex items-center justify-end gap-[10px] px-4 pb-3">
        <FieldControl
          def={def}
          effective={effective}
          onApplyPatch={onApplyPatch}
          onPickFile={onPickFile}
        />
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
        options={def.options}
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
        {def.options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            title={opt.label}
            aria-label={opt.label}
            onClick={() => onApplyPatch(fieldPatch(def.key, opt.value))}
            className={cn(
              'h-[26px] w-[26px] border',
              opt.value === current ? 'border-signal' : 'border-border'
            )}
            style={{ backgroundColor: opt.value }}
          />
        ))}
        <span className="min-w-[80px] border border-border px-[9px] py-[6px] text-center font-mono text-[11px] text-soft">
          {formatFieldValue(def, current)}
        </span>
      </div>
    )
  }

  if (def.kind === 'step') {
    const current = Number(effective[def.key] ?? def.min)
    const clamp = (v: number): number => Math.min(def.max, Math.max(def.min, v))
    return (
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onApplyPatch(fieldPatch(def.key, clamp(current - def.step)))}
          className="h-7 w-7 border border-border font-mono text-[12px] font-semibold text-bone hover:border-signal hover:text-signal"
        >
          −
        </button>
        <span className="min-w-[66px] text-center font-mono text-[12px] text-foreground">
          {formatFieldValue(def, current)}
        </span>
        <button
          type="button"
          onClick={() => onApplyPatch(fieldPatch(def.key, clamp(current + def.step)))}
          className="h-7 w-7 border border-border font-mono text-[12px] font-semibold text-bone hover:border-signal hover:text-signal"
        >
          +
        </button>
      </div>
    )
  }

  if (def.kind === 'select') {
    const current = String(effective[def.key] ?? '')
    const known = def.options.some((o) => o.value === current)
    return (
      <select
        value={current}
        onChange={(e) => onApplyPatch(fieldPatch(def.key, e.target.value))}
        className="w-[210px] border border-border bg-background px-[10px] py-2 text-[12px] text-foreground outline-none focus:border-signal/50"
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
      </select>
    )
  }

  // 'file' — the basename plus a Choose… button. Extension-based
  // image/video routing (for the companion-key media row) happens in
  // pickField, up in ActiveOverrideEditor.
  const value = effectiveDisplayValue(def, effective)
  return (
    <div className="flex min-w-0 items-center gap-[10px]">
      <span className="truncate font-mono text-[11px] text-dim">
        {formatFieldValue(def, value)}
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="shrink-0"
        onClick={onPickFile}
      >
        CHOOSE…
      </Button>
    </div>
  )
}
