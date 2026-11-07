const hex = (b: number): string => b.toString(16).toUpperCase().padStart(2, '0')

/**
 * Human-readable summary of a raw MIDI message for the monitor. Null for
 * every system message (status >= 0xF0: clock, MTC, transport, active
 * sensing, sysex): none of them are cues and some arrive ~100/s.
 */
export function formatMidiMessage(data: ArrayLike<number>): string | null {
  if (data.length === 0) return null
  const status = data[0]
  if (status >= 0xf0) return null
  const ch = (status & 0x0f) + 1
  const d1 = data[1]
  const d2 = data[2]
  switch (status & 0xf0) {
    case 0x90:
      if (data.length >= 3) return d2 > 0 ? `Note On ${d1} vel ${d2} ch ${ch}` : `Note Off ${d1} ch ${ch}`
      break
    case 0x80:
      if (data.length >= 2) return `Note Off ${d1} ch ${ch}`
      break
    case 0xc0:
      if (data.length >= 2) return `Program ${d1} ch ${ch}`
      break
    case 0xb0:
      if (data.length >= 3) return `CC ${d1} = ${d2} ch ${ch}`
      break
  }
  return Array.from(data, hex).join(' ')
}
