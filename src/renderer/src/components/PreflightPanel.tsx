/**
 * PreflightPanel — Home's readiness checklist.
 *
 * Header: "Pre-flight", a sentence-case summary ("2 ready · 2 need
 * attention"), and Re-check. Body: one row per check — a status icon
 * (green check / amber triangle), the check name and detail, and on
 * warning rows the remedy as a secondary button.
 *
 * Warnings are amber (`warn`), never orange or red: red is reserved for
 * ON AIR, orange for selection/brand.
 */

import type { PreflightCheck, PreflightReport } from '@shared/ipc-contract'
import { summarize } from '../lib/preflight'
import { cn } from '../lib/utils'
import { Button } from './ui/Button'
import { AlertIcon, CheckIcon } from './icons'

/** "3 ready" / "2 ready · 2 need attention" — sentence-case summary. */
export function preflightSummaryText(checks: PreflightCheck[]): string {
  const { okCount, warningCount } = summarize(checks)
  if (warningCount === 0) return `${okCount} ready`
  return `${okCount} ready · ${warningCount} need${warningCount === 1 ? 's' : ''} attention`
}

export function PreflightPanel({
  report,
  onRecheck,
  onAct,
  busy = false
}: {
  report: PreflightReport | null
  onRecheck: () => void
  /** Runs a warning row's remedy. Rows show no remedy button without it. */
  onAct?: (check: PreflightCheck) => void
  busy?: boolean
}): JSX.Element | null {
  if (!report) return null
  const { warningCount } = summarize(report.checks)

  return (
    <section aria-labelledby="preflight-heading">
      <div className="mb-3 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-baseline gap-3">
            <h2 id="preflight-heading" className="text-[16px] font-semibold text-foreground">
              Pre-flight
            </h2>
            <span
              className={cn(
                'text-[13px] tabular-nums',
                warningCount > 0 ? 'text-warn' : 'text-ok'
              )}
            >
              {preflightSummaryText(report.checks)}
            </span>
          </div>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Checked on launch — Saturday night, not Sunday morning.
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={onRecheck} disabled={busy} className="shrink-0">
          {busy ? 'Checking…' : 'Re-check'}
        </Button>
      </div>

      {/* One row per check. The macOS-only screenRecording check is
          absent on Windows and Linux; a list (unlike the old fixed-column
          grid) needs no special handling for that. */}
      <ul className="overflow-hidden rounded-xl bg-raised">
        {report.checks.map((c) => {
          const ready = c.status === 'ready'
          return (
            <li
              key={c.id}
              className="flex items-center gap-3.5 border-b border-rule px-4 py-3 last:border-b-0"
            >
              <span
                className={cn(
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
                  ready ? 'bg-ok/15 text-ok' : 'bg-warn/15 text-warn'
                )}
                aria-label={ready ? 'Ready' : 'Needs attention'}
                role="img"
              >
                {ready ? <CheckIcon size={15} /> : <AlertIcon size={14} />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-medium text-foreground">{c.name}</div>
                <div className="text-[13px] leading-snug text-soft">{c.detail}</div>
              </div>
              {!ready && c.remedy && onAct && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => onAct(c)}
                  className="shrink-0"
                >
                  {c.remedy.label}
                </Button>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
