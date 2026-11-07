import {
  describeCommand,
  type RemoteCommand,
  type RemotePosition,
  type RemoteResult,
  type RemoteSource
} from '@shared/remote'
import { useServiceStore } from '../stores/useServiceStore'
import { useRemoteStore } from '../stores/useRemoteStore'
import { findSectionStart } from './remoteSections'

function readPosition(): RemotePosition | null {
  const st = useServiceStore.getState().state
  if (st.mode !== 'running') return null
  const item = st.items[st.itemIndex]
  const slide = item?.slides[st.slideIndex]
  if (!item || !slide) return null
  return {
    itemNumber: st.itemIndex + 1,
    itemCount: st.items.length,
    itemLabel: item.label,
    section: slide.kind === 'text' ? (slide.sectionLabel ?? null) : null,
    slideNumber: st.slideIndex + 1,
    slideCount: item.slides.length,
    display: st.displayMode
  }
}

function run(cmd: RemoteCommand): RemoteResult {
  if (cmd.type === 'status') return { ok: true, position: readPosition() }

  if (useRemoteStore.getState().paused) return { ok: false, reason: 'paused' }

  const svc = useServiceStore.getState()
  const st = svc.state
  if (st.mode !== 'running') return { ok: false, reason: 'no-service' }

  switch (cmd.type) {
    case 'next': svc.autoAdvance(); break // never ends the service
    case 'prev': svc.prevSlide(); break
    case 'nextItem': svc.nextItem(); break
    case 'prevItem': svc.prevItem(); break
    case 'goToItem':
      if (cmd.number < 1 || cmd.number > st.items.length) return { ok: false, reason: 'not-found' }
      svc.jumpTo(cmd.number - 1, 0)
      break
    case 'goToSection': {
      const item = st.items[st.itemIndex]
      if (!item || item.kind !== 'song') return { ok: false, reason: 'not-a-song' }
      const target = findSectionStart(item, st.slideIndex, cmd.section)
      if (target === null) return { ok: false, reason: 'not-found' }
      svc.jumpTo(st.itemIndex, target)
      break
    }
    case 'black': svc.setDisplayMode('black'); break
    case 'logo': svc.setDisplayMode('logo'); break
    case 'live': svc.setDisplayMode('live'); break
  }
  return { ok: true, position: readPosition() }
}

/** Paused rejections are logged at most this often, so a flood can't churn the store. */
const PAUSED_RECORD_EVERY_MS = 1000

let lastPausedRecordAt = -Infinity

/** Forget per-session executor memory (tests; a fresh operator window). */
export function resetRemoteExecutor(): void {
  lastPausedRecordAt = -Infinity
}

/** The single place every remote cue is executed against the Service Mode store. */
export function executeRemoteCommand(
  cmd: RemoteCommand,
  source: RemoteSource,
  from: string | null,
  now: number = Date.now()
): RemoteResult {
  const result = run(cmd)
  if (cmd.type === 'status') return result
  if (!result.ok && result.reason === 'paused') {
    if (now - lastPausedRecordAt < PAUSED_RECORD_EVERY_MS) return result
    lastPausedRecordAt = now
  }
  useRemoteStore.getState().record({
    at: new Date(now).toISOString(),
    source,
    from,
    summary: describeCommand(cmd),
    result
  })
  return result
}
