/**
 * mergeThemeOverride — combine a base Theme with a partial override.
 *
 * The semantic of an override is "fields the user explicitly customized
 * for this song / item". A field that is `null` or `undefined` in the
 * override means "inherit from the base", NOT "force this field to null".
 *
 * Why this matters:
 *   The naive merge `{ ...base, ...override }` clobbers base fields with
 *   null overrides, which silently destroys global background images,
 *   background videos, and logo paths whenever a user clicks "clear" on
 *   a media row inside the per-song theme override editor. The user
 *   intent of "clear" is "I don't want this row to override anything",
 *   not "force null on the projector".
 *
 *   Filtering nulls + undefineds before the spread restores the
 *   inheritance semantic.
 *
 * id and name on the base Theme are always preserved — overrides
 * cannot rename a theme.
 */

import type { Theme, ThemeOverride } from '@shared/types'

export function mergeThemeOverride(
  base: Theme,
  override: ThemeOverride | null | undefined
): Theme {
  if (!override) return base

  const cleaned: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(override)) {
    if (value !== null && value !== undefined) {
      cleaned[key] = value
    }
  }

  return {
    ...base,
    ...(cleaned as Partial<Theme>),
    id: base.id,
    name: base.name
  }
}
