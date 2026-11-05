/**
 * Pure geometry for keeping projector windows on a real screen.
 * No electron imports so it can be unit tested.
 */

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * True when `win` lies entirely inside at least one display's bounds.
 *
 * Why "entirely": projector windows are frameless and sized to cover
 * their display, so there is no title bar to drag them back with. After
 * a display is unplugged the OS may leave the window off-screen, or
 * shove it partly onto another screen at the old (larger) size — both
 * cases leave the operator with no way to fix it by hand, so both count
 * as "not on a display" and get re-fitted.
 */
export function isFullyOnSomeDisplay(win: Rect, displays: Rect[]): boolean {
  return displays.some(
    (d) =>
      win.x >= d.x &&
      win.y >= d.y &&
      win.x + win.width <= d.x + d.width &&
      win.y + win.height <= d.y + d.height
  )
}
