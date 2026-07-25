/**
 * ServiceNextPanel — "what pressing SPACE will do", live during Service
 * Mode.
 *
 * The design (present-redesign.html) computes `nextTag` / `nextTagFg` /
 * `nextLabel` / `nextText` / `nextHint` at L1044–1048 and calls out
 * "NEXT + RUNWAY" as a headline feature at L1072, but the markup that
 * consumed those props was trimmed from the file — there is no layout
 * to transcribe. This component is rebuilt from that computed logic
 * plus the note, using the design's existing Panel/Badge header shape
 * (see PreflightPanel.tsx for the same title+action split).
 *
 * Presentational only: takes `items`/`itemIndex`/`slideIndex` and
 * derives everything through `resolveNext` (lib/serviceNext.ts), which
 * is the single source of truth for "what SPACE does" shared with the
 * service store's own traversal. Does not subscribe to IPC.
 */

import type { SlidePayload } from '@shared/ipc-contract'
import type { RenderableItem } from '../lib/slideify'
import { resolveNext, type NextResolution } from '../lib/serviceNext'
import { Badge } from './ui/Badge'
import { Panel } from './ui/Card'

interface ServiceNextPanelProps {
  items: RenderableItem[]
  itemIndex: number
  slideIndex: number
}

interface NextDescription {
  tag: string
  tagTone: 'signal' | 'neutral'
  label: string
  previewText: string
  hint: string
}

/**
 * For a `text` slide, the lines joined with newlines (rendered
 * `whitespace-pre-line`). Other kinds render their kind name. A `text`
 * slide with an empty `lines` array is a real case — song intro
 * slides are deliberately blank so the congregation gets a beat on
 * the new background before lyrics appear (see slideify.ts) — so it
 * renders an explicit description rather than an empty box.
 */
function slidePreviewText(slide: SlidePayload): string {
  switch (slide.kind) {
    case 'text':
      return slide.lines.length > 0 ? slide.lines.join('\n') : 'No lyrics — background only'
    case 'image':
      return 'Image'
    case 'video':
      return 'Video'
    case 'pdf-page':
      return `PDF page ${slide.pageIndex}`
    case 'countdown':
      return 'Countdown'
    default: {
      const _never: never = slide
      return _never
    }
  }
}

/** The next slide's section label, falling back to the item's label for slide kinds that don't carry one (image/video/pdf-page/countdown), or a text slide with no sectionLabel set. */
function sectionLabelFor(
  resolution: Extract<NextResolution, { kind: 'same-item' | 'new-item' }>
): string {
  const { slide } = resolution
  if (slide.kind === 'text' && slide.sectionLabel) return slide.sectionLabel
  return resolution.itemLabel
}

function describeNext(resolution: NextResolution): NextDescription {
  if (resolution.kind === 'end') {
    return {
      tag: 'END OF SERVICE',
      tagTone: 'signal',
      label: 'SERVICE ENDS',
      previewText: '—',
      hint: 'Blacks out the projector and ends the service.'
    }
  }

  const label = sectionLabelFor(resolution)
  const previewText = slidePreviewText(resolution.slide)

  if (resolution.kind === 'new-item') {
    return {
      tag: 'NEW ITEM',
      tagTone: 'signal',
      label,
      previewText,
      hint: `Leaves ${resolution.fromItemLabel} and starts ${resolution.itemLabel}.`
    }
  }

  return {
    tag: 'SAME ITEM',
    tagTone: 'neutral',
    label,
    previewText,
    hint: `Stays inside ${resolution.itemLabel}.`
  }
}

export function ServiceNextPanel({
  items,
  itemIndex,
  slideIndex
}: ServiceNextPanelProps): JSX.Element {
  const resolution = resolveNext(items, itemIndex, slideIndex)
  const { tag, tagTone, label, previewText, hint } = describeNext(resolution)

  return (
    <Panel title="NEXT" action={<Badge tone={tagTone}>{tag}</Badge>}>
      <div className="space-y-2 px-4 py-3.5">
        <div className="text-[12.5px] font-semibold text-bone">{label}</div>
        <div className="whitespace-pre-line text-[12px] leading-[1.5] text-soft">
          {previewText}
        </div>
        <div className="text-[11px] text-dim">{hint}</div>
      </div>
    </Panel>
  )
}
