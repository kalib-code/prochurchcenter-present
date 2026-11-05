/**
 * MediaPreview — aspect-stable thumbnail for image / video / deck items
 * used inside the SetlistEditor so Ate Rose can scan her service plan
 * visually before starting.
 *
 * Three kinds, three strategies:
 *
 *   - image: native <img> with object-contain
 *
 *   - video: <video muted preload="metadata"> pointed at `url#t=0.1`.
 *     The `#t=0.1` fragment tells the browser to seek to 0.1s on load,
 *     which reliably paints the first frame on Chromium/Electron. We
 *     don't play — the preview is intentionally frozen so the
 *     operator sees content without burning CPU.
 *
 *   - deck: pdfjs-dist page 1 rasterized to a fresh off-DOM canvas.
 *     Uses the same module-level document cache as the full-size
 *     renderer, so ten deck items pointing at the same PDF hit it once.
 *     We render at device pixel ratio capped at 1.5 for thumbnails —
 *     sharper than 1.0, cheaper than 2.0.
 *
 *   - pptx: a live PptxSlideView scaled into the thumbnail box, same
 *     idea as the `deck` case but for PowerPoint decks rendered
 *     directly (no PDF export step). Uses the same module-level parse
 *     cache as the projector (pptxLoader.ts), so many pptx thumbnails
 *     pointing at the same file only parse it once.
 *
 * A 120 × 72 px box (classic 16:9 thumbnail aspect) is the default.
 * Override via the `className` prop if a caller wants bigger.
 *
 * Loading + error states are inline placeholders — no skeleton library.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '../lib/utils'
import { loadPdfDocument } from '../lib/pdfLoader'
import PptxSlideView, { type PptxSlideErrorKind } from './PptxSlideView'
import { toMediaUrl } from '@shared/mediaUrl'

function fileUrl(path: string): string {
  // Shared encoder: encodeURI left `#`/`?` raw, breaking "Song #2.mp4".
  return toMediaUrl(path)
}

type Source =
  | { kind: 'image'; path: string }
  | { kind: 'video'; path: string }
  /**
   * PDF deck source. `pageIndex` is 1-based and matches pdf.js semantics.
   * Omitted → defaults to page 1 (what the SetlistEditor uses for a
   * single-thumbnail-per-deck preview).
   */
  | { kind: 'deck'; pdfPath: string; pageIndex?: number }
  /**
   * Live PowerPoint slide source. `slideOrdinal` is 1-based over VISIBLE
   * slides — same convention as the projector (see @shared/pptxSlides).
   */
  | { kind: 'pptx'; pptxPath: string; slideOrdinal: number }

/**
 * A `pptx` thumbnail's render failure, reported as structured fields
 * rather than one pre-composed string. Deliberately NOT a plain message:
 * a single broken deck fails on every one of its N slides simultaneously
 * (each slide is its own PptxThumb instance), and a caller that only gets
 * a string with the ordinal already baked in (e.g. "file.pptx — slide 7:
 * ...") has no way to dedupe those N failures into one line — they're all
 * distinct strings. Handing back the raw pieces lets the caller (e.g.
 * ServiceMode) group by `pptxPath` and decide how to summarize.
 *
 * `kind` is PptxSlideView's stable classification (see its doc comment) —
 * use THIS for dedup/grouping keys, not `reason`. `reason` embeds
 * slide-specific detail (e.g. the failing ordinal) for a few of the
 * possible failures, so two different slides of the same broken deck can
 * have distinct `reason` strings while sharing the same `kind`.
 */
export interface PptxThumbError {
  pptxPath: string
  slideOrdinal: number
  reason: string
  kind: PptxSlideErrorKind
}

interface MediaPreviewProps {
  source: Source
  className?: string
  /**
   * Fires when the `pptx` source fails to render (PptxSlideView's onError
   * contract). This is how a per-slide render failure — corrupt slide
   * XML, an unsupported node — reaches the operator instead of dying
   * silently in a console.error. Ignored for every other source kind.
   * Callers that have nowhere to route it (e.g. the setlist editor,
   * which has no live-service warning strip) can omit it — the
   * thumbnail still falls back to a local error placeholder either way.
   */
  onError?: (error: PptxThumbError) => void
}

export function MediaPreview({
  source,
  className,
  onError
}: MediaPreviewProps): JSX.Element {
  return (
    <div
      className={cn(
        // Deliberately square: the project's binding constraint is zero
        // border radius everywhere outside SlideRenderer.tsx and the
        // output views. Every consumer (SetlistEditor's list thumbnails,
        // Service Mode's SlideCard grid) relies on this default — do NOT
        // reintroduce any Tailwind border-radius utility here, and
        // consumers should not need a cancelling override to undo one.
        'relative flex h-[72px] w-[120px] shrink-0 items-center justify-center overflow-hidden border border-border/50 bg-black',
        className
      )}
    >
      {source.kind === 'image' && <ImageThumb path={source.path} />}
      {source.kind === 'video' && <VideoThumb path={source.path} />}
      {source.kind === 'deck' && (
        <PdfThumb pdfPath={source.pdfPath} pageIndex={source.pageIndex ?? 1} />
      )}
      {source.kind === 'pptx' && (
        <PptxThumb
          pptxPath={source.pptxPath}
          slideOrdinal={source.slideOrdinal}
          onError={onError}
        />
      )}
    </div>
  )
}

