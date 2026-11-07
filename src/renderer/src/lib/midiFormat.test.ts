import { describe, expect, it } from 'vitest'
import { formatMidiMessage } from './midiFormat'

describe('formatMidiMessage', () => {
  it('formats note on', () => {
    expect(formatMidiMessage([0x9f, 72, 100])).toBe('Note On 72 vel 100 ch 16')
  })
  it('formats note off', () => {
    expect(formatMidiMessage([0x8f, 72, 0])).toBe('Note Off 72 ch 16')
  })
  it('treats velocity-0 note on as note off', () => {
    expect(formatMidiMessage([0x90, 60, 0])).toBe('Note Off 60 ch 1')
  })
  it('formats program change', () => {
    expect(formatMidiMessage([0xcf, 2])).toBe('Program 2 ch 16')
  })
  it('formats control change', () => {
    expect(formatMidiMessage([0xb0, 7, 100])).toBe('CC 7 = 100 ch 1')
  })
  it('falls back to hex bytes', () => {
    expect(formatMidiMessage([0xe0, 0, 64])).toBe('E0 00 40')
  })
  it('ignores every system message', () => {
    expect(formatMidiMessage([0xf8])).toBeNull() // clock
    expect(formatMidiMessage([0xfe])).toBeNull() // active sensing
    expect(formatMidiMessage([0xf1, 0x23])).toBeNull() // MTC quarter frame
    expect(formatMidiMessage([0xf2, 0x10, 0x02])).toBeNull() // song position
    for (const b of [0xfa, 0xfb, 0xfc, 0xff]) expect(formatMidiMessage([b])).toBeNull()
    expect(formatMidiMessage([0xf0, 0x7e, 0x7f, 0x06, 0x01, 0xf7])).toBeNull() // sysex
  })
  it('returns null for empty', () => {
    expect(formatMidiMessage([])).toBeNull()
  })
})
