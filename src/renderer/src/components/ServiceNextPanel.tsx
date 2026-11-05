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
 *
 * The actual tag/label/hint COPY is computed by lib/serviceNextText.ts
 * — pulled out so those pure functions get real test coverage (a
 * component file under components/ is invisible to vitest's include
 * glob; see that module's doc comment).
 */

import { resolveNext } from '../lib/serviceNext'
import { describeNext } from '../lib/serviceNextText'
import type { RenderableItem } from '../lib/slideify'
import { Badge } from './ui/Badge'
import { Panel } from './ui/Card'

interface ServiceNextPanelProps {
  items: RenderableItem[]
  itemIndex: number
  slideIndex: number
}

/**
 * Presentation of describeNext()'s copy. That module's strings are
 * pinned by serviceNextText.test.ts (and shared with other surfaces) and
 * still carry the old all-caps tags, so the sentence-case wording and
 * the tone live here, keyed on the resolution kind rather than on the
 * text: a "new item" is the operator's cursor moving (accent); the end
 * of the service needs attention (amber); same item is neutral. Red is
 * reserved for on-air, so it is never used here.
 */
const TAG_BY_KIND = {
  'same-item': { tag: 'Same item', tone: 'neutral' },
  'new-item': { tag: 'New item', tone: 'accent' },
  end: { tag: 'End of service', tone: 'warn' }
} as const

export function ServiceNextPanel({
  items,
  itemIndex,
  slideIndex
}: ServiceNextPanelProps): JSX.Element {
  const resolution = resolveNext(items, itemIndex, slideIndex)
  const { label, previewText, hint } = describeNext(resolution)
  const { tag, tone } = TAG_BY_KIND[resolution.kind]
  const isEnd = resolution.kind === 'end'

  return (
    <Panel title="Next" action={<Badge tone={tone}>{tag}</Badge>}>
      <div className="space-y-1.5 px-4 py-3">
        <div className="truncate text-[14px] font-semibold text-foreground">
          {isEnd ? 'Service ends' : label}
        </div>
        {!isEnd && (
          <div className="whitespace-pre-line text-[13px] leading-[1.5] text-soft">
            {previewText}
          </div>
        )}
        <div className="text-[12px] text-muted-foreground">{hint}</div>
      </div>
    </Panel>
  )
}
