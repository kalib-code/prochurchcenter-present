/**
 * ItemKindIcon — the canonical visual vocabulary for every kind of
 * setlist item. Centralizing this here means the setlist editor, the
 * home page preview, and the add-item picker all share the same glyph
 * for "song" / "scripture" / "image" / etc, so the operator builds
 * muscle memory: a musical-note always means song, a document always
 * means scripture, and so on.
 *
 * Line-style 1.5px SVGs sized by a single `size` prop (default 20).
 * `color` defaults to currentColor so the caller can tint via parent
 * text color — matches how Tailwind's `text-foreground` / `text-brand`
 * utilities are already being used elsewhere.
 */

import type { SetlistItem } from '@shared/types'

/**
 * Setlist item kinds, plus 'canva' — which is an import *source* rather
 * than an item kind (a Canva import becomes a `deck`). It lives here
 * anyway because this file exists to be the single glyph vocabulary, and
 * splintering a second icon source into AddItemPicker costs more than
 * one union member.
 */
type Kind = SetlistItem['kind'] | 'canva'

interface Props {
  kind: Kind
  size?: number
  className?: string
}

export function ItemKindIcon({ kind, size = 20, className }: Props): JSX.Element {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className
  }

  switch (kind) {
    case 'song':
      // Musical note — filled head, stem with a single flag.
      return (
        <svg {...common}>
          <path d="M9 18V6l10-2v12" />
          <circle cx="6" cy="18" r="3" fill="currentColor" />
          <circle cx="16" cy="16" r="3" fill="currentColor" />
        </svg>
      )
    case 'scripture':
      // Open book silhouette.
      return (
        <svg {...common}>
          <path d="M4 5a2 2 0 0 1 2-2h5v17H6a2 2 0 0 0-2 2V5Z" />
          <path d="M20 5a2 2 0 0 0-2-2h-5v17h5a2 2 0 0 1 2 2V5Z" />
        </svg>
      )
    case 'image':
      // Mountain + sun in frame.
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <circle cx="9" cy="10" r="1.5" />
          <path d="m21 16-5-5-8 8" />
        </svg>
      )
    case 'video':
      // Play triangle inside rounded rect.
      return (
        <svg {...common}>
          <rect x="2" y="5" width="20" height="14" rx="3" />
          <path d="M10 9.5v5l4-2.5z" fill="currentColor" stroke="none" />
        </svg>
      )
    case 'deck':
      // Stacked-pages / document with fold.
      return (
        <svg {...common}>
          <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6" />
          <path d="M9 13h6M9 17h4" />
        </svg>
      )
    case 'countdown':
      // Clock face.
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      )
    case 'section-divider':
      // Horizontal rule with a hinge dot — grouping marker.
      return (
        <svg {...common}>
          <path d="M4 12h6M14 12h6" />
          <circle cx="12" cy="12" r="1.5" fill="currentColor" />
        </svg>
      )
    case 'pptx':
      // Reuses the PDF deck glyph for now — a dedicated PowerPoint icon
      // (distinct from the PDF deck icon above) is still wanted, but
      // hasn't been designed yet.
      return (
        <svg {...common}>
          <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6" />
          <path d="M9 13h6M9 17h4" />
        </svg>
      )
    case 'canva':
      // Canva's mark is trademarked, so this is a neutral "design
      // document" glyph rather than an imitation of their logo.
      return (
        <svg {...common}>
          <rect x="3" y="3" width="18" height="18" rx="4" />
          <circle cx="12" cy="12" r="4" />
        </svg>
      )
    default: {
      const _exhaustive: never = kind
      return <>{_exhaustive}</>
    }
  }
}

/**
 * Human-readable label for each item kind. Kept next to the icon so
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
    case 'pptx':
      return 'PowerPoint'
    case 'canva':
      return 'Canva'
  }
}