// ─── Image ────────────────────────────────────────────────────────────

function ImageThumb({ path }: { path: string }): JSX.Element {
  const [errored, setErrored] = useState(false)
  if (errored) return <Placeholder label="image" />
  return (
    <img
      src={fileUrl(path)}
      alt=""
      onError={() => setErrored(true)}
      draggable={false}
      className="max-h-full max-w-full object-contain"
    />
  )
}

// ─── Video ────────────────────────────────────────────────────────────

function VideoThumb({ path }: { path: string }): JSX.Element {
  // `#t=0.1` tells the browser to seek on load — crucial for painting
  // the first frame without autoplay on most codecs.
  const src = `${fileUrl(path)}#t=0.1`
  const [errored, setErrored] = useState(false)
  if (errored) return <Placeholder label="video" />
  return (
    <div className="relative h-full w-full">
      <video
        src={src}
        muted
        playsInline
        preload="metadata"
        onError={() => setErrored(true)}
        className="h-full w-full object-cover"
      />
      {/* Play-glyph badge so the operator immediately reads this as
          "video" rather than "weird static image" */}
      <div className="pointer-events-none absolute bottom-1 right-1 bg-black/70 px-1 py-[1px] text-[9px] font-semibold uppercase tracking-wide text-white/90">
        ▶ video
      </div>
    </div>
  )
}

// ─── PDF deck ─────────────────────────────────────────────────────────

