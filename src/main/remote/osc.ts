import type { OscArg } from '@shared/remote'

export interface OscMessage {
  address: string
  args: OscArg[]
}

const MAX_BUNDLE_DEPTH = 4

class Malformed extends Error {}

/** Reads a NUL-terminated string padded to a 4-byte boundary. */
function readString(buf: Buffer, pos: number): { value: string; next: number } {
  const end = buf.indexOf(0, pos)
  if (end < 0) throw new Malformed()
  const next = pos + Math.ceil((end - pos + 1) / 4) * 4
  if (next > buf.length) throw new Malformed()
  return { value: buf.toString('utf8', pos, end), next }
}

function decodeMessage(buf: Buffer): OscMessage {
  const addr = readString(buf, 0)
  if (!addr.value.startsWith('/')) throw new Malformed()
  let pos = addr.next
  const args: OscArg[] = []
  if (pos >= buf.length) return { address: addr.value, args }
  const tags = readString(buf, pos)
  if (!tags.value.startsWith(',')) throw new Malformed()
  pos = tags.next
  for (const tag of tags.value.slice(1)) {
    switch (tag) {
      case 'i':
        if (pos + 4 > buf.length) throw new Malformed()
        args.push(buf.readInt32BE(pos))
        pos += 4
        break
      case 'f':
        if (pos + 4 > buf.length) throw new Malformed()
        args.push(buf.readFloatBE(pos))
        pos += 4
        break
      case 's': {
        const s = readString(buf, pos)
        args.push(s.value)
        pos = s.next
        break
      }
      case 'T':
        args.push(true)
        break
      case 'F':
        args.push(false)
        break
      default:
        throw new Malformed()
    }
  }
  return { address: addr.value, args }
}

function decode(buf: Buffer, depth: number, out: OscMessage[]): void {
  if (buf.length >= 8 && buf.toString('latin1', 0, 8) === '#bundle\0') {
    if (depth >= MAX_BUNDLE_DEPTH) throw new Malformed()
    let pos = 16 // header + 8-byte timetag (ignored)
    if (pos > buf.length) throw new Malformed()
    while (pos < buf.length) {
      if (pos + 4 > buf.length) throw new Malformed()
      const size = buf.readInt32BE(pos)
      pos += 4
      if (size < 0 || pos + size > buf.length) throw new Malformed()
      decode(buf.subarray(pos, pos + size), depth + 1, out)
      pos += size
    }
    return
  }
  out.push(decodeMessage(buf))
}

/** Decodes a UDP datagram into a flat list of OSC messages. Never throws; malformed input yields []. */
export function decodeOscPacket(buf: Buffer): OscMessage[] {
  try {
    const out: OscMessage[] = []
    decode(buf, 0, out)
    return out
  } catch {
    return []
  }
}
