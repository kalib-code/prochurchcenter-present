/**
 * Renders one slide of a live PowerPoint deck into the projector.
 *
 * Sibling of PdfPageView (see SlideRenderer.tsx): same detached-render-then-
 * swap pattern, same fade/transition props, same "a failure leaves the
 * previous slide on screen" contract. The rendering mechanics differ because
 * @aiden0z/pptx-renderer's `renderSlide` is a different shape than pdf.js:
 *
 *   - It is SYNCHRONOUS. It returns a `SlideHandle` immediately: `element`
 *     (a fully-built, fixed-pixel-size <div>), `ready` (a promise that only
 *     covers slower fallback work — e.g. EMF-embedded PDF pages — and never
 *     rejects), and `dispose()` (frees chart instances / blob URLs owned by
 *     that slide).
 *   - It takes the resolved `SlideData` object, not a bare index, and does
 *     NOT take a container — the caller inserts `element` itself.
 *   - `element` is sized to the deck's native pixel dimensions (e.g.
 *     1280x720), not to our container. We scale it to fit with a CSS
 *     transform, same contain-fit idea as PdfPageView's canvas sizing.
 *
 * Why we still wait for `handle.ready` before swapping in:
 *   The base slide is already fully drawn synchronously, but a deck with an
 *   EMF-embedded PDF fallback keeps filling in after `renderSlide` returns.
 *   Waiting avoids swapping in a slide that visibly finishes rendering after
 *   it's already on screen.
 *
 * Why a failure renders nothing:
 *   Leaving the DOM untouched leaves the PREVIOUS slide on screen. The
 *   congregation sees no glitch; the operator gets the message via onError
 *   and decides whether to skip. Going black would be unambiguous but costs
 *   a visible dead beat in the middle of a service.
 *
 * Disposal lifecycle (SlideHandle owns chart instances and blob URLs):
 *   - A handle that never gets swapped in (superseded by a faster slide
 *     change, or the component unmounted mid-render) is disposed in the
 *     effect cleanup — nothing else references it, so nothing else would
 *     free it.
 *   - A handle that DOES get swapped in is tracked in `currentHandleRef`.
 *     The next successful render disposes it right before replacing it.
 *   - On real unmount (not just a prop change), a dedicated mount-once
 *     effect disposes whatever is currently displayed.
 */

import { useEffect, useRef, useState } from 'react'
import type { PresentationData, SlideHandle } from '@aiden0z/pptx-renderer'
import { ordinalToSourceIndex } from '@shared/pptxSlides'
import { loadPptxDeck } from '../lib/pptxLoader'

interface Props {
  pptxPath: string
  /** 1-based over visible slides. */
  slideOrdinal: number
  animate: boolean
  transitionDurationMs: number
  useFade: boolean
  /** Called with a human-readable reason when this slide cannot render. */
  onError?: (message: string) => void
}

