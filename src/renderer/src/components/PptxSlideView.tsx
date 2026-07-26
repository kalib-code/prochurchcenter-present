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
 * Why the host is NEVER hidden (no whole-container visibility gate):
 *   An earlier version of this component pre-emptively set the host's
 *   opacity to 0 at the start of every render, on the theory that it would
 *   be flipped back to 1 once the new slide was ready. That's exactly
 *   backwards: on a render FAILURE nothing ever flips it back, so the
 *   previous slide — still sitting untouched in the DOM — goes invisible
 *   behind opacity:0. The projector would go dark on every render failure,
 *   the opposite of this component's one job. Instead, entrance animation
 *   is applied only to the NEW element at the moment it is swapped in (see
 *   `host.replaceChildren` below), mirroring PdfPageView's canvas-level
 *   fade. The host itself carries no opacity state and is never touched by
 *   the failure path, so whatever was on screen before stays on screen.
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
 *   - A handle that DOES get swapped in is tracked in `currentHandleRef`,
 *     assigned only AFTER the DOM swap succeeds so the ref can never point
 *     at an element that was never attached. The next successful render
 *     disposes it right after committing its replacement.
 *   - On real unmount (not just a prop change), a dedicated mount-once
 *     effect disposes whatever is currently displayed.
 */

import { useEffect, useRef } from 'react'
import type { PresentationData, SlideHandle } from '@aiden0z/pptx-renderer'
import { ordinalToSourceIndex } from '@shared/pptxSlides'
import { loadPptxDeck, type PptxDeck } from '../lib/pptxLoader'

/**
 * Stable failure bucket, independent of the human-readable message text.
 *
 * Why this exists as a separate field rather than callers classifying the
 * message string themselves: a caller that mounts many PptxSlideView
 * instances at once (e.g. Service Mode's slide grid — one instance per
 * slide of a deck) needs to dedupe/group failures per deck rather than
 * per slide. Grouping by the rendered message text seems to work for a
 * totally-unreadable file (loadPptxDeck's error doesn't vary per slide),
 * but breaks for an out-of-range ordinal: that message embeds the ordinal
 * itself ("Slide 7 is missing..."), so every failing slide produces a
 * distinct string and none of them collapse. Classifying at the throw
 * site — where we already know exactly *why* it failed — avoids ever
 * having to reverse-engineer a bucket out of rendered text (a regex over
 * the message would silently break the next time the wording changes).
 *
 * 'partial-render' vs 'render-failed': renderSlide() catches per-node
 * errors (bad image, unsupported shape) INTERNALLY and paints a
 * placeholder instead of throwing — the slide finishes rendering
 * successfully, just with holes in it. That's a materially different,
 * and far more common, failure than 'render-failed' (renderSlide()
 * itself throwing on malformed slide XML): the operator needs to know
 * the slide drew but may be missing content, not that nothing drew at
 * all. Routed from onNodeError below.
 */
export type PptxSlideErrorKind =
  | 'file-unreadable'
  | 'slide-out-of-range'
  | 'render-failed'
  | 'partial-render'

/** Internal — carries a stable `kind` alongside the human-readable message. */
class PptxSlideError extends Error {
  constructor(
    message: string,
    readonly kind: PptxSlideErrorKind
  ) {
    super(message)
  }
}

interface Props {
  pptxPath: string
  /** 1-based over visible slides. */
  slideOrdinal: number
  animate: boolean
  transitionDurationMs: number
  useFade: boolean
  /**
   * Called when this slide cannot render, with a human-readable reason
   * plus a stable classification (see PptxSlideErrorKind) a caller can
   * key on instead of the message text.
   */
  onError?: (message: string, kind: PptxSlideErrorKind) => void
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

  // Scale a given slide element to contain-fit the host, centered.
  // Transforms don't change layout box size, so the flex-centered host still
  // centers the (unscaled) footprint — the visual scale just shrinks/grows
  // around that same center point.
  //
  // Takes the element/size explicitly rather than always reading from
  // currentHandleRef: at the moment a new slide is swapped into the DOM,
  // currentHandleRef.current still points at the PREVIOUS handle (it is
  // deliberately committed only after the swap succeeds — see the
  // disposal-lifecycle note atop this file). Scaling via the ref at that
  // moment would transform a detached node and leave the newly-attached
  // element completely unscaled — every slide would then project at raw
  // deck pixel size. Callers that need to re-fit whatever is CURRENTLY
  // committed and on screen (e.g. the resize observer below) go through
  // `applyFit()`, which reads the ref; the initial swap goes through
  // `applyFitTo()` directly with the just-created handle.
  const applyFitTo = (element: HTMLElement, size: { width: number; height: number }): void => {
    const host = hostRef.current
    if (!host) return
    const scaleX = host.clientWidth / size.width
    const scaleY = host.clientHeight / size.height
    const scale = Math.min(scaleX, scaleY)
    if (!Number.isFinite(scale) || scale <= 0) return
    element.style.transform = `scale(${scale})`
    element.style.transformOrigin = 'center center'
  }

  const applyFit = (): void => {
    const handle = currentHandleRef.current
    const size = deckSizeRef.current
    if (!handle || !size) return
    applyFitTo(handle.element, size)
  }

