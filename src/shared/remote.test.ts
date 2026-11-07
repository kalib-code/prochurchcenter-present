import { describe, expect, it } from 'vitest'
import {
  describeCommand,
  isIPv4,
  midiToCommand,
  oscToCommand,
  parseRemoteCommand,
  sectionKey,
  sectionLabelKey,
  type RemoteCommand
} from './remote'

describe('parseRemoteCommand', () => {
  it('accepts every command shape', () => {
    for (const type of ['next', 'prev', 'nextItem', 'prevItem', 'black', 'logo', 'live', 'status']) {
      expect(parseRemoteCommand({ type })).toEqual({ type })
    }
    expect(parseRemoteCommand({ type: 'goToItem', number: 3 })).toEqual({ type: 'goToItem', number: 3 })
    expect(parseRemoteCommand({ type: 'goToSection', section: 'Chorus' })).toEqual({
      type: 'goToSection',
      section: 'Chorus'
    })
  })
  it('rejects invalid input', () => {
    expect(parseRemoteCommand({ type: 'explode' })).toBeNull()
    for (const number of [0, -1, 1.5, '3']) {
      expect(parseRemoteCommand({ type: 'goToItem', number })).toBeNull()
    }
    expect(parseRemoteCommand({ type: 'goToSection', section: '' })).toBeNull()
    expect(parseRemoteCommand({ type: 'goToSection', section: '   ' })).toBeNull()
    expect(parseRemoteCommand({ type: 'goToSection', section: 'x'.repeat(41) })).toBeNull()
    expect(parseRemoteCommand({ type: 'goToSection' })).toBeNull()
    for (const type of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(parseRemoteCommand({ type })).toBeNull()
    }
    for (const raw of [null, undefined, 'next', 5, []]) expect(parseRemoteCommand(raw)).toBeNull()
  })
  it('trims section and allows 40 chars', () => {
    expect(parseRemoteCommand({ type: 'goToSection', section: '  Bridge ' })).toEqual({
      type: 'goToSection',
      section: 'Bridge'
    })
    expect(parseRemoteCommand({ type: 'goToSection', section: 'x'.repeat(40) })).not.toBeNull()
  })
})

describe('sectionKey', () => {
  it('normalizes section names', () => {
    expect(sectionKey('Chorus')).toBe('C')
    expect(sectionKey('chorus 2')).toBe('C')
    expect(sectionKey('C')).toBe('C')
    expect(sectionKey('v2')).toBe('2')
    expect(sectionKey('Verse 2')).toBe('2')
    expect(sectionKey(' verse  2 ')).toBe('2')
    expect(sectionKey('2')).toBe('2')
    expect(sectionKey('Pre-Chorus')).toBe('P')
    expect(sectionKey('Verse 02')).toBe('2')
    expect(sectionKey('')).toBeNull()
  })
  it('knows the standard names, with or without a trailing number', () => {
    expect(sectionKey('prechorus')).toBe('P')
    expect(sectionKey('pre_chorus')).toBe('P')
    expect(sectionKey('P')).toBe('P')
    expect(sectionKey('Bridge 2')).toBe('B')
    expect(sectionKey('intro')).toBe('I')
    expect(sectionKey('Outro')).toBe('O')
    expect(sectionKey('tag')).toBe('T')
    expect(sectionKey('verse')).toBeNull()
    expect(sectionKey('V 3')).toBe('3')
  })
  it('a single character is a shortcut key', () => {
    expect(sectionKey('x')).toBe('X')
  })
  it('unknown names have no shortcut key (no first-letter fallback)', () => {
    for (const s of ['Coda', 'Channel', 'Breakdown', 'Instrumental', 'Interlude', 'Turnaround', 'Post-Chorus', 'Vamp']) {
      expect(sectionKey(s)).toBeNull()
    }
  })
})

