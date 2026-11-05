/**
 * Ordering for optimistic store updates (settings, theme).
 *
 * The stores set the patched value locally, await the IPC call, then
 * reconcile with main's reply. Naively applying every reply as it lands
 * breaks during a slider drag: requests 1..N are in flight, and reply 3
 * arriving after the optimistic value for N snaps the control back to 3.
 * Failures were never rolled back either.
 *
 * Rules implemented here:
 *   - Each request gets an increasing sequence number.
 *   - The "confirmed" value is main's reply to the HIGHEST-numbered
 *     request that succeeded — never an older reply that arrived late.
 *   - Nothing is written back while any request is still in flight (the
 *     optimistic value is the newest intent); once the last one settles,
 *     the store is reconciled to the confirmed value. If the latest
 *     request succeeded that's its reply (equal to what the user set); if
 *     it failed it's a rollback to the last value main actually accepted.
 */

export interface ReplySequencer<T> {
  /** Start a request. `current` is the store value BEFORE the optimistic
   * patch; it becomes the rollback baseline when nothing is in flight. */
  begin(current: T): number
  /** Record a successful reply. Returns `{ value }` when the store should
   * be set to `value` now, or null to leave it alone. */
  succeed(seq: number, reply: T): { value: T } | null
  /** Record a failure. Same return contract as `succeed`. */
  fail(seq: number): { value: T } | null
}

export function createReplySequencer<T>(): ReplySequencer<T> {
  let nextSeq = 0
  let inFlight = 0
  let confirmedSeq = 0
  let confirmed: T | undefined

  const settle = (): { value: T } | null => {
    inFlight -= 1
    return inFlight === 0 ? { value: confirmed as T } : null
  }

  return {
    begin(current) {
      if (inFlight === 0) {
        confirmed = current
        confirmedSeq = nextSeq
      }
      inFlight += 1
      nextSeq += 1
      return nextSeq
    },
    succeed(seq, reply) {
      if (seq > confirmedSeq) {
        confirmed = reply
        confirmedSeq = seq
      }
      return settle()
    },
    fail() {
      return settle()
    }
  }
}
