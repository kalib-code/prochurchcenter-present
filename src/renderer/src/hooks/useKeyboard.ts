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
 *   Esc                confirmExit
 *
 * Gotcha: we IGNORE key events when the user is typing in an <input>,
 * <textarea>, or contenteditable element. Otherwise pressing Space inside
 * the "Notes" field would advance the slide, which is maddening.
 *
 * Usage:
 *   useKeyboard({ enabled: serviceState.mode === 'running' })
 */

import { useEffect } from 'react'
import { useServiceStore } from '../stores/useServiceStore'

interface UseKeyboardOptions {
  enabled: boolean
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (target.isContentEditable) return true
  return false
}

export function useKeyboard({ enabled }: UseKeyboardOptions): void {
  const {
    nextSlide,
    prevSlide,
    nextItem,
    prevItem,
    toggleBlack,
    toggleLogo,
    toggleCheatSheet,
    exit
  } = useServiceStore()

  useEffect(() => {
    if (!enabled) return

    const handler = (e: KeyboardEvent): void => {
      if (isEditableTarget(e.target)) return

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

        case 'Escape': {
          e.preventDefault()
          const ok = window.confirm('Exit service mode?')
          if (ok) exit()
          break
        }

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
    exit
  ])
}