function PdfThumb({
  pdfPath,
  pageIndex
}: {
  pdfPath: string
  pageIndex: number
}): JSX.Element {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [rendered, setRendered] = useState(false)

  useEffect(() => {
    setError(null)
    setRendered(false)
    const wrapper = wrapperRef.current
    if (!wrapper) return

    let cancelled = false
    let currentRenderTask: { cancel: () => void } | null = null

    const doRender = async (): Promise<void> => {
      try {
        const doc = await loadPdfDocument(pdfPath)
        if (cancelled) return
        const page = await doc.getPage(pageIndex)
        if (cancelled) return

        const rect = wrapper.getBoundingClientRect()
        const availW = rect.width
        const availH = rect.height
        if (availW === 0 || availH === 0) return

        const unscaled = page.getViewport({ scale: 1 })
        const scale = Math.min(availW / unscaled.width, availH / unscaled.height)
        const viewport = page.getViewport({ scale })

        // Thumbnails don't need full device pixel ratio — 1.5 is plenty
        // sharper than 1 without eating memory if the setlist has
        // many deck items.
        const dpr = Math.min(window.devicePixelRatio || 1, 1.5)

        const canvas = document.createElement('canvas')
        canvas.width = Math.floor(viewport.width * dpr)
        canvas.height = Math.floor(viewport.height * dpr)
        canvas.style.width = `${viewport.width}px`
        canvas.style.height = `${viewport.height}px`
        canvas.className = 'max-h-full max-w-full'
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

        const renderTask = page.render({
          canvasContext: ctx,
          viewport,
          canvas
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any)
        currentRenderTask = renderTask as unknown as { cancel: () => void }
        await renderTask.promise
        if (cancelled) return

        while (wrapper.firstChild) wrapper.removeChild(wrapper.firstChild)
        wrapper.appendChild(canvas)
        setRendered(true)
      } catch (err) {
        if (cancelled) return
        const name = (err as { name?: string } | null)?.name ?? ''
        if (name === 'RenderingCancelledException') return
        setError(err instanceof Error ? err.message : 'render failed')
      }
    }

    void doRender()

    return () => {
      cancelled = true
      currentRenderTask?.cancel()
    }
  }, [pdfPath, pageIndex])

  if (error) return <Placeholder label="pdf" />

  return (
    <div className="relative h-full w-full">
      <div ref={wrapperRef} className="flex h-full w-full items-center justify-center" />
      {!rendered && (
        <div className="absolute inset-0 flex items-center justify-center text-[9px] uppercase tracking-wider text-muted-foreground/80">
          loading…
        </div>
      )}
      <div className="pointer-events-none absolute bottom-1 right-1 bg-black/70 px-1 py-[1px] text-[9px] font-semibold uppercase tracking-wide text-white/90">
        pdf
      </div>
    </div>
  )
}

// ─── PowerPoint slide ─────────────────────────────────────────────────

/**
 * PptxThumb — thumbnail wrapper around PptxSlideView.
 *
 * Why a wrapper instead of using PptxSlideView directly: three things
 * need layering on top of the raw renderer —
 *
 *   1. A local error placeholder, same visual contract as PdfThumb/
 *      VideoThumb, so a failed thumbnail reads as "pptx" + blank rather
 *      than a half-drawn slide.
 *   2. Bubbling the failure to the caller as structured fields (not a
 *      pre-composed string) so a caller with many of these mounted at
 *      once — Service Mode's "All Slides" grid, one PptxThumb per slide
 *      — can dedupe/group by `(pptxPath, kind)` instead of getting one
 *      distinct message per slide. See `PptxThumbError`'s doc comment.
 *   3. Deferred mounting (below) so a long deck doesn't pay for every
 *      slide's render up front.
 *
 * Callback stability (critical): `onError` sits in PptxSlideView's effect
 * dependency array (see PptxSlideView.tsx). A new function identity on
 * every render would cancel the in-flight parse/render and restart it —
 * repeatedly, mid-service, for a card that never actually changed. The
 * `useCallback` below only produces a new identity if pptxPath,
 * slideOrdinal, or the caller's `onError` reference changes — none of
 * which happen on a normal parent re-render (grid cards are stably keyed
 * by item/slide index, and callers pass a `useCallback`'d function with
 * no deps of their own).
 *
 * Deferred mount (thumbnail cost): Service Mode's "All Slides" grid is
 * unvirtualized — every slide in the service gets its own card, all
 * mounted at once. Unlike PdfThumb (one canvas raster), each pptx
 * thumbnail calls the real `renderSlide()`, building a fixed-dimension
 * DOM subtree and, for chart-bearing slides, a whole ECharts instance.
 * A 60-slide deck would otherwise mean 60 of those simultaneously the
 * moment Service Mode starts. We defer actually mounting PptxSlideView
 * until this card is within `rootMargin` of the viewport, so a long
 * deck's off-screen slides stay as a cheap static "pptx" label until
 * the operator scrolls near them. `loadPptxDeck`'s cache means the
 * parse itself still only happens once regardless of how many
 * thumbnails eventually mount.
 */
function PptxThumb({
  pptxPath,
  slideOrdinal,
  onError
}: {
  pptxPath: string
  slideOrdinal: number
  onError?: (error: PptxThumbError) => void
}): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [inView, setInView] = useState(false)
  const [errored, setErrored] = useState(false)

  useEffect(() => {
    setErrored(false)
  }, [pptxPath, slideOrdinal])

  useEffect(() => {
    if (inView) return
    const el = containerRef.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      setInView(true)
      return
    }

    // An IntersectionObserver only delivers callbacks as part of the
    // document's rendering lifecycle, and a HIDDEN document does not run
    // one — so on a hidden page this observer would sit armed and silent,
    // and the thumbnail would never mount at all.
    //
    // That is not a hypothetical: on a single-display setup the projector
    // window covers the operator window (Service Mode's own preflight warns
    // about exactly this), so the operator document is hidden for the whole
    // time the slide grid is mounting. Every pptx card in the grid stayed a
    // bare "pptx" badge on a black body, which is precisely the "previews
    // don't work" report this guard exists to prevent.
    //
    // Deferring is a cost optimisation; being invisible is a correctness
    // bug. When the document is hidden there is no meaningful on-screen /
    // off-screen distinction to exploit anyway — nothing is being painted —
    // so mount and let the parse cache absorb the cost.
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      setInView(true)
      return
    }

    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setInView(true)
      },
      // Generous margin so scrolling feels instant — a card is already
      // live well before it reaches the visible area.
      { rootMargin: '600px 0px' }
    )
    io.observe(el)

    // Re-run this effect when the page's visibility flips, so a grid that
    // mounted while visible and was then covered (operator switches to the
    // projector and back) still resolves rather than waiting on a callback
    // the hidden lifecycle will not deliver.
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') setInView(true)
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      io.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [inView])

  const handleError = useCallback(
    (reason: string, kind: PptxSlideErrorKind) => {
      // A partial render is NOT a failed thumbnail. renderSlide catches
      // per-node errors internally and appends a placeholder, so the slide
      // still drew — just with a hole where one shape or image should be.
      // Falling back to the grey "pptx" box here would replace a mostly
      // correct thumbnail with nothing, which is exactly backwards: the
      // operator needs to SEE the slide to judge whether the hole matters.
      // Still report it upward so the warning banner mentions it.
      if (kind !== 'partial-render') setErrored(true)
      onError?.({ pptxPath, slideOrdinal, reason, kind })
    },
    [pptxPath, slideOrdinal, onError]
  )

  return (
    <div ref={containerRef} className="relative h-full w-full">
      {errored ? (
        <Placeholder label="pptx" />
      ) : inView ? (
        <PptxSlideView
          pptxPath={pptxPath}
          slideOrdinal={slideOrdinal}
          animate={false}
          transitionDurationMs={0}
          useFade={false}
          onError={handleError}
        />
      ) : null}
      {/* Bottom-right badge is the only "pptx" label while off-screen —
          avoids showing the word twice in one small thumbnail. */}
      <div className="pointer-events-none absolute bottom-1 right-1 bg-black/70 px-1 py-[1px] text-[9px] font-semibold uppercase tracking-wide text-white/90">
        pptx
      </div>
    </div>
  )
}

// ─── Placeholder ──────────────────────────────────────────────────────

function Placeholder({ label }: { label: string }): JSX.Element {
  return (
    <div className="flex h-full w-full items-center justify-center text-[9px] uppercase tracking-wider text-muted-foreground/60">
      {label}
    </div>
  )
}
