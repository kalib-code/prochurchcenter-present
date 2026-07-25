/**
 * KeyCheatSheet — overlay shown in Service Mode when the user presses `?`.
 * A quick reference so a new volunteer can see what every key does
 * without having to memorize anything. KLB-styled per design L680–695.
 *
 * Deliberately dead-simple: big type, high contrast, no icons, nothing
 * to learn. Matches the Ate Rose principle ("Kaya ba ni Ate Rose nang
 * walang tatanungin?" — reproduced verbatim in the header, per design).
 *
 * Backdrop is a plain `<div onClick>` (click-outside-to-close), same as
 * before the redesign — this is the standard modal-backdrop pattern,
 * not a stand-in for a real control. The actual dismiss controls are
 * the `?` key (toggles via useKeyboard) and this backdrop click; there
 * are no other interactive elements to accidentally nest inside it.
 */

import { Panel } from './ui/Card'
import { MonoLabel } from './ui/MonoLabel'

interface KeyCheatSheetProps {
  onClose: () => void
}

// Every bound key in Service Mode — see hooks/useKeyboard.ts for
// Space/Arrows/B/L/Esc and the video-specific P/M handler inside
// ServiceMode.tsx's RunningView. Keeping this list in sync with both
// is manual; it is the ONE place a volunteer looks, so an omission
// here is a real gap even though it doesn't break functionality.
const SHORTCUTS: Array<[string, string]> = [
  ['SPACE / →', 'Next slide'],
  ['SHIFT + SPACE / ←', 'Previous slide'],
  ['↓', 'Next item (skip forward)'],
  ['↑', 'Previous item (rewind)'],
  ['B', 'Blackout on/off'],
  ['L', 'Logo/standby on/off'],
  ['P', 'Pause/resume the active video'],
  ['M', 'Mute/unmute the active video'],
  ['?', 'Show / hide this cheat sheet'],
  ['ESC', 'Exit service']
]

export function KeyCheatSheet({ onClose }: KeyCheatSheetProps): JSX.Element {
  return (
    <div
      className="absolute inset-0 z-20 flex items-center justify-center bg-background/[0.88]"
      onClick={onClose}
    >
      <Panel
        emphasis
        onClick={(e) => e.stopPropagation()}
        className="w-[520px]"
        title={<MonoLabel tone="signal">KEYBOARD</MonoLabel>}
        action={
          <span className="text-[11px] text-muted-foreground">
            Kaya ba ni Ate Rose nang walang tatanungin?
          </span>
        }
      >
        <dl>
          {SHORTCUTS.map(([key, desc]) => (
            <div
              key={key}
              className="flex items-center gap-4 border-b border-rule px-[18px] py-[11px] last:border-b-0"
            >
              <dt className="w-[150px] shrink-0 font-mono text-[10px] font-semibold tracking-[0.06em] text-foreground">
                {key}
              </dt>
              <dd className="text-[12.5px] text-soft">{desc}</dd>
            </div>
          ))}
        </dl>
        <div className="border-t border-border px-[18px] py-[11px] text-center text-[11px] text-muted-foreground">
          Press <span className="font-mono text-foreground">?</span> again or click outside to
          close
        </div>
      </Panel>
    </div>
  )
}
