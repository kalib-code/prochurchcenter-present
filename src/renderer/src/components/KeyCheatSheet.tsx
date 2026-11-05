/**
 * KeyCheatSheet — overlay shown in Service Mode when the user presses `?`.
 * A quick reference so a new volunteer can see what every key does
 * without having to memorize anything.
 *
 * Deliberately dead-simple: big type, high contrast, no icons, nothing
 * to learn. Matches the Ate Rose principle ("Kaya ba ni Ate Rose nang
 * walang tatanungin?" — reproduced verbatim in the header, per design).
 *
 * Backdrop is a plain `<div onClick>` (click-outside-to-close), same as
 * before the redesign — this is the standard modal-backdrop pattern,
 * not a stand-in for a real control. The actual dismiss controls are
 * the `?` / Esc keys (via useKeyboard) and this backdrop click; there
 * are no other interactive elements to accidentally nest inside it.
 */

import { Panel } from './ui/Card'
import { Kbd } from './service/Kbd'

interface KeyCheatSheetProps {
  onClose: () => void
}

// Every bound key in Service Mode — see hooks/useKeyboard.ts for
// Space/Arrows/B/L/Esc and the video-specific P/M handler inside
// ServiceMode.tsx's RunningView. Keeping this list in sync with both
// is manual; it is the ONE place a volunteer looks, so an omission
// here is a real gap even though it doesn't break functionality.
//
// Each entry is a list of alternatives; each alternative is a list of
// keys pressed together (rendered "Shift + Space").
const SHORTCUTS: Array<[string[][], string]> = [
  [[['Space'], ['→']], 'Next slide'],
  [[['Shift', 'Space'], ['←']], 'Previous slide'],
  [[['↓']], 'Next item (skip forward)'],
  [[['↑']], 'Previous item (rewind)'],
  [[['B']], 'Blackout on/off'],
  [[['L']], 'Logo/standby on/off'],
  [[['P']], 'Pause/resume the active video'],
  [[['M']], 'Mute/unmute the active video'],
  [[['?']], 'Show / hide this cheat sheet'],
  [[['Esc']], 'Exit service']
]

function KeyCombos({ combos }: { combos: string[][] }): JSX.Element {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {combos.map((combo, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <span className="text-[12px] text-muted-foreground">or</span>}
          {combo.map((key, j) => (
            <span key={key} className="flex items-center gap-1">
              {j > 0 && <span className="text-[12px] text-muted-foreground">+</span>}
              <Kbd className="h-6 min-w-[24px] text-[12px] text-foreground">{key}</Kbd>
            </span>
          ))}
        </span>
      ))}
    </span>
  )
}

export function KeyCheatSheet({ onClose }: KeyCheatSheetProps): JSX.Element {
  return (
    <div
      className="absolute inset-0 z-20 flex items-center justify-center bg-app/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <Panel
        onClick={(e) => e.stopPropagation()}
        className="w-[540px] bg-raised shadow-2xl"
        title={<span className="text-[15px] font-semibold text-foreground">Keyboard shortcuts</span>}
        action={
          <span className="text-[12px] text-muted-foreground">
            Kaya ba ni Ate Rose nang walang tatanungin?
          </span>
        }
      >
        <dl className="py-1">
          {SHORTCUTS.map(([combos, desc]) => (
            <div
              key={desc}
              className="flex items-center gap-4 border-b border-rule px-5 py-2.5 last:border-b-0"
            >
              <dt className="w-[180px] shrink-0">
                <KeyCombos combos={combos} />
              </dt>
              <dd className="text-[13.5px] text-bone">{desc}</dd>
            </div>
          ))}
        </dl>
        <div className="border-t border-rule px-5 py-3 text-center text-[12px] text-muted-foreground">
          Press <Kbd>?</Kbd> again, <Kbd>Esc</Kbd>, or click outside to close
        </div>
      </Panel>
    </div>
  )
}
