/**
 * AppShell — persistent sidebar + inset content panel for every operator
 * screen except Service Mode (which is full-screen by design).
 *
 * Replaces the per-page "← HOME" links: Home, Songs and Settings are
 * always one click away, and upcoming services are listed so the
 * operator can jump straight into next Sunday's setlist.
 */

import { useEffect, useMemo, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { cn } from '../lib/utils'
import { nextSundayISO, todayISO } from '../lib/setlist-helpers'
import { useSetlistStore } from '../stores/useSetlistStore'
import { CalendarIcon, HomeIcon, MusicIcon, PlusIcon, SettingsIcon } from './icons'

const NAV = [
  { to: '/', label: 'Home', icon: HomeIcon, end: true },
  { to: '/library', label: 'Songs', icon: MusicIcon, end: false },
  { to: '/settings', label: 'Settings', icon: SettingsIcon, end: false }
] as const

function shortDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return ''
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function AppShell(): JSX.Element {
  const navigate = useNavigate()
  const setlists = useSetlistStore((s) => s.setlists)
  const load = useSetlistStore((s) => s.load)
  const create = useSetlistStore((s) => s.create)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (setlists.length === 0) void load()
  }, [setlists.length, load])

  // Today and future services, soonest first — what the operator works on.
  const upcoming = useMemo(() => {
    const today = todayISO()
    return setlists
      .filter((s) => s.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 6)
  }, [setlists])

  const handleNew = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      const created = await create({ name: 'New Service', date: nextSundayISO() })
      navigate(`/setlists/${created.id}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-screen w-screen bg-app text-foreground">
      <aside className="flex w-[232px] shrink-0 flex-col px-3 pb-3 pt-4">
        <div className="mb-5 flex items-center gap-2.5 px-2">
          <span
            aria-hidden="true"
            className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-[15px] font-bold text-app"
          >
            P
          </span>
          <div className="leading-tight">
            <div className="text-[15px] font-semibold tracking-[-0.01em]">Present</div>
            <div className="text-[11px] text-muted-foreground">ProChurchCenter</div>
          </div>
        </div>

        <button
          type="button"
          onClick={handleNew}
          disabled={busy}
          className="mb-4 flex h-9 items-center gap-2 rounded-lg border border-border bg-raised px-3 text-[13.5px] font-medium text-foreground transition-colors hover:bg-hover disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
        >
          <PlusIcon size={16} />
          New setlist
        </button>

        <nav className="flex flex-col gap-0.5" aria-label="Main">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] font-medium transition-colors',
                  isActive ? 'bg-hover text-foreground' : 'text-soft hover:bg-raised hover:text-foreground'
                )
              }
            >
              <Icon size={17} />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="mt-6 px-2.5 pb-1.5 text-[12px] font-medium text-muted-foreground">Upcoming</div>
        <div className="scroll-hairline -mx-1 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-1">
          {upcoming.length === 0 && (
            <p className="px-2.5 text-[12.5px] text-dim">No upcoming services</p>
          )}
          {upcoming.map((s) => (
            <NavLink
              key={s.id}
              to={`/setlists/${s.id}`}
              className={({ isActive }) =>
                cn(
                  'group flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13px] transition-colors',
                  isActive ? 'bg-hover text-foreground' : 'text-soft hover:bg-raised hover:text-foreground'
                )
              }
            >
              <CalendarIcon size={15} className="shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{s.name || 'Untitled service'}</span>
              <span className="shrink-0 text-[11.5px] tabular-nums text-muted-foreground">
                {s.date === todayISO() ? 'Today' : shortDate(s.date)}
              </span>
            </NavLink>
          ))}
        </div>
      </aside>

      <main className="my-2 mr-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border/60 bg-panel">
        <Outlet />
      </main>
    </div>
  )
}
