import { useEffect, useState } from 'react'
import { Input } from '../ui/Input'
import { parsePort } from '../../lib/remoteDisplay'

/** Number box that saves on blur/Enter; bad input shows a message and reverts. */
export function PortField({
  id,
  saved,
  onSave,
  error
}: {
  id: string
  saved: number
  onSave: (port: number) => Promise<boolean>
  /** Server-side error from the last save, shown under the box. */
  error?: string | null
}): JSX.Element {
  const [draft, setDraft] = useState(String(saved))
  const [localError, setLocalError] = useState<string | null>(null)

  useEffect(() => setDraft(String(saved)), [saved])

  const commit = async (): Promise<void> => {
    if (draft.trim() === String(saved)) {
      setLocalError(null)
      return
    }
    const port = parsePort(draft)
    if (port === null) {
      setLocalError('Use a number from 1024 to 65535.')
      setDraft(String(saved))
      return
    }
    setLocalError(null)
    if (!(await onSave(port))) setDraft(String(saved))
  }

  const message = localError ?? error ?? null
  return (
    <div className="flex flex-col items-end gap-1">
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={1024}
        max={65535}
        className="w-24 text-right tabular-nums"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
        }}
      />
      {message && (
        <p role="alert" className="max-w-xs text-right text-[12px] text-warn">
          {message}
        </p>
      )}
    </div>
  )
}
