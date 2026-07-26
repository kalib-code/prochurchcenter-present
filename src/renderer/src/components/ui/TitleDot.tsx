/**
 * TitleDot — the signal-orange period that terminates every page title
 * in the design ("Songs.", "Settings.", "New Service."). A component
 * rather than a hand-typed span so the colour can never drift.
 */

export function TitleDot(): JSX.Element {
  return <span className="text-signal">.</span>
}
