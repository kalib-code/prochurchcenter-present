/**
 * themeOverrideFields — pure data helpers for the per-song theme override
 * editor (`../components/ThemeOverrideEditor.tsx`).
 *
 * Extracted out of the component so this logic — which is where the
 * two-key background-media problem and the promotion-is-a-visual-no-op
 * guarantee actually live — has a home under `src/renderer/src/lib`. That
 * matters mechanically, not just stylistically: `vitest.config.ts`'s
 * `include` only collects `src/shared/**\/*.test.ts` and
 * `src/renderer/src/lib/**\/*.test.ts`. A test file placed next to the
 * component in `src/renderer/src/components/` would be silently skipped
 * by the test runner — the exact trap an earlier task already hit once,
 * which is why that glob doesn't cover `components/` in the first place.
 *
 * Every function here is pure: plain `Theme` / `ThemeOverride` /
 * `ThemeFieldDef` data in, plain data out. No React, no IPC. The one
 * exception is the actual `window.api.dialog.pickFile` call, which stays
 * in the component — `pickField` below takes the already-picked path as
 * a plain string argument instead of doing the picking itself, so it can
 * be tested without a fake IPC bridge.
 */

import type { Theme, ThemeOverride } from '@shared/types'
import type { ThemeFieldDef } from './themeFields'
import { mergeThemeOverride } from './themeOverride'

/**
 * Mirrors `main/ipc/dialog.ts`'s `'video'` filter extensions exactly, so
 * the image/video routing decision here always agrees with what the
 * native picker actually let the operator choose.
 */
export const VIDEO_EXTENSION_RE = /\.(mp4|mov|webm|mkv|m4v)$/i

/**
 * True for a path whose extension is one of the five video extensions
 * `dialog.ts`'s `'video'` filter offers; false (i.e. "treat as an image")
 * for everything else. That "unrecognised → image" default is only safe
 * because `dialog.ts`'s `'media'` filter — the ONLY filter this field's
 * `pickKind` uses — offers exactly these 11 extensions (6 image + 5
 * video) and no others, so there is no third case a real picker dialog
 * can actually hand back. If `dialog.ts`'s filters ever grow a new media
 * kind, this regex has to grow with it.
 */
export function isVideoPath(path: string): boolean {
  return VIDEO_EXTENSION_RE.test(path)
}

/**
 * True when this def's key is present in the override, OR — for the
 * background-media row — its companion key is. Treats a file row and
 * its companion as ONE logical field, which is what makes a song that
 * overrides only `backgroundVideoPath` correctly read as overridden
 * (the original bug: the naive check only ever tested `backgroundImagePath`).
 */
export function isFieldOverridden(def: ThemeFieldDef, override: ThemeOverride): boolean {
  if (def.kind === 'file' && def.companionKey) {
    return override[def.key] !== undefined || override[def.companionKey] !== undefined
  }
  return override[def.key] !== undefined
}

/**
 * The value to DISPLAY for a field, given the effective (merged) theme.
 * For the background-media row this is whichever of image/video is
 * actually set, preferring video since it wins the render priority
 * (see the `Theme` doc comment in shared/types.ts).
 */
export function effectiveDisplayValue(def: ThemeFieldDef, effective: Theme): unknown {
  if (def.kind === 'file' && def.companionKey) {
    return effective[def.companionKey] ?? effective[def.key]
  }
  return effective[def.key]
}

export function fieldPatch(key: keyof ThemeOverride, value: unknown): Partial<Theme> {
  return { [key]: value } as Partial<Theme>
}

export function fieldsPatch(entries: Array<[keyof ThemeOverride, unknown]>): Partial<Theme> {
  const obj: Record<string, unknown> = {}
  for (const [k, v] of entries) obj[k] = v
  return obj as Partial<Theme>
}

/**
 * Apply a real edit (seg/swatch/step/select/file changes) to the current
 * override, returning the NEXT override. Spreads the patch onto the
 * current override, then drops any resulting null/undefined entries —
 * `mergeThemeOverride` treats "field is null in the override" as
 * "inherit", not "force null on the projector" (see its own doc
 * comment), so a cleared media field must fall OUT of the override
 * entirely rather than persist as an explicit null.
 */
export function applyOverridePatch(
  override: ThemeOverride,
  patch: Partial<Theme>
): ThemeOverride {
  const merged: Record<string, unknown> = { ...override, ...patch }
  const cleaned: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(merged)) {
    if (value !== null && value !== undefined) cleaned[key] = value
  }
  return cleaned as ThemeOverride
}

/**
 * REVERT — deletes the key(s) entirely, not just clears them to
 * null/undefined via `applyOverridePatch`'s cleaning. This is the one
 * place a companion key must be well and truly ABSENT from the override
 * afterward, so `isFieldOverridden` reports this field as inherited
 * again (both for the count row and the chip tray).
 */
export function revertField(override: ThemeOverride, def: ThemeFieldDef): ThemeOverride {
  const next: Record<string, unknown> = { ...override }
  delete next[def.key]
  if (def.kind === 'file' && def.companionKey) delete next[def.companionKey]
  return next as ThemeOverride
}

/**
 * Promote an inherited chip — seed the override at its CURRENT EFFECTIVE
 * value, straight onto `override` (NOT through `applyOverridePatch`,
 * which would strip a null value right back out and make a
 * promoted-but-still-empty file field indistinguishable from "never
 * promoted"). Because `effective` is computed from `override` BEFORE
 * this field is added, `effective[key]` here equals whatever the song
 * already showed — so merging the result back on top of `globalTheme`
 * reproduces the exact same effective theme. That equality (asserted in
 * themeOverrideFields.test.ts for every control kind, and separately for
 * the background-media row in all three global-theme states) is the
 * whole point of the chip-promotion interaction: adding a field must
 * never change what the slide looks like.
 */
export function promoteField(
  override: ThemeOverride,
  def: ThemeFieldDef,
  globalTheme: Theme
): ThemeOverride {
  const effective = mergeThemeOverride(globalTheme, override)
  const patch: Record<string, unknown> = { [def.key]: effective[def.key] }
  if (def.kind === 'file' && def.companionKey) {
    patch[def.companionKey] = effective[def.companionKey]
  }
  return { ...override, ...patch } as ThemeOverride
}

/**
 * Route an already-picked file path onto the override, by extension,
 * mirroring `ThemeFields.tsx`'s mutual-clear rule for the two
 * background-media fields exactly: picking a video clears the image key
 * and vice versa. For a file field with no companion (e.g. `logoPath`)
 * this is just a single-key patch.
 */
export function pickField(
  override: ThemeOverride,
  def: ThemeFieldDef & { kind: 'file' },
  pickedPath: string
): ThemeOverride {
  if (def.companionKey) {
    const patch = isVideoPath(pickedPath)
      ? fieldsPatch([
          [def.companionKey, pickedPath],
          [def.key, null]
        ])
      : fieldsPatch([
          [def.key, pickedPath],
          [def.companionKey, null]
        ])
    return applyOverridePatch(override, patch)
  }
  return applyOverridePatch(override, fieldPatch(def.key, pickedPath))
}
