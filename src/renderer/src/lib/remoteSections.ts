import { shortcutFromLabel } from '@shared/sectionShortcut'
import type { RenderableItem } from './slideify'

const isEmpty = (s: RenderableItem['slides'][number]): boolean =>
  s.kind === 'text' && s.lines.length === 0

/** Text slides carry the section label; other slide kinds never match. */
const labelOf = (s: RenderableItem['slides'][number]): string | null =>
  s.kind === 'text' ? (s.sectionLabel ?? '') : null

/**
 * Start index of the section run matching `key` that a "go to section" cue
 * should land on: the first matching run starting after `currentSlide`,
 * wrapping to the first matching run. A run is a maximal stretch of
 * consecutive slides sharing a sectionLabel; its start skips empty-lyric
 * slides (the Intro transition) when the run has lyrics. Null if no match.
 */
export function findSectionStart(
  item: RenderableItem,
  currentSlide: number,
  key: string
): number | null {
  const starts: number[] = []
  const slides = item.slides
  let i = 0
  while (i < slides.length) {
    const label = labelOf(slides[i])
    let end = i + 1
    while (end < slides.length && labelOf(slides[end]) === label) end++
    if (label !== null && shortcutFromLabel(label) === key) {
      let start = i
      for (let j = i; j < end; j++) {
        if (!isEmpty(slides[j])) { start = j; break }
      }
      starts.push(start)
    }
    i = end
  }
  if (starts.length === 0) return null
  return starts.find((s) => s > currentSlide) ?? starts[0]
}
