/**
 * WarningBanner — operator-facing warning strip for problems Service Mode
 * detects but can't (and shouldn't) fix silently: a PowerPoint deck that
 * failed to parse at entry, or a slide that failed to render mid-service.
 *
 * Rose/red, deliberately NOT amber: ServiceMode's items sidebar already uses
 * `bg-amber-400/10 text-amber-200` to mean "this is the active upcoming
 * item" (see ServiceMode.tsx). Reusing amber here would make a warning read
 * as "currently playing" instead of "something is wrong."
 *
 * Operator-only by construction: this component only exists in the
 * ServiceMode module tree, which renders inside the operator's own
 * BrowserWindow. It is never imported by OutputView or StageView (the
 * projector and stage-monitor windows), so there is no path by which a
 * message shown here could end up on a screen the congregation can see.
 */

import { cn } from '../../lib/utils'

interface WarningBannerProps {
  messages: string[]
  /** Called with the exact message string to remove when its dismiss button is clicked. */
  onDismiss?: (message: string) => void
  className?: string
}

export function WarningBanner({
  messages,
  onDismiss,
  className
}: WarningBannerProps): JSX.Element | null {
  if (messages.length === 0) return null

  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col gap-1 border-b border-rose-500/30 bg-rose-950/40 px-4 py-2',
        className
      )}
    >
      {messages.map((message) => (
        <div key={message} className="flex items-start gap-2 text-xs text-rose-200">
          <span aria-hidden="true" className="mt-0.5 shrink-0">
            ⚠
          </span>
          <span className="min-w-0 flex-1 leading-relaxed">{message}</span>
          {onDismiss && (
            <button
              type="button"
              onClick={() => onDismiss(message)}
              className="shrink-0 text-rose-300/70 hover:text-rose-100"
              aria-label="Dismiss warning"
            >
              ✕
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
