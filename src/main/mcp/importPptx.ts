/**
 * Bring a PowerPoint deck an AI tool hands us into Present's own media.
 *
 * Always a copy, never a reference to the original: AI tools write decks
 * to temp folders and sandboxes that get cleaned up, and a setlist item
 * pointing at a vanished file fails in front of the congregation. Copies
 * live under media/ai-imports/, so they also travel with backups (backup
 * collects media/ recursively).
 */

import { readFile, stat, mkdir } from 'fs/promises'
import { homedir } from 'os'
import { basename, extname, isAbsolute, join } from 'path'
import { randomUUID } from 'crypto'
import { atomicWriteFile } from '../storage/atomic'
import { countVisiblePptxSlides } from './pptxInfo'

/** Largest deck accepted. Photo-heavy sermon decks run 20–80 MB. */
export const MAX_PPTX_BYTES = 100 * 1024 * 1024

export type PptxSource = { path: string } | { base64: string; fileName: string }

export interface ImportedPptx {
  pptxPath: string
  slideCount: number
  /** File name without extension — the default item title. */
  title: string
}

/** A file name safe on every OS, keeping it readable for the operator. */
export function safePptxFileName(name: string): string {
  const stem = basename(name).replace(/\.pptx$/i, '')
  const cleaned = stem
    .replace(/[^\p{L}\p{N} ._()'-]+/gu, '_')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 80)
  return `${cleaned || 'Presentation'}.pptx`
}

function expandHome(p: string): string {
  return p === '~' || p.startsWith('~/') ? join(homedir(), p.slice(1)) : p
}

async function readSource(src: PptxSource): Promise<{ buffer: Buffer; fileName: string }> {
  if ('path' in src) {
    const path = expandHome(src.path.trim())
    if (!isAbsolute(path)) {
      throw new Error(`file_path must be an absolute path to a .pptx file (got "${src.path}").`)
    }
    if (extname(path).toLowerCase() !== '.pptx') {
      throw new Error('Only .pptx files are supported. Save older .ppt files as .pptx first.')
    }
    let size: number
    try {
      const info = await stat(path)
      if (!info.isFile()) throw new Error('not a file')
      size = info.size
    } catch {
      throw new Error(`No file found at ${path}.`)
    }
    if (size > MAX_PPTX_BYTES) {
      throw new Error(`That deck is ${Math.round(size / 1048576)} MB; the limit is 100 MB.`)
    }
    return { buffer: await readFile(path), fileName: basename(path) }
  }

  // Tolerate a data: URL prefix — some tools send one.
  const b64 = src.base64.replace(/^data:[^,]*,/, '').replace(/\s+/g, '')
  if (!b64) throw new Error('file_base64 is empty.')
  const buffer = Buffer.from(b64, 'base64')
  if (buffer.length === 0) throw new Error('file_base64 is not valid base64.')
  if (buffer.length > MAX_PPTX_BYTES) {
    throw new Error(`That deck is ${Math.round(buffer.length / 1048576)} MB; the limit is 100 MB.`)
  }
  return { buffer, fileName: src.fileName }
}

export async function importPptx(src: PptxSource, mediaDir: string): Promise<ImportedPptx> {
  const { buffer, fileName } = await readSource(src)
  // Validate before writing anything: a non-pptx never lands in media/.
  const slideCount = countVisiblePptxSlides(buffer)
  if (slideCount === 0) {
    throw new Error('That deck has no visible slides to show.')
  }

  const safeName = safePptxFileName(fileName)
  const dir = join(mediaDir, 'ai-imports')
  await mkdir(dir, { recursive: true })
  // Short unique prefix: two decks both called "Sermon.pptx" must not
  // overwrite each other — last week's setlist still points at its copy.
  const pptxPath = join(dir, `${randomUUID().slice(0, 8)}-${safeName}`)
  await atomicWriteFile(pptxPath, buffer)

  return { pptxPath, slideCount, title: safeName.replace(/\.pptx$/i, '') }
}
