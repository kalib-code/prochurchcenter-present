/**
 * Shared remote-control protocol: the command vocabulary used by the HTTP,
 * OSC and MIDI front-ends, plus the pure mappings into it. No Node/Electron
 * imports so both main and renderer can use it.
 */
export const REMOTE_HTTP_DEFAULT_PORT = 39218
export const REMOTE_OSC_DEFAULT_PORT = 39219
export const REMOTE_MIDI_DEFAULT_CHANNEL = 16

export type RemoteCommand =
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'nextItem' }
  | { type: 'prevItem' }
  | { type: 'goToItem'; number: number } // 1-based
  | { type: 'goToSlide'; number: number } // 1-based, within the current item
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
  if (type === 'goToItem' || type === 'goToSlide') {
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

/** Lowercase, trim, and collapse runs of spaces/hyphens/underscores to one space. */
function normalizeSectionName(input: string): string {
  return input.toLowerCase().replace(/[\s_-]+/g, ' ').trim()
}

const VERSE_RE = /^(?:verse ?|v ?)?(\d+)$/
/** Standard non-verse names -> the shortcut key the Service Mode grid shows. */
const KNOWN_SECTIONS: [RegExp, string][] = [
  [/^(?:chorus|c)$/, 'C'],
  [/^(?:pre ?chorus|p)$/, 'P'],
  [/^(?:bridge|b)$/, 'B'],
  [/^(?:intro|i)$/, 'I'],
  [/^(?:outro|o)$/, 'O'],
  [/^(?:tag|t)$/, 'T']
]
const TRAILING_NUMBER_RE = / ?\d+$/

/**
 * Shortcut key for a section cue: "verse 2" / "v2" / "2" -> "2", "chorus" /
 * "chorus 2" / "c" -> "C", "Pre-Chorus" -> "P", any single character -> that
 * character uppercased. Null for an empty or unknown name ("Coda",
 * "Interlude", "Post-Chorus"): unknown names match only by exact label
 * (see sectionLabelKey), never by first letter.
 */
export function sectionKey(input: string): string | null {
  const s = normalizeSectionName(input)
  if (!s) return null
  const verse = s.match(VERSE_RE)
  if (verse) return String(Number(verse[1]))
  const base = s.replace(TRAILING_NUMBER_RE, '')
  for (const [re, key] of KNOWN_SECTIONS) if (re.test(base)) return key
  if (s.length === 1) return s.toUpperCase()
  return null
}

/**
 * Comparable form of a section name, for exact-label matching of both the
 * cue and a song's section labels: normalized, verses as "verse N" (no
 * leading zeros), other names without a trailing number ("Chorus 2" ->
 * "chorus", "Post-Chorus" -> "post chorus"). Empty for empty input.
 */
export function sectionLabelKey(input: string): string {
  const s = normalizeSectionName(input)
  const verse = s.match(VERSE_RE)
  if (verse) return `verse ${Number(verse[1])}`
  return s.replace(TRAILING_NUMBER_RE, '').replace(/^prechorus\b/, 'pre chorus')
}

const MIDI_NOTE_COMMANDS = new Map<number, RemoteCommand>(Object.entries({
  60: { type: 'next' },
  61: { type: 'prev' },
  62: { type: 'nextItem' },
  63: { type: 'prevItem' },
  64: { type: 'black' },
  65: { type: 'logo' },
  66: { type: 'live' }
} as Record<string, RemoteCommand>).map(([k, v]) => [Number(k), v]))

/** Note On velocity is the slide number (ProPresenter/FreeShow "slide at index"). */
const MIDI_SLIDE_NOTE = 100

const MIDI_SECTION_NOTES = new Map<number, string>(Object.entries({
  70: 'Intro',
  71: 'Pre-Chorus',
  72: 'Chorus',
  73: 'Bridge',
  74: 'Tag',
  75: 'Outro'
} as Record<string, string>).map(([k, v]) => [Number(k), v]))

/** `channel` is 1-based (1..16). Only Note On (velocity > 0) and Program Change act. */
export function midiToCommand(data: ArrayLike<number>, channel: number): RemoteCommand | null {
  if (data.length < 2) return null
  const status = data[0]
  if ((status & 0x0f) !== channel - 1) return null
  const kind = status & 0xf0
  if (kind === 0xc0) return { type: 'goToItem', number: data[1] + 1 }
  if (kind !== 0x90 || data.length < 3 || data[2] <= 0) return null
  const note = data[1]
  if (note === MIDI_SLIDE_NOTE) return { type: 'goToSlide', number: data[2] }
  const simple = MIDI_NOTE_COMMANDS.get(note)
  if (simple) return { ...simple }
  const label = MIDI_SECTION_NOTES.get(note)
  if (label) return { type: 'goToSection', section: label }
  if (note >= 80 && note <= 91) return { type: 'goToSection', section: `Verse ${note - 80 + 1}` }
  return null
}

const OSC_TRIGGERS = new Map<string, RemoteCommand['type']>(Object.entries({
  '/present/next': 'next',
  '/present/prev': 'prev',
  '/present/item/next': 'nextItem',
  '/present/item/prev': 'prevItem',
  '/present/black': 'black',
  '/present/logo': 'logo',
  '/present/live': 'live'
} as Record<string, RemoteCommand['type']>))

export function oscToCommand(address: string, args: OscArg[]): RemoteCommand | null {
  const trigger = OSC_TRIGGERS.get(address)
  if (trigger) {
    // TouchOSC-style buttons send 1 (or T) on press and 0 (or F) on release.
    if (args.length > 0 && (args[0] === 0 || args[0] === false)) return null
    return { type: trigger } as RemoteCommand
  }
  if (address === '/present/item') {
    return parseRemoteCommand({ type: 'goToItem', number: args[0] })
  }
  if (address === '/present/slide') {
    return parseRemoteCommand({ type: 'goToSlide', number: args[0] })
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
    case 'goToSlide':
      return `Go to slide ${cmd.number}`
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

/** Dotted IPv4: four decimal octets 0-255, no signs or spaces. */
export function isIPv4(s: string): boolean {
  const parts = s.split('.')
  return (
    parts.length === 4 &&
    // No leading zeros: real sender addresses are canonical, so a padded
    // entry would never match and would silently block every cue.
    parts.every((p) => /^(0|[1-9]\d{0,2})$/.test(p) && Number(p) <= 255)
  )
}

/** Per-computer remote-control settings, stored in `<userData>/remote.json`. */
export interface RemoteConfig {
  enabled: boolean
  scope: 'local' | 'network'
  httpPort: number
  oscEnabled: boolean
  oscPort: number
  midiEnabled: boolean
  midiInput: string | null
  midiChannel: number // 1..16
  /** Only accept OSC from this IPv4 sender; null accepts any (OSC has no auth). */
  oscAllowFrom: string | null
  token: string
}

/** One cue forwarded from a main-process listener to the operator window. */
export interface RemoteCommandEvent {
  id: string
  command: RemoteCommand
  source: RemoteSource
  from: string | null
  /**
   * Epoch ms after which main has already answered `timeout`. The operator
   * window must discard the cue past this point rather than run it late
   * (e.g. when a modal dialog blocked the renderer and cues queued up).
   */
  expiresAt: number
}

/** What Settings shows: the saved config plus live listener status. */
export type RemoteState = RemoteConfig & {
  status: 'off' | 'starting' | 'running' | 'error'
  error: string | null
  addresses: string[]
}
