/**
 * ItemKindIcon — canonical text vocabulary for every kind of setlist
 * item: `itemKindLabel` (human-readable) and `itemKindCode` (3-letter
 * mono Badge code). Centralizing these here means the setlist editor,
 * the home page preview, and the add-item picker all agree on the same
 * label and code for "song" / "scripture" / "image" / etc — a countdown
 * reads CDN everywhere, never CDN in one place and CNT in another.
 *
 * The module used to also export an `ItemKindIcon` SVG glyph component,
 * but every JSX call site was replaced by a mono Badge showing
 * `itemKindCode` instead — the glyphs had zero remaining consumers and
 * were removed.
 */

import type { SetlistItem } from '@shared/types'

type Kind = SetlistItem['kind']

/**
 * Human-readable label for each item kind. Kept next to the code so
 * every caller — picker, home preview, list card — uses the same
 * capitalization and wording.
 */
export function itemKindLabel(kind: Kind): string {
  switch (kind) {
    case 'song':
      return 'Song'
    case 'scripture':
      return 'Scripture'
    case 'image':
      return 'Image'
    case 'video':
      return 'Video'
    case 'deck':
      return 'PDF deck'
    case 'countdown':
      return 'Countdown'
    case 'section-divider':
      return 'Section'
  }
}

/**
 * Three-letter mono code shown on kind Badges in the setlist editor —
 * the add-item grid and every item row's own kind chip. Matches the
 * KLB design file exactly (SNG / SCR / IMG / VID / PDF / CDN / SEC).
 */
export function itemKindCode(kind: Kind): string {
  switch (kind) {
    case 'song':
      return 'SNG'
    case 'scripture':
      return 'SCR'
    case 'image':
      return 'IMG'
    case 'video':
      return 'VID'
    case 'deck':
      return 'PDF'
    case 'countdown':
      return 'CDN'
    case 'section-divider':
      return 'SEC'
  }
}
