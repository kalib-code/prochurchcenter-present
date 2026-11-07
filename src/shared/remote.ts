/**
 * Shared remote-control protocol: the command vocabulary used by the HTTP,
 * OSC and MIDI front-ends, plus the pure mappings into it. No Node/Electron
 * imports so both main and renderer can use it.
 */
import { shortcutFromLabel } from './sectionShortcut'

export const REMOTE_HTTP_DEFAULT_PORT = 39218
export const REMOTE_OSC_DEFAULT_PORT = 39219
export const REMOTE_MIDI_DEFAULT_CHANNEL = 16

export type RemoteCommand =
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'nextItem' }
  | { type: 'prevItem' }
  | { type: 'goToItem'; number: number } // 1-based
  | { type: 'goToSection'; section: string } // <= 40 chars
  | { type: 'black' }
  | { type: 'logo' }
  | { type: 'live' }
  | { type: 'status' }

export type RemoteFailure =
  | 'no-service'
  | 'paused'
  | 'not-found'
  | 'not-a-song'
  | 'timeout'
  | 'invalid'

export interface RemotePosition {
  itemNumber: number
  itemCount: number
  itemLabel: string
  section: string | null
  slideNumber: number
  slideCount: number
  display: 'live' | 'black' | 'logo'
}

export type RemoteResult =
  | { ok: true; position: RemotePosition | null }
  | { ok: false; reason: RemoteFailure }

export type RemoteSource = 'http' | 'osc' | 'midi'

export type OscArg = number | string | boolean

const SECTION_MAX = 40

const SIMPLE_TYPES = [
  'next',
  'prev',
  'nextItem',
  'prevItem',
  'black',
  'logo',
  'live',
  'status'
] as const

export function parseRemoteCommand(raw: unknown): RemoteCommand | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const type = o.type
  if ((SIMPLE_TYPES as readonly unknown[]).includes(type)) {
    return { type } as RemoteCommand
  }
  if (type === 'goToItem') {
    const n = o.number
    if (typeof n === 'number' && Number.isInteger(n) && n >= 1) return { type, number: n }
    return null
  }
  if (type === 'goToSection') {
    if (typeof o.section !== 'string') return null
    const section = o.section.trim()
    if (section.length === 0 || section.length > SECTION_MAX) return null
    return { type, section }
  }
  return null
}

/** "verse 2" -> "2", "chorus" -> "C", "Pre-Chorus" -> "P". Null when empty. */
export function sectionKey(input: string): string | null {
  const s = input.trim().replace(/\s+/g, ' ')
  if (!s) return null
  const verse = s.match(/^v(?:erse)?\s*(\d+)$/i) ?? s.match(/^(\d+)$/)
  if (verse) return verse[1]
  return shortcutFromLabel(s) || null
}

const MIDI_NOTE_COMMANDS: Record<number, RemoteCommand> = {
  60: { type: 'next' },
  61: { type: 'prev' },
  62: { type: 'nextItem' },
  63: { type: 'prevItem' },
  64: { type: 'black' },
  65: { type: 'logo' },
  66: { type: 'live' }
}

const MIDI_SECTION_NOTES: Record<number, string> = {
  70: 'Intro',
  71: 'Pre-Chorus',
  72: 'Chorus',
  73: 'Bridge',
  74: 'Tag',
  75: 'Outro'
}

/** `channel` is 1-based (1..16). Only Note On (velocity > 0) and Program Change act. */
export function midiToCommand(data: ArrayLike<number>, channel: number): RemoteCommand | null {
  if (data.length < 2) return null
  const status = data[0]
  if ((status & 0x0f) !== channel - 1) return null
  const kind = status & 0xf0
  if (kind === 0xc0) return { type: 'goToItem', number: data[1] + 1 }
  if (kind !== 0x90 || data.length < 3 || data[2] <= 0) return null
  const note = data[1]
  const simple = MIDI_NOTE_COMMANDS[note]
  if (simple) return { ...simple }
  const label = MIDI_SECTION_NOTES[note]
  if (label) return { type: 'goToSection', section: label }
  if (note >= 80 && note <= 91) return { type: 'goToSection', section: `Verse ${note - 80 + 1}` }
  return null
}

const OSC_TRIGGERS: Record<string, RemoteCommand['type']> = {
  '/present/next': 'next',
  '/present/prev': 'prev',
  '/present/item/next': 'nextItem',
  '/present/item/prev': 'prevItem',
  '/present/black': 'black',
  '/present/logo': 'logo',
  '/present/live': 'live'
}

export function oscToCommand(address: string, args: OscArg[]): RemoteCommand | null {
  const trigger = OSC_TRIGGERS[address]
  if (trigger) {
    // TouchOSC-style buttons send 1 on press and 0 on release.
    if (args.length > 0 && args[0] === 0) return null
    return { type: trigger } as RemoteCommand
  }
  if (address === '/present/item') {
    return parseRemoteCommand({ type: 'goToItem', number: args[0] })
  }
  if (address === '/present/section') {
    return parseRemoteCommand({ type: 'goToSection', section: args[0] })
  }
  return null
}

export function describeCommand(cmd: RemoteCommand): string {
  switch (cmd.type) {
    case 'next':
      return 'Next slide'
    case 'prev':
      return 'Previous slide'
    case 'nextItem':
      return 'Next song'
    case 'prevItem':
      return 'Previous song'
    case 'goToItem':
      return `Go to song ${cmd.number}`
    case 'goToSection':
      return `Go to ${cmd.section}`
    case 'black':
      return 'Black screen'
    case 'logo':
      return 'Logo screen'
    case 'live':
      return 'Go live'
    case 'status':
      return 'Status request'
  }
}