export default function PptxSlideView({
  pptxPath,
  slideOrdinal,
  animate,
  transitionDurationMs,
  useFade,
  onError
}: Props): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null)
  // The handle currently swapped into the DOM, so we know what to dispose
  // when it's replaced (or when this component unmounts).
  const currentHandleRef = useRef<SlideHandle | null>(null)
  // Native pixel size of the currently-displayed slide, cached so the resize
  // observer can recompute the fit scale without re-rendering anything.
  const deckSizeRef = useRef<{ width: number; height: number } | null>(null)
  const [visible, setVisible] = useState(!animate)

  // Scale the displayed slide element to contain-fit the host, centered.
  // Transforms don't change layout box size, so the flex-centered host still
  // centers the (unscaled) footprint — the visual scale just shrinks/grows
  // around that same center point.
  const applyFit = (): void => {
    const host = hostRef.current
    const handle = currentHandleRef.current
    const size = deckSizeRef.current
    if (!host || !handle || !size) return
    const scaleX = host.clientWidth / size.width
    const scaleY = host.clientHeight / size.height
    const scale = Math.min(scaleX, scaleY)
    if (!Number.isFinite(scale) || scale <= 0) return
    handle.element.style.transform = `scale(${scale})`
    handle.element.style.transformOrigin = 'center center'
  }

  // Dispose whatever's on screen when this component is truly unmounted
  // (not just re-rendered for a new slide/path — that path disposes the old
  // handle itself right before committing the new one).
  useEffect(() => {
    return () => {
      currentHandleRef.current?.dispose()
      currentHandleRef.current = null
    }
  }, [])

  // Re-fit on container resize (display swap, window resize) without
  // re-rendering the slide itself.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const ro = new ResizeObserver(() => applyFit())
    ro.observe(host)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    let cancelled = false
    // Tracks a handle that has been created but not yet committed to
    // currentHandleRef — if this effect is cancelled before the commit,
    // this is the only reference to it, so cleanup must dispose it here.
    let inFlightHandle: SlideHandle | null = null
    setVisible(!animate)

    void (async () => {
      try {
        const deck = await loadPptxDeck(pptxPath)
        if (cancelled) return

        const sourceIndex = ordinalToSourceIndex(deck.slides, slideOrdinal)
        if (sourceIndex === null) {
          throw new Error(
            `Slide ${slideOrdinal} is missing — the file may have been replaced with a shorter one.`
          )
        }

        const { renderSlide } = await import('@aiden0z/pptx-renderer')
        if (cancelled) return

        // Narrow cast: pptxLoader deliberately types `presentation` as
        // unknown so it stays the only module that knows the library's
        // real shape. We know it's a PresentationData because pptxLoader
        // builds it via buildPresentation() from the same library.
        const presentation = deck.presentation as PresentationData
        const slideData = presentation.slides[sourceIndex - 1]
        if (!slideData) {
          throw new Error(
            `Slide ${slideOrdinal} could not be located in the parsed presentation.`
          )
        }

        // renderSlide() is synchronous, so `cancelled` cannot have flipped
        // between the check above and here — no gap for cleanup to run in.
        const handle = renderSlide(presentation, slideData, {
          onNodeError: (nodeId, nodeErr) =>
            console.error('[PptxSlideView] node render failed', pptxPath, nodeId, nodeErr)
        })
        inFlightHandle = handle

        // `ready` only covers slower fallback work (e.g. EMF-embedded PDF
        // pages) and never rejects — it's a Promise.allSettled internally.
        await handle.ready
        if (cancelled) {
          handle.dispose()
          inFlightHandle = null
          return
        }

        const host = hostRef.current
        if (!host) {
          handle.dispose()
          inFlightHandle = null
          return
        }

        // The slide we're replacing is done being shown; free its chart
        // instances / blob URLs before handing off to the new one.
        currentHandleRef.current?.dispose()
        currentHandleRef.current = handle
        inFlightHandle = null
        deckSizeRef.current = { width: deck.width, height: deck.height }

        host.replaceChildren(handle.element)
        applyFit()
        setVisible(true)
      } catch (err) {
        // Whether or not we were cancelled, a handle created in this pass
        // that never got committed would otherwise leak its resources.
        inFlightHandle?.dispose()
        inFlightHandle = null
        if (cancelled) return
        const message = err instanceof Error ? err.message : 'Could not render this slide.'
        console.error('[PptxSlideView]', pptxPath, slideOrdinal, err)
        // Deliberately leave the DOM alone — the previous slide stays up.
        onError?.(message)
      }
    })()

    return () => {
      cancelled = true
      inFlightHandle?.dispose()
    }
  }, [pptxPath, slideOrdinal, animate, onError])

  return (
    <div
      ref={hostRef}
      className="relative flex h-full w-full items-center justify-center overflow-hidden"
      style={{
        opacity: visible ? 1 : 0,
        transition: useFade ? `opacity ${transitionDurationMs}ms ease` : 'none'
      }}
    />
  )
}
