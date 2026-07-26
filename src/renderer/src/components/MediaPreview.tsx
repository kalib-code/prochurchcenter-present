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
 * A 120 × 72 px box (classic 16:9 thumbnail aspect) is the default.
 * Override via the `className` prop if a caller wants bigger.
 *
 * Loading + error states are inline placeholders — no skeleton library.
 */

import { useEffect, useRef, useState } from 'react'
import { cn } from '../lib/utils'
import { loadPdfDocument } from '../lib/pdfLoader'

function fileUrl(path: string): string {
  return `present-media://local${encodeURI(path)}`
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

interface MediaPreviewProps {
  source: Source
  className?: string
}

export function MediaPreview({
  source,
  className
}: MediaPreviewProps): JSX.Element {
  return (
    <div
      className={cn(
        'relative flex h-[72px] w-[120px] shrink-0 items-center justify-center overflow-hidden border border-border/50 bg-black',
        className
      )}
    >
      {source.kind === 'image' && <ImageThumb path={source.path} />}
      {source.kind === 'video' && <VideoThumb path={source.path} />}
      {source.kind === 'deck' && (
        <PdfThumb pdfPath={source.pdfPath} pageIndex={source.pageIndex ?? 1} />
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
      <div className="pointer-events-none absolute bottom-1 right-1 rounded bg-black/70 px-1 py-[1px] text-[9px] font-semibold uppercase tracking-wide text-white/90">
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
      <div className="pointer-events-none absolute bottom-1 right-1 rounded bg-black/70 px-1 py-[1px] text-[9px] font-semibold uppercase tracking-wide text-white/90">
        pdf
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
