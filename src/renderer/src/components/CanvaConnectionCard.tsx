/**
 * CanvaConnectionCard — the Settings → Connections panel body.
 *
 * A separate component rather than inline JSX because Settings.tsx is
 * already ~930 lines; inlining connect/disconnect/account state would
 * push it past 1000.
 *
 * Uses the same Card/Button primitives as the other Settings sections
 * (DataSection, AboutSection, OutputDisplaySection) rather than the raw
 * div/button markup CanvaPicker uses — CanvaPicker is a compact popup
 * with its own visual language, but this card lives in the Settings
 * shell and should look like it belongs there.
 *
 * Every Canva call goes through useCanvaStore, never window.api.canva
 * directly — see the store's wrapCanvaCall doc for why: a failure must
 * re-check connection state before the UI decides what to render, and
 * routing every call through the store is what makes forgetting that
 * impossible rather than merely documented.
 */

import { useEffect } from 'react'
import { useCanvaStore } from '../stores/useCanvaStore'
import { Card } from './ui/Card'
import { Button } from './ui/Button'

export function CanvaConnectionCard(): JSX.Element {
  const { state, error, loadState, connect, disconnect } = useCanvaStore()

  useEffect(() => {
    void loadState()
  }, [loadState])

  return (
    <Card className="space-y-3 p-4">
      <div>
        <h3 className="text-sm font-semibold text-foreground">Canva</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Pull designs from Canva straight into a setlist. Present can browse
          your designs and export them as PDFs — nothing else. It never
          edits or deletes anything in your Canva account.
        </p>
      </div>

      {state.status === 'unavailable' ? (
        <p className="text-xs text-muted-foreground">{state.reason}</p>
      ) : state.status === 'connected' ? (
        <div className="flex items-center justify-between gap-4">
          <span className="text-xs text-foreground">
            Connected{state.accountName ? ` as ${state.accountName}` : ''} ·{' '}
            {new Date(state.connectedAt).toLocaleDateString()}
          </span>
          <Button size="sm" variant="secondary" onClick={() => void disconnect()}>
            Disconnect
          </Button>
        </div>
      ) : (
        <Button
          size="sm"
          onClick={() => void connect()}
          disabled={state.status === 'connecting'}
        >
          {state.status === 'connecting' ? 'Waiting for your browser…' : 'Connect Canva'}
        </Button>
      )}

      {error && <p className="text-[11px] text-destructive">{error}</p>}

      <p className="text-[11px] text-muted-foreground/70">
        Disconnecting does not remove designs you have already imported —
        those PDFs stay on this computer and keep working offline.
      </p>
    </Card>
  )
}
