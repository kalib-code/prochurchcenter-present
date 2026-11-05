import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import AdmZip from 'adm-zip'
import { countVisiblePptxSlides, InvalidPptxError, readPptxSlides } from './pptxInfo'

function fixture(name: string): Buffer {
  return readFileSync(resolve(__dirname, '../../shared/__fixtures__', name))
}

describe('readPptxSlides', () => {
  it('counts every visible slide in a plain deck', () => {
    expect(countVisiblePptxSlides(fixture('test-deck.pptx'))).toBe(5)
  })

  it('skips hidden slides, matching what PowerPoint presents', () => {
    const slides = readPptxSlides(fixture('test-deck-hidden.pptx'))
    expect(slides).toHaveLength(7)
    expect(slides[5].hidden).toBe(true)
    expect(countVisiblePptxSlides(fixture('test-deck-hidden.pptx'))).toBe(6)
  })

  it('follows presentation order, not slide file names', () => {
    const zip = new AdmZip()
    zip.addFile(
      'ppt/presentation.xml',
      Buffer.from(
        '<p:presentation><p:sldIdLst><p:sldId id="257" r:id="rId3"/><p:sldId id="256" r:id="rId2"/></p:sldIdLst></p:presentation>'
      )
    )
    zip.addFile(
      'ppt/_rels/presentation.xml.rels',
      Buffer.from(
        '<Relationships><Relationship Id="rId2" Target="slides/slide1.xml"/><Relationship Id="rId3" Target="slides/slide2.xml"/></Relationships>'
      )
    )
    zip.addFile('ppt/slides/slide1.xml', Buffer.from('<p:sld show="0"></p:sld>'))
    zip.addFile('ppt/slides/slide2.xml', Buffer.from('<p:sld></p:sld>'))
    // slide2 comes first in the show and is visible; slide1 is second and hidden.
    expect(readPptxSlides(zip.toBuffer())).toEqual([
      { sourceIndex: 1, hidden: false },
      { sourceIndex: 2, hidden: true }
    ])
  })

  it('rejects files that are not .pptx', () => {
    expect(() => readPptxSlides(Buffer.from('not a zip'))).toThrow(InvalidPptxError)
    const zip = new AdmZip()
    zip.addFile('word/document.xml', Buffer.from('<w:document/>'))
    expect(() => readPptxSlides(zip.toBuffer())).toThrow(InvalidPptxError)
  })
})
