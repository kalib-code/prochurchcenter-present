/**
 * PreflightPanel — Home's readiness grid.
 *
 * Header: "PRE-FLIGHT" eyebrow, the rationale line, an "N OK · M WARNING"
 * chip, and RE-CHECK. Body: one cell per check in a HairlineGrid, each
 * with a status dot, status word, name, and detail.
 *
 * PreflightBanner is the hero's inline warning strip — it shows only the
 * FIRST warning, with its remedy button, because the hero has room for
 * one line and the panel below carries the rest.
 */

import type { PreflightCheck, PreflightReport } from '@shared/ipc-contract'
import { summarize } from '../lib/preflight'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { Panel } from './ui/Card'
import { HairlineGrid } from './ui/HairlineGrid'
import { MonoLabel } from './ui/MonoLabel'
import { StatusDot } from './ui/StatusDot'

export function PreflightBanner({
  check,
  count,
  onAct
}: {
  check: PreflightCheck
  count: number
  onAct: (check: PreflightCheck) => void
}): JSX.Element {
  return (
    <div className="mb-[18px] flex items-center gap-3 border border-signal/50 bg-signal/[0.08] px-3.5 py-[11px]">
      <MonoLabel tone="signal" size="xs" className="shrink-0">
        {count} WARNING{count === 1 ? '' : 'S'}
      </MonoLabel>
      <span className="flex-1 text-[12px] text-bone">{check.detail}</span>
      {check.remedy && (
        <Button
          size="sm"
          onClick={() => onAct(check)}
          className="shrink-0 border-signal text-signal hover:bg-signal hover:text-white"
        >
          {check.remedy.label}
        </Button>
      )}
    </div>
  )
}

export function PreflightPanel({
  report,
  onRecheck,
  busy = false
}: {
  report: PreflightReport | null
  onRecheck: () => void
  busy?: boolean
}): JSX.Element | null {
  if (!report) return null
  const { headline, warningCount } = summarize(report.checks)

  return (
    <Panel
      className="mb-[34px]"
      title={
        <span className="flex items-baseline gap-3.5">
          <MonoLabel>PRE-FLIGHT</MonoLabel>
          <span className="text-[12px] text-muted-foreground">
            Checked on launch — Saturday night, not Sunday morning.
          </span>
        </span>
      }
      action={
        <span className="flex items-center gap-2.5">
          <Badge tone={warningCount > 0 ? 'signal' : 'ok'}>{headline}</Badge>
          <Button size="sm" onClick={onRecheck} disabled={busy}>
            {busy ? 'CHECKING…' : 'RE-CHECK'}
          </Button>
        </span>
      }
    >
      {/* cols is the check COUNT, not a hardcoded 4 — the macOS-only
          screenRecording check is absent on Windows and Linux, and the
          grid has to stay even when it is. */}
      <HairlineGrid cols={report.checks.length} className="border-l-0 border-t-0">
        {report.checks.map((c) => (
          <div key={c.id} className="px-[18px] py-4">
            <span className="mb-2 flex items-center gap-2">
              <StatusDot tone={c.status === 'ready' ? 'ok' : 'signal'} />
              <MonoLabel tone={c.status === 'ready' ? 'muted' : 'signal'} size="xs">
                {c.status === 'ready' ? 'READY' : 'ACTION NEEDED'}
              </MonoLabel>
            </span>
            <span className="mb-1 block text-[13.5px] font-bold text-foreground">{c.name}</span>
            <span className="block text-[11.5px] leading-[1.55] text-muted-foreground">
              {c.detail}
            </span>
          </div>
        ))}
      </HairlineGrid>
    </Panel>
  )
}
