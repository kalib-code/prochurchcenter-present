/**
 * Read a .pptx's slide list in the main process — no DOM needed.
 *
 * The renderer counts slides with @aiden0z/pptx-renderer, which needs
 * DOMParser and so can't run here. Decks an AI sends over MCP arrive in
 * main, and slideify needs `slideCount` stamped on the item at add time,
 * so this reads just the three parts that decide it:
 *
 *   ppt/presentation.xml           <p:sldIdLst> — slide ORDER, by r:id
 *   ppt/_rels/presentation.xml.rels  r:id → slide part path
 *   ppt/slides/slideN.xml          root <p:sld show="0"> marks a hidden slide
 *
 * Order matters: file names (slide1.xml, slide2.xml…) are NOT the
 * presentation order once slides have been reordered in PowerPoint. The
 * sldIdLst is. Counting must match the renderer's, or slideify fans out
 * the wrong number of slides; see shared/pptxSlides.ts.
 */

import AdmZip from 'adm-zip'
import { posix } from 'path'
import { visibleSlideCount, type PptxSlideMeta } from '@shared/pptxSlides'

export class InvalidPptxError extends Error {}

function readEntry(zip: AdmZip, name: string): string | null {
  const entry = zip.getEntry(name)
  return entry ? entry.getData().toString('utf8') : null
}

/**
 * Attribute value from a single tag's source text.
 *
 * `prefixed` matches `<anyPrefix>:name` only. It exists for <p:sldId>,
 * which carries BOTH a bare `id="256"` (a numeric slide id) and the
 * `r:id="rId2"` relationship we need. The prefix is usually `r` but is
 * declared per document, so any prefix is accepted.
 */
function attr(tag: string, name: string, prefixed = false): string | null {
  const prefix = prefixed ? '[\\w-]+:' : ''
  const m = new RegExp(`\\s${prefix}${name}\\s*=\\s*"([^"]*)"`).exec(tag)
  return m ? m[1] : null
}

export function readPptxSlides(buffer: Buffer): PptxSlideMeta[] {
  let zip: AdmZip
  try {
    zip = new AdmZip(buffer)
  } catch {
    throw new InvalidPptxError('This file is not a PowerPoint (.pptx) file.')
  }

  const presentation = readEntry(zip, 'ppt/presentation.xml')
  const rels = readEntry(zip, 'ppt/_rels/presentation.xml.rels')
  if (!presentation || !rels) {
    throw new InvalidPptxError(
      'This file is not a PowerPoint (.pptx) file. Older .ppt files must be re-saved as .pptx.'
    )
  }

  const targets = new Map<string, string>()
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], 'Id')
    const target = attr(m[0], 'Target')
    if (id && target) targets.set(id, target)
  }

  const list = /<p:sldIdLst\b[^>]*>([\s\S]*?)<\/p:sldIdLst>/.exec(presentation)
  const slides: PptxSlideMeta[] = []
  if (!list) return slides

  for (const m of list[1].matchAll(/<p:sldId\b[^>]*>/g)) {
    const rid = attr(m[0], 'id', true)
    const target = rid ? targets.get(rid) : undefined
    if (!target) continue
    // Targets are relative to ppt/ ("slides/slide1.xml"); an absolute
    // target ("/ppt/slides/slide1.xml") is legal OOXML too.
    const part = target.startsWith('/')
      ? target.slice(1)
      : posix.normalize(posix.join('ppt', target))
    const xml = readEntry(zip, part)
    if (xml === null) continue
    const root = /<p:sld\b[^>]*>/.exec(xml)
    const show = root ? attr(root[0], 'show') : null
    slides.push({
      sourceIndex: slides.length + 1,
      hidden: show === '0' || show === 'false'
    })
  }
  return slides
}

/** Slides an operator can actually project (hidden ones skipped). */
export function countVisiblePptxSlides(buffer: Buffer): number {
  return visibleSlideCount(readPptxSlides(buffer))
}
