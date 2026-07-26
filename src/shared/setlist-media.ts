/**
 * The filesystem path a setlist item depends on, or null for items that
 * depend on none (songs, scripture, countdowns, section dividers).
 *
 * Shared because both the main-process pre-flight check and the renderer's
 * MEDIA MISSING banner need exactly this mapping, and a second copy would
 * drift the moment a new item kind lands.
 *
 * The `if`-chain fails OPEN: a new path-carrying kind added without a
 * branch here returns null and silently reports as fine — the exact
 * failure pre-flight exists to prevent. `setlist-media.test.ts` guards
 * that with a mapped type over `SetlistItem['kind']`, so a missing kind
 * breaks the build rather than the Sunday service. That guard is what
 * caught `pptx` when live PowerPoint projection merged in.
 */

import type { SetlistItem } from './types'
import type { PickFileKind } from './ipc-contract'

export function mediaPathOf(item: SetlistItem): string | null {
  if (item.kind === 'image') return item.imagePath || null
  if (item.kind === 'video') return item.videoPath || null
  if (item.kind === 'deck') return item.pdfPath || null
  if (item.kind === 'pptx') return item.pptxPath || null
  return null
}

/** The PickFileKind to reopen for a RELINK on this item, or null. */
export function relinkKindOf(item: SetlistItem): PickFileKind | null {
  if (item.kind === 'image') return 'image'
  if (item.kind === 'video') return 'video'
  if (item.kind === 'deck') return 'pdf'
  // .pptx only — the live renderer parses Office Open XML, so a relink
  // must not offer legacy binary .ppt any more than the add flow does.
  if (item.kind === 'pptx') return 'pptx'
  return null
}
