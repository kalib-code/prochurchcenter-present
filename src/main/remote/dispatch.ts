/**
 * Request/reply bridge between main-process listeners and the operator
 * window, which owns the Service Mode state and executes each cue.
 */
import { randomUUID } from 'crypto'
import type { RemoteCommand, RemoteCommandEvent, RemoteResult } from '@shared/remote'

interface Pending {
  resolve: (r: RemoteResult) => void
  timer: ReturnType<typeof setTimeout>
}

export function createDispatcher(
  send: (msg: RemoteCommandEvent) => boolean,
  timeoutMs = 1000
): {
  dispatch(cmd: RemoteCommand, source: 'http' | 'osc', from: string | null): Promise<RemoteResult>
  reply(id: string, result: RemoteResult): void
  /** Settle everything in flight (listeners are going away). */
  close(): void
} {
  const pending = new Map<string, Pending>()

  return {
    dispatch(command, source, from) {
      return new Promise<RemoteResult>((resolve) => {
        const id = randomUUID()
        let sent = false
        try {
          sent = send({ id, command, source, from })
        } catch {
          sent = false
        }
        if (!sent) return resolve({ ok: false, reason: 'no-service' })
        const timer = setTimeout(() => {
          pending.delete(id)
          resolve({ ok: false, reason: 'timeout' })
        }, timeoutMs)
        pending.set(id, { resolve, timer })
      })
    },
    reply(id, result) {
      const p = pending.get(id)
      if (!p) return
      pending.delete(id)
      clearTimeout(p.timer)
      p.resolve(result)
    },
    close() {
      for (const p of pending.values()) {
        clearTimeout(p.timer)
        p.resolve({ ok: false, reason: 'no-service' })
      }
      pending.clear()
    }
  }
}
