/**
 * KeyCheatSheet — overlay shown in Service Mode when the user presses `?`.
 * A quick reference so a new volunteer can see what every key does
 * without having to memorize anything.
 *
 * Deliberately dead-simple: big type, high contrast, no icons, nothing
 * to learn. Matches the Ate Rose principle ("Kaya ba ni Ate Rose gawin 'to
 * nang walang tatanungin?").
 */

interface KeyCheatSheetProps {
  onClose: () => void
}

const SHORTCUTS: Array<[string, string]> = [
  ['Space  /  →', 'Next slide'],
  ['Shift + Space  /  ←', 'Previous slide'],
  ['↓', 'Next item (skip forward)'],
  ['↑', 'Previous item (rewind)'],
  ['B', 'Blackout on/off'],
  ['L', 'Logo/standby on/off'],
  ['?', 'Show / hide this cheat sheet'],
  ['Esc', 'Exit service']
]

export function KeyCheatSheet({ onClose }: KeyCheatSheetProps): JSX.Element {
  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-lg border border-border/40 bg-background p-8 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-6 text-2xl font-semibold">Keyboard Shortcuts</h2>

        <dl className="space-y-3">
          {SHORTCUTS.map(([key, desc]) => (
            <div
              key={key}
              className="flex items-baseline justify-between gap-6"
            >
              <dt className="font-mono text-sm text-muted-foreground">{key}</dt>
              <dd className="text-sm">{desc}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-6 text-center text-xs text-muted-foreground">
          Press <span className="font-mono">?</span> again or click outside to close
        </div>
      </div>
    </div>
  )
}
