/**
 * The filesystem path a setlist item depends on, or null for items that
 * depend on none (songs, scripture, countdowns, section dividers).
 *
 * Shared because both the main-process pre-flight check and the renderer's
 * MEDIA MISSING banner need exactly this mapping, and a second copy would
 * drift the moment a new item kind lands.
 */

import type { SetlistItem } from './types'

export function mediaPathOf(item: SetlistItem): string | null {
  if (item.kind === 'image') return item.imagePath || null
  if (item.kind === 'video') return item.videoPath || null
  if (item.kind === 'deck') return item.pdfPath || null
  return null
}

/** The PickFileKind to reopen for a RELINK on this item, or null. */
export function relinkKindOf(item: SetlistItem): 'image' | 'video' | 'pdf' | null {
  if (item.kind === 'image') return 'image'
  if (item.kind === 'video') return 'video'
  if (item.kind === 'deck') return 'pdf'
  return null
}
