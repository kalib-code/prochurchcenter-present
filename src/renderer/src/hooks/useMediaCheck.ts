/**
 * useMediaCheck — which setlist items point at a file that no longer exists.
 *
 * Returns item IDs rather than paths so SetlistItemCard can ask
 * `missing.has(item.id)` directly. Two items pointing at the same moved
 * file both get flagged, which a path-keyed set would make awkward.
 *
 * Debounced because the setlist editor re-renders on every keystroke and
 * an un-debounced effect would fire an IPC round trip per character.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { SetlistItem } from '@shared/types'
import { mediaPathOf } from '@shared/setlist-media'

const DEBOUNCE_MS = 300

export function useMediaCheck(items: SetlistItem[]): { missing: Set<string> } {
  const [missing, setMissing] = useState<Set<string>>(new Set())

  // Pairs are re-derived on every render but the JOINED KEY below is what
  // actually gates the effect, so a re-render that does not change any
  // media path costs nothing.
  const pairs = useMemo(
    () =>
      items
        .map((item) => ({ id: item.id, path: mediaPathOf(item) }))
        .filter((p): p is { id: string; path: string } => p.path !== null),
    [items]
  )
  const key = pairs.map((p) => `${p.id}:${p.path}`).join('|')

  const latest = useRef(0)

  useEffect(() => {
    if (pairs.length === 0) {
      setMissing(new Set())
      return
    }

    const timer = setTimeout(() => {
      const run = ++latest.current
      void window.api.files.checkExists(pairs.map((p) => p.path)).then((result) => {
        // Drop a stale response — the user may have edited again while
        // this batch was in flight.
        if (run !== latest.current) return
        const next = new Set<string>()
        for (const p of pairs) {
          if (result[p.path] === false) next.add(p.id)
        }
        setMissing(next)
      })
    }, DEBOUNCE_MS)

    return () => clearTimeout(timer)
    // `key` is the real dependency; `pairs` is derived from the same data.
    // A relink writes a NEW path onto the item, which changes `key` and
    // re-runs this effect on its own — no separate recheck trigger needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return { missing }
}
