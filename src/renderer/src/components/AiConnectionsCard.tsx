/**
 * Settings → Connections → AI connections.
 *
 * One switch turns on Present's local MCP server; below it, the address
 * and token an AI tool needs, ready-to-paste setup per tool, and a
 * running log of what AI tools have changed — so the operator always
 * knows where a new sermon deck came from.
 */

import { useEffect, useState } from 'react'
import {
  buildClientSnippets,
  clientLabel,
  type McpClientSnippet,
  type McpState
} from '@shared/mcp'
import { Button } from './ui/Button'
import { Badge } from './ui/Badge'
import { Input } from './ui/Input'
import { Segmented } from './ui/Segmented'
import { Notice, SettingRow, SettingsGroup, Switch } from './settings/SettingsKit'
import { CheckIcon, CopyIcon, RefreshCwIcon } from './icons'

function useMcpState(): [McpState | null, (s: McpState) => void] {
  const [state, setState] = useState<McpState | null>(null)
  useEffect(() => {
    let alive = true
    void window.api.mcp.getState().then((s) => alive && setState(s))
    const off = window.api.mcp.onStateChange(setState)
    return () => {
      alive = false
      off()
    }
  }, [])
  return [state, setState]
}

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }): JSX.Element {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(t)
  }, [copied])
  return (
    <Button
      size="sm"
      variant="secondary"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => setCopied(true))
      }}
    >
      {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
      {copied ? 'Copied' : label}
    </Button>
  )
}

function StatusBadge({ state }: { state: McpState }): JSX.Element {
  switch (state.status) {
    case 'running':
      return <Badge tone="ok">On</Badge>
    case 'starting':
      return <Badge tone="neutral">Starting…</Badge>
    case 'error':
      return <Badge tone="warn">Not running</Badge>
    case 'off':
      return <Badge tone="neutral">Off</Badge>
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  const sameDay = d.toDateString() === new Date().toDateString()
  return sameDay
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export function AiConnectionsCard(): JSX.Element | null {
  const [state, setState] = useMcpState()
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [showToken, setShowToken] = useState(false)
  const [tool, setTool] = useState<McpClientSnippet['id']>('claude-code')
  const [portDraft, setPortDraft] = useState('')

  // Reset the port box whenever the saved port changes (apply, or another
  // window), but not on every state broadcast — that would wipe typing.
  const savedPort = state?.port
  useEffect(() => {
    if (savedPort !== undefined) setPortDraft(String(savedPort))
  }, [savedPort])

  if (!state) return null

  const run = async (fn: () => Promise<McpState>): Promise<void> => {
    setBusy(true)
    setActionError(null)
    try {
      setState(await fn())
    } catch (err) {
      setActionError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err))
    } finally {
      setBusy(false)
    }
  }

  const snippets = buildClientSnippets(state.url, state.token)
  const snippet = snippets.find((s) => s.id === tool) ?? snippets[0]
  const portChanged = portDraft.trim() !== String(state.port)
  const maskedToken = `${state.token.slice(0, 4)}${'•'.repeat(20)}${state.token.slice(-4)}`

  return (
    <div className="space-y-5">
      <SettingsGroup
        title="AI connections"
        description="Let AI assistants on this computer, such as Claude Code and Codex, prepare services for you: add sermon PowerPoints, songs, scripture and section headers to a setlist. They can't control the projector or delete anything."
        action={<StatusBadge state={state} />}
      >
        <SettingRow
          label="Allow AI connections"
          htmlFor="mcp-enabled"
          description="Only apps on this computer can connect, and only with the access token below."
        >
          <Switch
            id="mcp-enabled"
            checked={state.enabled}
            disabled={busy}
            onChange={(e) => void run(() => window.api.mcp.setEnabled(e.target.checked))}
          />
        </SettingRow>

        {(state.error || actionError) && (
          <div className="px-4 py-3">
            <Notice tone="warn">{actionError ?? state.error}</Notice>
          </div>
        )}

        <SettingRow label="Server address" description={<code className="font-mono text-[12px] text-soft">{state.url}</code>}>
          <CopyButton text={state.url} />
        </SettingRow>

        <SettingRow
          label="Access token"
          description={
            <code className="select-all break-all font-mono text-[12px] text-soft">
              {showToken ? state.token : maskedToken}
            </code>
          }
        >
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => setShowToken((v) => !v)}>
              {showToken ? 'Hide' : 'Show'}
            </Button>
            <CopyButton text={state.token} />
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              title="Every connected AI tool will need the new token"
              onClick={() => void run(() => window.api.mcp.regenerateToken())}
            >
              <RefreshCwIcon size={14} />
              New token
            </Button>
          </div>
        </SettingRow>

        <SettingRow
          label="Port"
          htmlFor="mcp-port"
          description="Change this only if another app already uses it."
        >
          <div className="flex items-center gap-2">
            <Input
              id="mcp-port"
              inputMode="numeric"
              className="w-24 text-right tabular-nums"
              value={portDraft}
              onChange={(e) => setPortDraft(e.target.value.replace(/[^\d]/g, ''))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && portChanged) void run(() => window.api.mcp.setPort(Number(portDraft)))
              }}
            />
            {portChanged && (
              <Button size="sm" disabled={busy} onClick={() => void run(() => window.api.mcp.setPort(Number(portDraft)))}>
                Apply
              </Button>
            )}
          </div>
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup
        title="Connect an AI tool"
        description="Pick the tool, copy the setup, and paste it where the hint says. You only do this once per tool."
      >
        <div className="space-y-3 px-4 py-3.5">
          <Segmented
            size="sm"
            options={snippets.map((s) => ({ value: s.id, label: s.label }))}
            value={snippet.id}
            onChange={setTool}
          />
          <div className="flex items-center justify-between gap-3">
            <p className="text-[12.5px] text-muted-foreground">{snippet.hint}</p>
            <CopyButton text={snippet.text} />
          </div>
          <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all rounded-md bg-app p-3 font-mono text-[12px] leading-relaxed text-soft ring-1 ring-border/70">
            {snippet.text}
          </pre>
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">
            Then ask it something like: <span className="text-soft">“Add my sermon deck at ~/Desktop/Sermon.pptx to this Sunday’s service, after the worship songs.”</span>
          </p>
        </div>
      </SettingsGroup>

      <SettingsGroup title="Recent AI activity" description="What AI tools changed since Present opened.">
        {state.activity.length === 0 ? (
          <p className="px-4 py-3.5 text-[12.5px] text-muted-foreground">
            Nothing yet. Changes AI tools make will show up here.
          </p>
        ) : (
          state.activity.map((a, i) => (
            <div key={`${a.at}-${i}`} className="flex items-baseline gap-3 px-4 py-2.5 text-[13px]">
              <span className="w-24 shrink-0 tabular-nums text-muted-foreground">{formatTime(a.at)}</span>
              <span className="min-w-0 flex-1 text-foreground">
                <span className="text-soft">{clientLabel(a.client)}</span> · {a.summary}
              </span>
            </div>
          ))
        )}
      </SettingsGroup>
    </div>
  )
}