describe('sectionLabelKey', () => {
  it('normalizes case, spaces, hyphens and underscores', () => {
    expect(sectionLabelKey('  Post-Chorus ')).toBe('post chorus')
    expect(sectionLabelKey('post__chorus')).toBe('post chorus')
    expect(sectionLabelKey('Post - Chorus')).toBe('post chorus')
  })
  it('drops a trailing number for non-verse names', () => {
    expect(sectionLabelKey('Chorus 2')).toBe('chorus')
    expect(sectionLabelKey('Interlude2')).toBe('interlude')
  })
  it('keeps the verse number, without leading zeros', () => {
    expect(sectionLabelKey('Verse 02')).toBe('verse 2')
    expect(sectionLabelKey('v2')).toBe('verse 2')
    expect(sectionLabelKey('2')).toBe('verse 2')
  })
  it('is empty for empty input', () => {
    expect(sectionLabelKey('  ')).toBe('')
  })
})

describe('midiToCommand', () => {
  it('maps notes and program changes', () => {
    expect(midiToCommand([0x9f, 60, 100], 16)).toEqual({ type: 'next' })
    expect(midiToCommand([0x9f, 72, 1], 16)).toEqual({ type: 'goToSection', section: 'Chorus' })
    expect(midiToCommand([0x9f, 81, 90], 16)).toEqual({ type: 'goToSection', section: 'Verse 2' })
    expect(midiToCommand([0xcf, 2], 16)).toEqual({ type: 'goToItem', number: 3 })
  })
  it('ignores everything else', () => {
    expect(midiToCommand([0x9f, 60, 0], 16)).toBeNull()
    expect(midiToCommand([0x90, 60, 100], 16)).toBeNull()
    expect(midiToCommand([0x8f, 60, 100], 16)).toBeNull()
    expect(midiToCommand([0x9f, 67, 100], 16)).toBeNull()
  })
})

describe('oscToCommand', () => {
  it('maps addresses', () => {
    expect(oscToCommand('/present/next', [])).toEqual({ type: 'next' })
    expect(oscToCommand('/present/next', [1])).toEqual({ type: 'next' })
    expect(oscToCommand('/present/next', [0])).toBeNull()
    expect(oscToCommand('/present/next', [false])).toBeNull()
    expect(oscToCommand('/present/black', [false])).toBeNull()
    expect(oscToCommand('/present/next', [true])).toEqual({ type: 'next' })
    expect(oscToCommand('/present/item', [3])).toEqual({ type: 'goToItem', number: 3 })
    expect(oscToCommand('/present/item', [3.0])).toEqual({ type: 'goToItem', number: 3 })
    expect(oscToCommand('/present/item', [2.5])).toBeNull()
    expect(oscToCommand('/present/section', ['bridge'])).toEqual({ type: 'goToSection', section: 'bridge' })
    expect(oscToCommand('/present/section', [])).toBeNull()
    expect(oscToCommand('/other', [])).toBeNull()
    for (const a of ['constructor', '__proto__', 'toString']) expect(oscToCommand(a, [])).toBeNull()
  })
})

describe('describeCommand', () => {
  it('describes each type', () => {
    const cases: [RemoteCommand, string][] = [
      [{ type: 'next' }, 'Next slide'],
      [{ type: 'prev' }, 'Previous slide'],
      [{ type: 'nextItem' }, 'Next song'],
      [{ type: 'prevItem' }, 'Previous song'],
      [{ type: 'goToItem', number: 3 }, 'Go to song 3'],
      [{ type: 'goToSection', section: 'Chorus' }, 'Go to Chorus'],
      [{ type: 'black' }, 'Black screen'],
      [{ type: 'logo' }, 'Logo screen'],
      [{ type: 'live' }, 'Go live'],
      [{ type: 'status' }, 'Status request']
    ]
    for (const [cmd, text] of cases) expect(describeCommand(cmd)).toBe(text)
  })
})

describe('isIPv4', () => {
  it('accepts canonical addresses', () => {
    for (const a of ['0.0.0.0', '10.0.0.1', '192.168.1.20', '255.255.255.255']) {
      expect(isIPv4(a)).toBe(true)
    }
  })
  it('rejects leading-zero octets', () => {
    for (const a of ['01.2.3.4', '192.168.001.020', '1.2.3.04']) expect(isIPv4(a)).toBe(false)
  })
  it('rejects malformed input', () => {
    for (const a of ['', '1.2.3', '1.2.3.4.5', '256.1.1.1', 'a.b.c.d', '1.2.3.-4']) {
      expect(isIPv4(a)).toBe(false)
    }
  })
})