  // Dispose whatever's on screen when this component is truly unmounted
  // (not just re-rendered for a new slide/path — that path disposes the old
  // handle itself right after committing its replacement).
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

    void (async () => {
      try {
        let deck: PptxDeck
        try {
          deck = await loadPptxDeck(pptxPath)
        } catch (err) {
          // Reclassify as 'file-unreadable' right here, before anything
          // ordinal-related runs — this is the only place that failure
          // can originate, so there's no ambiguity to resolve later.
          throw new PptxSlideError(
            err instanceof Error ? err.message : 'Could not read this PowerPoint file.',
            'file-unreadable'
          )
        }
        if (cancelled) return

        const sourceIndex = ordinalToSourceIndex(deck.slides, slideOrdinal)
        if (sourceIndex === null) {
          throw new PptxSlideError(
            `Slide ${slideOrdinal} is missing — the file may have been replaced with a shorter one.`,
            'slide-out-of-range'
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
          throw new PptxSlideError(
            `Slide ${slideOrdinal} could not be located in the parsed presentation.`,
            'slide-out-of-range'
          )
        }

        // Reported at most once per render pass — renderSlide() can call
        // this once per broken shape/image on the slide, and the operator
        // needs one actionable line, not a flood of identical banners.
        // The (pptxPath, kind) dedupe in ServiceMode's deckWarnings collapses
        // repeats across renders/slides too, but that dedupe only sees what
        // we actually send it, so we still gate here to avoid firing
        // onError N times in a single pass.
        let partialRenderReported = false

        // renderSlide() is synchronous, so `cancelled` cannot have flipped
        // between the check above and here — no gap for cleanup to run in.
        const handle = renderSlide(presentation, slideData, {
          onNodeError: (nodeId, nodeErr) => {
            console.error('[PptxSlideView] node render failed', pptxPath, nodeId, nodeErr)
            // renderSlide() swallows this internally and paints a
            // placeholder instead of throwing, so the slide still renders
            // "successfully" — with a hole in it. Route it to onError so
            // it's not silently invisible to the operator (see
            // PptxSlideErrorKind's 'partial-render' doc comment). Wording
            // is deliberately vague about *what* broke (no node id, no
            // stack trace) — a volunteer can't act on either, but "parts
            // may be missing" tells them to glance at the slide.
            if (partialRenderReported) return
            partialRenderReported = true
            onError?.(
              'This slide drew, but part of it may be missing (an image or shape failed to render).',
              'partial-render'
            )
          }
        })
        inFlightHandle = handle

        // `ready` only covers slower fallback work (e.g. EMF-embedded PDF
        // pages). Verified against the library's source: it's built from
        // `Promise.allSettled(asyncTasks).then(() => {})`, and every task
        // pushed into that list is itself wrapped so its own rejections are
        // caught internally — so this promise settles in practice and never
        // rejects. No timeout guard is needed here.
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

        inFlightHandle = null
        const deckSize = { width: deck.width, height: deck.height }
        deckSizeRef.current = deckSize

        // Fade-in (if enabled) applies only to this NEW element, at the
        // moment it's inserted. The host is never hidden, so a later
        // failure has nothing to leave dark — whatever is on screen when
        // this swap happens stays on screen until the next successful one.
        if (useFade && animate) {
          handle.element.style.opacity = '0'
        }
        host.replaceChildren(handle.element)
        // Scale THIS element directly — currentHandleRef.current still
        // points at the previous (or, on the first slide, no) handle at
        // this point, so applyFit() would be a no-op or would transform
        // the wrong node. See applyFitTo's doc comment above.
        applyFitTo(handle.element, deckSize)
        if (useFade && animate) {
          // Force a style recalc so the browser commits the opacity:0
          // starting point as a distinct frame before we flip to 1 —
          // otherwise the two writes coalesce and no transition plays.
          void handle.element.offsetHeight
          handle.element.style.transition = `opacity ${transitionDurationMs}ms ease`
          handle.element.style.opacity = '1'
        }

        // Commit to currentHandleRef only now that the swap has actually
        // happened, then free the slide it replaced.
        const previousHandle = currentHandleRef.current
        currentHandleRef.current = handle
        previousHandle?.dispose()
      } catch (err) {
        // Whether or not we were cancelled, a handle created in this pass
        // that never got committed would otherwise leak its resources.
        inFlightHandle?.dispose()
        inFlightHandle = null
        if (cancelled) return
        const message = err instanceof Error ? err.message : 'Could not render this slide.'
        // Anything that isn't one of our own classified throws (deck load,
        // out-of-range ordinal) is an unclassified render-time failure —
        // e.g. renderSlide() itself throwing on malformed slide XML.
        const kind: PptxSlideErrorKind =
          err instanceof PptxSlideError ? err.kind : 'render-failed'
        console.error('[PptxSlideView]', pptxPath, slideOrdinal, err)
        // Deliberately leave the DOM alone — the previous slide stays up.
        onError?.(message, kind)
      }
    })()

    return () => {
      cancelled = true
      inFlightHandle?.dispose()
    }
  }, [pptxPath, slideOrdinal, animate, useFade, transitionDurationMs, onError])

  return (
    <div
      ref={hostRef}
      className="relative flex h-full w-full items-center justify-center overflow-hidden"
    />
  )
}
