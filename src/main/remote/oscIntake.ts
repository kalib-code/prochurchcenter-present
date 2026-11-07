/**
 * Pure OSC intake: sender allowlist, decode, map and per-packet cap.
 * OSC has no authentication, so this is the only gate before dispatch.
 */
import { oscToCommand, type RemoteCommand } from '@shared/remote'
import { decodeOscPacket } from './osc'

export const OSC_MAX_COMMANDS_PER_PACKET = 16

export function oscPacketToCommands(
  buf: Buffer,
  from: string,
  allowFrom: string | null
): RemoteCommand[] {
  try {
    const sender = from.replace(/^::ffff:/i, '')
    if (allowFrom !== null && sender !== allowFrom) return []
    const out: RemoteCommand[] = []
    for (const m of decodeOscPacket(buf)) {
      const cmd = oscToCommand(m.address, m.args)
      if (!cmd) continue
      out.push(cmd)
      if (out.length >= OSC_MAX_COMMANDS_PER_PACKET) break
    }
    return out
  } catch {
    return []
  }
}
