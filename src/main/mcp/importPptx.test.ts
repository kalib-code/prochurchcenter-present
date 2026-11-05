import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, readdirSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { importPptx, safePptxFileName } from './importPptx'

const FIXTURE = resolve(__dirname, '../../shared/__fixtures__/test-deck-hidden.pptx')

let media: string
beforeEach(() => {
  media = mkdtempSync(join(tmpdir(), 'present-mcp-'))
})
afterEach(() => rmSync(media, { recursive: true, force: true }))

describe('importPptx', () => {
  it('copies a deck from a path into media/ai-imports and counts visible slides', async () => {
    const result = await importPptx({ path: FIXTURE }, media)
    expect(result.slideCount).toBe(6)
    expect(result.title).toBe('test-deck-hidden')
    expect(result.pptxPath.startsWith(join(media, 'ai-imports'))).toBe(true)
    expect(readFileSync(result.pptxPath).equals(readFileSync(FIXTURE))).toBe(true)
  })

  it('accepts base64 content, with or without a data: prefix', async () => {
    const b64 = readFileSync(FIXTURE).toString('base64')
    const a = await importPptx({ base64: b64, fileName: 'Sermon.pptx' }, media)
    const b = await importPptx(
      { base64: `data:application/vnd.openxmlformats;base64,${b64}`, fileName: 'Sermon.pptx' },
      media
    )
    expect(a.slideCount).toBe(6)
    expect(a.title).toBe('Sermon')
    // Same name twice must not overwrite the first copy.
    expect(a.pptxPath).not.toBe(b.pptxPath)
    expect(existsSync(a.pptxPath) && existsSync(b.pptxPath)).toBe(true)
  })

  it('refuses relative paths, other file types, and missing files', async () => {
    await expect(importPptx({ path: 'deck.pptx' }, media)).rejects.toThrow(/absolute/)
    await expect(importPptx({ path: '/tmp/notes.docx' }, media)).rejects.toThrow(/\.pptx/)
    await expect(importPptx({ path: join(media, 'nope.pptx') }, media)).rejects.toThrow(
      /No file found/
    )
  })

  it('writes nothing when the content is not a real deck', async () => {
    const fake = join(media, 'fake.pptx')
    writeFileSync(fake, 'hello')
    await expect(importPptx({ path: fake }, media)).rejects.toThrow(/PowerPoint/)
    expect(existsSync(join(media, 'ai-imports')) ? readdirSync(join(media, 'ai-imports')) : []).toEqual(
      []
    )
  })
})

describe('safePptxFileName', () => {
  it('keeps readable names and strips path tricks', () => {
    expect(safePptxFileName('Grace Abounds (Part 2).pptx')).toBe('Grace Abounds (Part 2).pptx')
    expect(safePptxFileName('../../etc/passwd')).toBe('passwd.pptx')
    expect(safePptxFileName('a/b:c*?.PPTX')).toBe('b_c_.pptx')
    expect(safePptxFileName('...')).toBe('Presentation.pptx')
    expect(safePptxFileName('Pagpapala ñ.pptx')).toBe('Pagpapala ñ.pptx')
  })
})
