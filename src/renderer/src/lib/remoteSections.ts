import { sectionKey, sectionLabelKey } from '@shared/remote'
import { shortcutFromLabel } from '@shared/sectionShortcut'
import type { RenderableItem } from './slideify'

const isEmpty = (s: RenderableItem['slides'][number]): boolean =>
  s.kind === 'text' && s.lines.length === 0

/** Text slides carry the section label; other slide kinds never match. */
const labelOf = (s: RenderableItem['slides'][number]): string | null =>
  s.kind === 'text' ? (s.sectionLabel ?? '') : null

/**
 * Start index of the section run a "go to section" cue should land on: the
 * first matching run starting after `currentSlide`, wrapping to the first
 * matching run. A run is a maximal stretch of consecutive slides sharing a
 * sectionLabel; its start skips empty-lyric slides (the Intro transition)
 * when the run has lyrics. Null if no run matches.
 *
 * Matching, in order:
 *  1. runs whose label equals the cue exactly (see sectionLabelKey), so
 *     "Interlude" lands on an "Interlude" run and "Intro" prefers "Intro";
 *  2. only when the cue is a standard name or a single character
 *     (sectionKey), runs with the same Service Mode shortcut key;
 *  3. otherwise nothing: an unknown name like "Coda" never moves.
 */
export function findSectionStart(
  item: RenderableItem,
  currentSlide: number,
  cue: string
): number | null {
  const runs: { start: number; label: string }[] = []
  const slides = item.slides
  let i = 0
  while (i < slides.length) {
    const label = labelOf(slides[i])
    let end = i + 1
    while (end < slides.length && labelOf(slides[end]) === label) end++
    if (label !== null) {
      let start = i
      for (let j = i; j < end; j++) {
        if (!isEmpty(slides[j])) { start = j; break }
      }
      runs.push({ start, label })
    }
    i = end
  }

  const wanted = sectionLabelKey(cue)
  let matches = wanted ? runs.filter((r) => sectionLabelKey(r.label) === wanted) : []
  if (matches.length === 0) {
    const key = sectionKey(cue)
    matches = key ? runs.filter((r) => shortcutFromLabel(r.label) === key) : []
  }
  const starts = matches.map((r) => r.start)
  if (starts.length === 0) return null
  return starts.find((s) => s > currentSlide) ?? starts[0]
}
