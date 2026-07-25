/**
 * Pre-flight presentation helpers.
 *
 * The report itself is produced in the main process (it needs Electron's
 * screen/systemPreferences APIs). This module is the pure reduction the
 * renderer needs: counts, the headline chip, and the first warning for
 * the hero banner.
 */

import type { PreflightCheck } from '@shared/ipc-contract'

export interface PreflightSummary {
  okCount: number
  warningCount: number
  /** "3 OK · 1 WARNING" — the chip in the pre-flight panel header. */
  headline: string
  /** First failing check, for the hero warning banner. Null when all pass. */
  firstWarning: PreflightCheck | null
}

export function summarize(checks: PreflightCheck[]): PreflightSummary {
  let okCount = 0
  let warningCount = 0
  let firstWarning: PreflightCheck | null = null

  for (const check of checks) {
    if (check.status === 'warning') {
      warningCount += 1
      if (firstWarning === null) firstWarning = check
    } else {
      okCount += 1
    }
  }

  const headline =
    warningCount === 0
      ? `${okCount} OK`
      : `${okCount} OK · ${warningCount} WARNING${warningCount === 1 ? '' : 'S'}`

  return { okCount, warningCount, headline, firstWarning }
}
