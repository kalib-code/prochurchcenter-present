/**
 * useKeyboard — binds the Service Mode keyboard map to the service store.
 *
 * Frozen map (per BLUEPRINT.md, do not extend without updating docs):
 *
 *   Space / →          nextSlide
 *   Shift+Space / ←    prevSlide
 *   ↓                  nextItem
 *   ↑                  prevItem
 *   B                  toggleBlack
 *   L                  toggleLogo
 *   ?                  toggleCheatSheet
 *   Esc                onExit (confirm + exit + navigate home)
 *
 * While the cheat sheet is open, only ? and Esc (both close it) are live;
 * every other key is swallowed so a volunteer reading the sheet can't
 * change the projector by accident.
 *
 * Gotcha: we IGNORE key events when the user is typing in an <input>,
 * <textarea>, or contenteditable element. Otherwise pressing Space inside
 * the "Notes" field would advance the slide, which is maddening.
 *
 * Usage:
 *   useKeyboard({ enabled: serviceState.mode === 'running', onExit })
 */

import { useEffect } from 'react'
import { useServiceStore } from '../stores/useServiceStore'

interface UseKeyboardOptions {
  enabled: boolean
  /**
   * Must be the SAME confirm+exit+navigate path as the EXIT button.
   * Calling the store's exit() alone leaves ServiceMode mounted in
   * 'idle', and its start effect immediately restarts the service.
   */
  onExit: () => void
}

/** Keys that move the live slide — auto-repeat is ignored for these. */
const NAV_KEYS = new Set([
  ' ',
  'ArrowRight',
  'ArrowLeft',
  'ArrowDown',
  'ArrowUp',
  'PageDown',
  'PageUp'
])

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (target.isContentEditable) return true
  return false
}

export function useKeyboard({ enabled, onExit }: UseKeyboardOptions): void {
  const {
    nextSlide,
    prevSlide,
    nextItem,
    prevItem,
    toggleBlack,
    toggleLogo,
    toggleCheatSheet
  } = useServiceStore()

  useEffect(() => {
    if (!enabled) return

    const handler = (e: KeyboardEvent): void => {
      if (isEditableTarget(e.target)) return

      // Cheat sheet open: ?/Esc close it, everything else is ignored.
      // Read live from the store so the check can't go stale between
      // re-subscriptions.
      const live = useServiceStore.getState().state
      if (live.mode === 'running' && live.showCheatSheet) {
        if (e.key === '?' || e.key === 'Escape') {
          e.preventDefault()
          toggleCheatSheet()
        }
        return
      }

      // OS key auto-repeat must never drive navigation: holding SPACE/→
      // would otherwise race through the setlist and off the end. One
      // physical press = one slide.
      if (e.repeat && NAV_KEYS.has(e.key)) {
        e.preventDefault()
        return
      }

      // Normalize key — Shift+Space is still ' ' with shiftKey true
      switch (e.key) {
        case ' ':
          if (e.shiftKey) {
            e.preventDefault()
            prevSlide()
          } else {
            e.preventDefault()
            nextSlide()
          }
          break

        case 'ArrowRight':
        case 'PageDown':
          e.preventDefault()
          nextSlide()
          break

        case 'ArrowLeft':
        case 'PageUp':
          e.preventDefault()
          prevSlide()
          break

        case 'ArrowDown':
          e.preventDefault()
          nextItem()
          break

        case 'ArrowUp':
          e.preventDefault()
          prevItem()
          break

        case 'b':
        case 'B':
          if (e.metaKey || e.ctrlKey) return // don't hijack Cmd+B / Ctrl+B
          e.preventDefault()
          toggleBlack()
          break

        case 'l':
        case 'L':
          if (e.metaKey || e.ctrlKey) return
          e.preventDefault()
          toggleLogo()
          break

        case '?':
          e.preventDefault()
          toggleCheatSheet()
          break

        case 'Escape':
          e.preventDefault()
          onExit()
          break

        default:
          break
      }
    }

    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [
    enabled,
    nextSlide,
    prevSlide,
    nextItem,
    prevItem,
    toggleBlack,
    toggleLogo,
    toggleCheatSheet,
    onExit
  ])
}
