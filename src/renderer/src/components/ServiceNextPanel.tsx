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
