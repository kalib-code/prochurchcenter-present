/**
 * useUndo — linear undo/redo history for a single value (typically the
 * song rawText in SongEditor).
 *
 * Design choices already made:
 *   - Linear history (not a tree). Redo stack is dropped when a new edit
 *     lands after an undo. This matches how every mainstream text editor
 *     behaves and is what Ate Rose will intuitively expect.
 *   - Coalesced by idle time — rapid keystrokes collapse into one snapshot.
 *     Without coalescing, Cmd+Z would rewind one character at a time, which
 *     is miserable on a 200-line song.
 *   - Bounded stack — we cap at MAX_HISTORY entries so a very long editing
 *     session doesn't leak memory. Drop oldest when full.
 *
 * What you see below: the hook signature, the state shape, and helpful
 * constants. The body is a TODO — see `useUndo` doc comment for what to
 * implement and the trade-offs to weigh.
 */

import { useCallback, useRef, useState } from 'react'

/** How long to wait after the last change before committing a snapshot. */
export const COALESCE_IDLE_MS = 400

/** Maximum entries kept in the past stack. Oldest evicted when full. */
export const MAX_HISTORY = 100

export interface UseUndoResult<T> {
  /** Current value (same reference until it actually changes) */
  value: T
  /** Set a new value. Schedules a snapshot after COALESCE_IDLE_MS of idle. */
  set: (next: T) => void
  /** Step backward through history. No-op if there's nothing to undo. */
  undo: () => void
  /** Step forward through history. No-op if there's nothing to redo. */
  redo: () => void
  /** True when undo() would do something. Use to disable toolbar buttons. */
  canUndo: boolean
  /** True when redo() would do something. */
  canRedo: boolean
  /** Reset history to a new initial value (e.g. when loading a different song). */
  reset: (initial: T) => void
}

/**
 * TODO (user task — learning mode):
 *
 * Implement the undo/redo hook below. The rough shape:
 *
 *   1. Track `past: T[]`, `present: T`, `future: T[]` in one state object
 *      (single-setState update = atomic transitions).
 *   2. `set(next)`:
 *        - Update `present` immediately so the textarea stays responsive
 *        - Clear a pending coalesce timer if one is running
 *        - Start a new timer; when it fires, push the OLD present onto past
 *          and clear future (a new edit invalidates redo)
 *        - Cap past at MAX_HISTORY (drop from the front)
 *   3. `undo()`: move present → future[0], past[last] → present
 *   4. `redo()`: symmetric (future[0] → present, present → past[last+1])
 *   5. `reset(initial)`: blow away past + future, set present = initial
 *
 * Trade-offs to think about while you're writing:
 *
 *   - Do you snapshot the PRE-edit value or the POST-edit value? (Pre-edit
 *     is standard: it's what `undo` wants to restore to. But it means the
 *     first edit of a session doesn't snapshot until the second edit.)
 *
 *   - Should undo() flush the pending coalesce timer first, so undoing
 *     mid-typing gets you back to a known state? (Recommended: yes. The
 *     user pressing Cmd+Z is an explicit "commit point".)
 *
 *   - If `set()` is called with a value equal to `present`, skip. Otherwise
 *     you waste history slots on no-op renders.
 *
 * Bonus: write 2-3 inline comments explaining your choices. Future-you
 * (and code review) will thank you.
 *
 * When you're done, remove this TODO comment and the stub throw below.
 */

export function useUndo<T>(initial: T): UseUndoResult<T> {
  // Suppress unused-import warnings until the hook is implemented
  void useState
  void useRef
  void useCallback
  void initial

  throw new Error(
    'useUndo is not yet implemented — see the TODO in src/renderer/src/hooks/useUndo.ts'
  )
}
