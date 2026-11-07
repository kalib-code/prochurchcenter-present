import { useState } from 'react'
import type { RemoteState } from '@shared/remote'
import { Button } from '../ui/Button'
import { SettingRow } from '../settings/SettingsKit'
import { CopyButton } from '../AiConnectionsCard'
import { RefreshCwIcon } from '../icons'
import { cleanIpcError } from '../../lib/remoteDisplay'

export function RemoteTokenRow({
  state,
  setState
}: {
  state: RemoteState
  setState: (s: RemoteState) => void
}): JSX.Element {
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const masked = `${state.token.slice(0, 4)}${'•'.repeat(20)}${state.token.slice(-4)}`

  const renew = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    setConfirming(false)
    try {
      setState(await window.api.remote.regenerateToken())
      setShow(false)
      setNotice(true)
    } catch (err) {
      setError(cleanIpcError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingRow
      label="Access token"
      description={
        <code className="select-all break-all font-mono text-[12px] text-soft">{show ? state.token : masked}</code>
      }
      below={
        confirming ? (
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[12px] text-warn">
              Connected apps will stop working until you paste the new token. Make a new token?
            </p>
            <Button size="sm" disabled={busy} onClick={() => void renew()}>
              Make new token
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        ) : error ? (
          <p role="alert" className="text-[12px] text-warn">{error}</p>
        ) : notice ? (
          <p className="text-[12px] text-warn">Connected apps will need the new token.</p>
        ) : undefined
      }
    >
      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" onClick={() => setShow((v) => !v)}>
          {show ? 'Hide' : 'Show'}
        </Button>
        <CopyButton text={state.token} />
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setNotice(false); setConfirming(true) }}>
          <RefreshCwIcon size={14} />
          New token
        </Button>
      </div>
    </SettingRow>
  )
}
