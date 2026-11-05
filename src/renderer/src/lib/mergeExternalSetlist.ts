/**
 * Three-way merge for an open setlist editor when something outside the
 * renderer (an AI tool over MCP) saves the same setlist.
 *
 * The editor holds a draft and autosaves the WHOLE item list. Without a
 * merge, the operator's next keystroke would write their stale list over
 * the AI's addition and the sermon deck would silently vanish. With it:
 *
 *   base   — what the editor last knew was on disk
 *   local  — the editor's draft (may hold unsaved edits)
 *   remote — what was just saved from outside
 *
 * Rules, per field and per item (matched by id):
 *   - Changed only remotely → take remote.
 *   - Changed locally (pending edit) → keep local. The operator's edit
 *     is the newer intent, and it is the one they can see.
 *   - Item added remotely → inserted after the nearest item that
 *     precedes it in the remote list, so "add at position 2" lands
 *     where the AI put it even if the operator reordered meanwhile.
 *   - Item deleted remotely (and untouched locally) → dropped.
 *
 * Idempotent: merging the same remote twice changes nothing more, which
 * matters because the remote also echoes back through the store.
 */

import type { SetlistItem } from '@shared/types'

export interface SetlistFields {
  name: string
  date: string
  items: SetlistItem[]
  startTime?: string
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export function sameSetlistFields(a: SetlistFields | null, b: SetlistFields | null): boolean {
  if (!a || !b) return a === b
  return (
    a.name === b.name &&
    a.date === b.date &&
    (a.startTime ?? null) === (b.startTime ?? null) &&
    same(a.items, b.items)
  )
}

function pick<T>(base: T, local: T, remote: T): T {
  return same(local, base) ? remote : local
}

export function mergeExternalSetlist<T extends SetlistFields>(base: T, local: T, remote: T): T {
  const baseById = new Map(base.items.map((i) => [i.id, i]))
  const remoteById = new Map(remote.items.map((i) => [i.id, i]))

  const items: SetlistItem[] = []
  for (const item of local.items) {
    const b = baseById.get(item.id)
    const r = remoteById.get(item.id)
    if (b && !r) {
      // Deleted remotely. Keep it only if the operator has edited it since.
      if (!same(item, b)) items.push(item)
      continue
    }
    items.push(b && r && same(item, b) ? r : item)
  }

  const present = new Set(items.map((i) => i.id))
  remote.items.forEach((r, index) => {
    if (present.has(r.id) || baseById.has(r.id)) return
    // Nearest earlier remote item that the result contains.
    let at = 0
    for (let k = index - 1; k >= 0; k--) {
      const found = items.findIndex((i) => i.id === remote.items[k].id)
      if (found !== -1) {
        at = found + 1
        break
      }
    }
    items.splice(at, 0, r)
    present.add(r.id)
  })

  return {
    ...local,
    name: pick(base.name, local.name, remote.name),
    date: pick(base.date, local.date, remote.date),
    startTime: pick(base.startTime, local.startTime, remote.startTime),
    items
  }
}
