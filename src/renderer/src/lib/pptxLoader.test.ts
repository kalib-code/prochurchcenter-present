// @vitest-environment jsdom
//
// jsdom, not happy-dom: happy-dom's DOMParser rejects the OOXML declaration
// and returns an empty presentation without throwing, so every assertion
// below would pass against nothing.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parsePptxBuffer } from './pptxLoader'

// Deliberately NOT `buf.buffer.slice(...)`. A Node Buffer's backing
// ArrayBuffer belongs to Node's realm; vitest's jsdom environment runs test
// code in a separate vm-context realm with its own ArrayBuffer constructor.
// JSZip (inside @aiden0z/pptx-renderer) checks `data instanceof ArrayBuffer`
// against the caller's realm, so a cross-realm buffer fails that check with
// "Can't read the data of the loaded zip file" even though the bytes are
// fine. `new Uint8Array(buf)` allocates its backing buffer in the *current*
// (jsdom) realm, so its `.buffer` passes the check.
function fixture(name: string): ArrayBuffer {
  const buf = readFileSync(resolve(__dirname, '../../../shared/__fixtures__', name))
  return new Uint8Array(buf).buffer
}

describe('parsePptxBuffer', () => {
  it('reads 5 visible slides from test-deck.pptx', async () => {
    const deck = await parsePptxBuffer(fixture('test-deck.pptx'))
    expect(deck.slides).toHaveLength(5)
    expect(deck.slides.every((s) => !s.hidden)).toBe(true)
    expect(deck.slides.map((s) => s.sourceIndex)).toEqual([1, 2, 3, 4, 5])
  })

  it('reports 16:9 dimensions', async () => {
    const deck = await parsePptxBuffer(fixture('test-deck.pptx'))
    expect(Math.round(deck.width)).toBe(1280)
    expect(Math.round(deck.height)).toBe(720)
  })

  it('flags only the hidden slide in test-deck-hidden.pptx', async () => {
    const deck = await parsePptxBuffer(fixture('test-deck-hidden.pptx'))
    expect(deck.slides).toHaveLength(7)
    expect(deck.slides.map((s) => s.hidden)).toEqual([
      false, false, false, false, false, true, false
    ])
  })

  it('rejects a file that is not a pptx', async () => {
    await expect(
      parsePptxBuffer(new TextEncoder().encode('not a zip').buffer)
    ).rejects.toThrow()
  })
})

describe('loadPptxDeck caching', () => {
  it('shares one promise across concurrent callers', async () => {
    let fetches = 0
    const original = globalThis.fetch
    globalThis.fetch = (async () => {
      fetches++
      const buf = fixture('test-deck.pptx')
      return new Response(buf, { status: 200 })
    }) as typeof fetch

    try {
      const { loadPptxDeck, evictPptxDeck } = await import('./pptxLoader')
      evictPptxDeck('/tmp/concurrent.pptx')
      const [a, b] = await Promise.all([
        loadPptxDeck('/tmp/concurrent.pptx'),
        loadPptxDeck('/tmp/concurrent.pptx')
      ])
      expect(a).toBe(b)
      expect(fetches).toBe(1)
    } finally {
      globalThis.fetch = original
    }
  })

  it('evicts a rejected parse so a retry re-attempts', async () => {
    let fetches = 0
    const original = globalThis.fetch
    globalThis.fetch = (async () => {
      fetches++
      return new Response(null, { status: 404 })
    }) as typeof fetch

    try {
      const { loadPptxDeck } = await import('./pptxLoader')
      await expect(loadPptxDeck('/tmp/missing.pptx')).rejects.toThrow()
      await expect(loadPptxDeck('/tmp/missing.pptx')).rejects.toThrow()
      expect(fetches).toBe(2)
    } finally {
      globalThis.fetch = original
    }
  })
})
