/**
 * SlideRenderer — the one component that knows how to visually render
 * a SlidePayload. Used in three places now:
 *
 *   1. Output window (fullscreen, real projector output)
 *   2. Service Mode confidence monitor (scaled-down but same layout)
 *   3. Settings theme editor live preview
 *
 * All three mount this with different container sizes and different
 * themes; the auto-fit math handles the rest.
 *
 * Theme pipeline (Phase 5):
 *   A `theme?: Theme` prop drives every visual property — background
 *   color/image, text color, font family, alignment/position, effects,
 *   and transition duration. When omitted, the fallback matches the
 *   DEFAULT_THEME in main/storage/theme.ts (black bg, white centered
 *   system-ui text, 200ms fade).
 *
 *   Why duplicate the defaults here rather than importing from main?
 *   Keeps the renderer bundle free of Node imports. The default is
 *   small and the two copies will only ever be touched together.
 *
 * Auto-fit scaling:
 *
 *   We start at a base font size (fraction of the container's smaller
 *   dimension, scaled by `theme.fontSizePercent`), measure the content's
 *   true size, then compute the exact ratio needed to fit both dimensions
 *   and scale once. A short verify pass handles the one case where the
 *   one-shot undershoots: when shrinking the font un-wraps a line,
 *   reducing total height more than linearly.
 *
 *   Why not CSS `font-size: clamp()` + `min-height: 0`? Because clamp
 *   doesn't know about line-wrap overflow, and we have unpredictable
 *   line lengths (a one-word lyric vs a long run-on English/Tagalog line).
 */

import { useLayoutEffect, useRef, useState, useEffect, type CSSProperties } from 'react'
import type { SlidePayload, VideoControl } from '@shared/ipc-contract'
import type { Theme, TextAlign, TextPosition } from '@shared/types'
import { formatCountdown } from '../lib/slideify'
import { loadPdfDocument } from '../lib/pdfLoader'

/**
 * Build a URL the renderer can pass to <img src>/<video src>/CSS url()
 * for a local file that lives OUTSIDE the app bundle (user-picked media
 * like background images, logos, and videos).
 *
 * We can't use plain `file://` from the dev renderer because it loads
 * from http://localhost, and Chromium blocks file:// resource loads
 * across origins ("Not allowed to load local resource"). So we go
 * through the custom `present-media://` scheme registered in
 * main/index.ts, which turns into a proper file read on the main side.
 *
 * Shape: `present-media://local<encoded-absolute-path>`
 *   - 'local' is a placeholder host — the handler doesn't care, it
 *     only uses url.pathname
 *   - encodeURI handles spaces and most special characters while
 *     preserving path separators
 *
 * Production uses the same scheme for consistency (even though prod
 * loads the renderer from file:// and could use file:// directly).
 */
function fileUrl(path: string): string {
  return `present-media://local${encodeURI(path)}`
}

/**
 * Fallback values used when no theme is passed (e.g., placeholder
 * previews before the theme store has loaded). Must stay in sync with
 * DEFAULT_THEME in main/storage/theme.ts — the two copies exist because
 * renderer can't import main modules.
 */
const FALLBACK_THEME: Theme = {
  id: 'fallback',
  name: 'Fallback',
  backgroundColor: '#000000',
  backgroundImagePath: null,
  backgroundVideoPath: null,
  textColor: '#ffffff',
  fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
  fontSizePercent: 100,
  textAlign: 'center',
  textPosition: 'center',
  textEffect: 'none',
  highlightColor: '#ffffff',
  transition: 'fade',
  transitionDurationMs: 200,
  logoPath: null
}

interface SlideRendererProps {
  payload: SlidePayload | null
  /** 'live' shows the payload; 'black' is blackout; 'logo' shows standby image */
  mode: 'live' | 'black' | 'logo'
  /** Active theme. Falls back to FALLBACK_THEME if not provided. */
  theme?: Theme | null
  /** Whether to animate mode/slide transitions. Disabled in preview. */
  animate?: boolean
  /**
   * Whether this renderer instance should play video audio. Only the
   * OUTPUT window passes true — the operator confidence monitor
   * (mirror of the same payloads) stays muted so the operator isn't
   * fighting two audio streams.
   */
  audio?: boolean
  /**
   * Live pause/mute controls for the currently-rendered video slide.
   * Ignored when the active payload isn't a video. On the output window,
   * `muted: true` forces the audio off regardless of `audio` — letting
   * the operator mute without killing the output's audio capability.
   * On the confidence monitor (audio=false), the mute flag is
   * harmless since we're already muted; pause still applies so the
   * operator sees the same freeze frame.
   */
  videoControl?: VideoControl
}

export function SlideRenderer({
  payload,
  mode,
  theme,
  animate = true,
  audio = false,
  videoControl
}: SlideRendererProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  const t = theme ?? FALLBACK_THEME

  // mode === 'live' + a payload → render content
  // mode === 'black' → render nothing (container already has bg)
  // mode === 'logo' → render logo image (or placeholder text if no logo set)
  const showLive = mode === 'live' && payload !== null
  const showLogo = mode === 'logo'

  // Full-bleed media (PDF pages and video items) always render against a
  // plain black background, ignoring the current theme's color / image /
  // video. Rationale: these carry their own visual design, and letting
  // a sermon-note page or a sermon-intro video render on top of a
  // worship-song background would be chaotic and illegible. Black is
  // the universal neutral letterbox color.
  const isFullBleedMedia =
    showLive && (payload.kind === 'pdf-page' || payload.kind === 'video')

  // Background: color always, plus optional image overlay (covers bg color).
  // Video, when set, renders as an absolutely-positioned <video> element
  // behind the content — see the JSX below. We use inline style for the
  // image background because URL paths aren't known at Tailwind compile time.
  const containerStyle: CSSProperties = {
    backgroundColor: isFullBleedMedia ? '#000000' : t.backgroundColor,
    color: t.textColor,
    fontFamily: t.fontFamily
  }
  if (t.backgroundImagePath && !isFullBleedMedia) {
    containerStyle.backgroundImage = `url(${fileUrl(t.backgroundImagePath)})`
    containerStyle.backgroundSize = 'cover'
    containerStyle.backgroundPosition = 'center'
  }

  // Blackout: skip rendering the video/image too, so the output truly
  // goes dark when the operator presses B. Without this the video would
  // keep playing behind a black-text-on-black slide, visible through any
  // slight transparency.
  const isBlackout = mode === 'black'

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden"
      style={containerStyle}
    >
      {/* Video background — renders behind content. Muted + autoplay +
          loop is the standard "ambient video" pattern; playsInline keeps
          mobile Safari from hijacking into fullscreen. A `key` on the src
          makes React rebuild the element when the path changes, otherwise
          the browser caches the old stream and ignores src updates.
          Suppressed for full-bleed media slides (PDF, foreground video)
          so they render on a clean black background instead of layered
          on top of an ambient background video. */}
      {!isBlackout && !isFullBleedMedia && t.backgroundVideoPath && (
        <video
          key={t.backgroundVideoPath}
          src={fileUrl(t.backgroundVideoPath)}
          autoPlay
          loop
          muted
          playsInline
          className="pointer-events-none absolute inset-0 h-full w-full object-cover"
        />
      )}

      {/* PDF pages bypass the auto-fit / flex-position pipeline entirely:
          the page renders contain-fit (preserving every pixel of source
          content), centered, letterboxed against the forced-black
          container background. textPosition/textAlign don't apply to a
          rasterized document page. */}
      {!isBlackout && showLive && payload.kind === 'pdf-page' && (
        <div className="absolute inset-0 flex items-center justify-center">
          <PdfPageView
            pdfPath={payload.pdfPath}
            pageIndex={payload.pageIndex}
            animate={animate}
            transitionDurationMs={t.transitionDurationMs}
            useFade={t.transition === 'fade'}
          />
        </div>
      )}

      {/* Image slides also bypass auto-fit: they should fill the screen
          edge-to-edge (letterboxed if aspect doesn't match), centered,
          regardless of the theme's text alignment. object-contain
          preserves aspect ratio; the flex center handles positioning. */}
      {!isBlackout && showLive && payload.kind === 'image' && (
        <div className="absolute inset-0 flex items-center justify-center">
          <img
            src={fileUrl(payload.imagePath)}
            alt={payload.caption ?? ''}
            className="h-full w-full object-contain"
            draggable={false}
          />
        </div>
      )}

      {/* Foreground video slide — plays once with audio on the output
          window, muted on the confidence monitor. VideoSlide owns a
          ref and applies pause/mute imperatively via useEffect so the
          operator can pause/unmute without remounting the <video>
          (which would restart playback from 0). */}
      {!isBlackout && showLive && payload.kind === 'video' && (
        <div className="absolute inset-0 flex items-center justify-center">
          <VideoSlide
            videoPath={payload.videoPath}
            audio={audio}
            control={videoControl}
          />
        </div>
      )}

      {/* Content layer — absolutely positioned sibling of the video so
          it paints above it in document order, and so the flex props
          (items/justify) control alignment of the AutoFitSlide inside
          without interfering with the video's layout. Only text and
          countdown go through auto-fit; image, pdf-page, and video are
          handled by their own layers above. */}
      {!isBlackout &&
        showLive &&
        payload.kind !== 'pdf-page' &&
        payload.kind !== 'image' &&
        payload.kind !== 'video' && (
          <div
            className={`absolute inset-0 flex ${positionToClasses(t.textPosition)} ${alignToJustify(t.textAlign)}`}
          >
            <AutoFitSlide
              payload={payload}
              theme={t}
              containerRef={containerRef}
              contentRef={contentRef}
              animate={animate}
            />
          </div>
        )}

      {/* Logo layer — always centered regardless of textPosition/textAlign.
          Separate from the content layer so that a bottom-left-aligned
          lyrics theme still gets a centered, large standby image when
          the operator presses L. */}
      {!isBlackout && showLogo && (
        <div className="absolute inset-0 flex items-center justify-center">
          <LogoView logoPath={t.logoPath} />
        </div>
      )}

      {/* Black mode renders nothing — the container's bg color already blacks out */}
    </div>
  )
}

/**
 * Map theme.textPosition (top/center/bottom) to Tailwind flex item-alignment.
 * Flex default is row, so `items-*` controls vertical alignment.
 */
function positionToClasses(position: TextPosition): string {
  switch (position) {
    case 'top':
      return 'items-start pt-[4%]'
    case 'bottom':
      return 'items-end pb-[6%]'
    case 'center':
    default:
      return 'items-center'
  }
}

/**
 * Map theme.textAlign to flex main-axis justification. This positions
 * the content block horizontally; `text-align` inside the block then
 * controls per-line alignment when the block spans the full width.
 */
function alignToJustify(align: TextAlign): string {
  switch (align) {
    case 'left':
      return 'justify-start pl-[6%]'
    case 'right':
      return 'justify-end pr-[6%]'
    case 'center':
    default:
      return 'justify-center'
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AutoFitSlide — measurement + scaling + effect wrapper
// ─────────────────────────────────────────────────────────────────────────────

function AutoFitSlide({
  payload,
  theme,
  containerRef,
  contentRef,
  animate
}: {
  payload: SlidePayload
  theme: Theme
  containerRef: React.RefObject<HTMLDivElement>
  contentRef: React.RefObject<HTMLDivElement>
  animate: boolean
}): JSX.Element {
  // Build a stable key so React remounts the inner div on slide change OR
  // theme change (to re-run the auto-fit measurement). Theme changes can
  // shift font-family which directly affects content size.
  const key = `${payloadKey(payload)}::${theme.fontFamily}::${theme.fontSizePercent}`

  // Transitions: respect theme.transition. 'instant' skips the fade entirely;
  // 'fade' uses the tailwindcss-animate fade-in with a custom duration.
  const shouldAnimate = animate && theme.transition === 'fade'
  const animStyle: CSSProperties = shouldAnimate
    ? { animationDuration: `${theme.transitionDurationMs}ms` }
    : {}

  // textAlign applies to the content block so per-line alignment works
  // independently of the block's overall position in the container.
  const textAlignClass =
    theme.textAlign === 'left'
      ? 'text-left'
      : theme.textAlign === 'right'
      ? 'text-right'
      : 'text-center'

  return (
    <div
      key={key}
      ref={contentRef}
      className={`flex flex-col ${textAlignClass} ${
        shouldAnimate ? 'animate-in fade-in-0' : ''
      }`}
      style={{
        // Fixed percentage padding on the content wrapper itself rather
        // than Tailwind's px-[n%] which computes off the content's own
        // width (which changes as we scale). Percentages here are of the
        // parent container, which is stable.
        padding: '4% 6%',
        maxWidth: '100%',
        // No max-height: the content must be free to grow so scrollHeight
        // reports the intrinsic size. Overflow clipping is handled by the
        // outer container.
        boxSizing: 'border-box',
        ...animStyle
      }}
    >
      <SlideContent payload={payload} theme={theme} />
      <AutoFitController
        containerRef={containerRef}
        contentRef={contentRef}
        payload={payload}
        fontSizePercent={theme.fontSizePercent}
      />
    </div>
  )
}

function payloadKey(payload: SlidePayload): string {
  if (payload.kind === 'text') return `text:${payload.lines.join('|')}`
  if (payload.kind === 'image') return `image:${payload.imagePath}`
  if (payload.kind === 'countdown') return `countdown:${payload.targetTime}:${payload.label}`
  if (payload.kind === 'pdf-page')
    return `pdf:${payload.pdfPath}#${payload.pageIndex}`
  // video — included for exhaustiveness; video renders outside AutoFitSlide
  return `video:${payload.videoPath}`
}

/**
 * AutoFitController — measures the content and scales font-size to fit.
 *
 * Algorithm:
 *   1. Set font to a generous base — 8% of min container dimension,
 *      scaled by theme.fontSizePercent/100
 *   2. Measure how much bigger than the container the content is
 *   3. Scale by the exact ratio (minus a safety margin)
 *   4. Verify — if still overflowing (can happen when shrinking un-wraps
 *      a line, reducing lines but potentially still overflowing), fine-tune
 *      in small linear steps
 */
function AutoFitController({
  containerRef,
  contentRef,
  payload,
  fontSizePercent
}: {
  containerRef: React.RefObject<HTMLDivElement>
  contentRef: React.RefObject<HTMLDivElement>
  payload: SlidePayload
  fontSizePercent: number
}): null {
  useLayoutEffect(() => {
    const container = containerRef.current
    const content = contentRef.current
    if (!container || !content) return

    // Starting font size: 8% of the smaller container dimension, multiplied
    // by the user's fontSizePercent setting. 100% = default, 150% = bigger.
    const minDim = Math.min(container.clientWidth, container.clientHeight)
    if (minDim === 0) return // container not laid out yet
    const basePx = minDim * 0.08 * (fontSizePercent / 100)

    content.style.fontSize = `${basePx}px`

    // Phase 1: one-shot ratio calc
    const availableH = container.clientHeight
    const availableW = container.clientWidth
    const contentH = content.scrollHeight
    const contentW = content.scrollWidth

    const ratioH = availableH / contentH
    const ratioW = availableW / contentW
    const exactRatio = Math.min(ratioH, ratioW, 1) * 0.97

    let size = basePx * exactRatio
    content.style.fontSize = `${size}px`

    // Phase 2: verify + fine-tune. Up to 6 shrink passes at 0.97x each.
    for (let i = 0; i < 6; i++) {
      if (
        content.scrollHeight <= container.clientHeight &&
        content.scrollWidth <= container.clientWidth
      ) {
        break
      }
      size = size * 0.97
      content.style.fontSize = `${size}px`
    }
  }, [containerRef, contentRef, payload, fontSizePercent])

  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-kind content rendering
// ─────────────────────────────────────────────────────────────────────────────

function SlideContent({
  payload,
  theme
}: {
  payload: SlidePayload
  theme: Theme
}): JSX.Element {
  if (payload.kind === 'text') {
    // Text effects are implemented at the line level so highlight boxes
    // hug each line individually rather than spanning the full wrapper
    // width. This matches how karaoke-style stages typically render it.
    return (
      <div
        className="flex flex-col gap-[0.25em] font-semibold leading-[1.25]"
        style={textEffectStyle(theme)}
      >
        {payload.lines.map((line, i) => {
          if (theme.textEffect === 'highlight') {
            return (
              <div key={i}>
                <span
                  style={{
                    backgroundColor: theme.highlightColor,
                    // Use a contrasting text color so the highlight is
                    // actually legible. Simple heuristic: if the highlight
                    // is light, use black; otherwise use the theme color.
                    color: isLightColor(theme.highlightColor)
                      ? '#000000'
                      : theme.textColor,
                    padding: '0.05em 0.3em',
                    boxDecorationBreak: 'clone',
                    WebkitBoxDecorationBreak: 'clone'
                  }}
                >
                  {line}
                </span>
              </div>
            )
          }
          return <div key={i}>{line}</div>
        })}
      </div>
    )
  }

  if (payload.kind === 'image') {
    return (
      <img
        src={fileUrl(payload.imagePath)}
        alt={payload.caption ?? ''}
        className="max-h-full max-w-full object-contain"
        draggable={false}
      />
    )
  }

  if (payload.kind === 'countdown') {
    return (
      <div style={textEffectStyle(theme)}>
        <CountdownView label={payload.label} targetTime={payload.targetTime} />
      </div>
    )
  }

  if (payload.kind === 'pdf-page' || payload.kind === 'video') {
    // Defensive: AutoFitSlide is bypassed for pdf-page and video at the
    // SlideRenderer level, so these branches don't render in practice.
    // Kept for exhaustiveness and as a safety net.
    return <></>
  }

  const _never: never = payload
  return _never
}

/**
 * Compute CSS for non-highlight text effects. Highlight is handled
 * per-line inside SlideContent because it needs to wrap each line
 * individually (not the whole content block).
 *
 * Values tuned for legibility on a projector from the back row —
 * shadow is a soft dark halo that lifts text off busy backgrounds;
 * outline uses paint-order so the stroke renders behind the fill
 * and doesn't eat into letter shapes.
 */
function textEffectStyle(theme: Theme): CSSProperties {
  switch (theme.textEffect) {
    case 'shadow':
      return { textShadow: '0 4px 24px rgba(0, 0, 0, 0.85)' }
    case 'outline':
      return {
        WebkitTextStroke: '0.04em #000000',
        paintOrder: 'stroke fill'
      }
    case 'highlight':
      // Handled per-line inside SlideContent
      return {}
    case 'none':
    default:
      return {}
  }
}

/**
 * Quick luminance check so the highlight span can flip to black text
 * when the highlight color is light (e.g., yellow, white). Simple
 * relative-luminance formula — good enough for readability triage,
 * not WCAG-grade.
 */
function isLightColor(hex: string): boolean {
  const h = hex.replace('#', '')
  if (h.length !== 3 && h.length !== 6) return false
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const r = parseInt(full.slice(0, 2), 16)
  const g = parseInt(full.slice(2, 4), 16)
  const b = parseInt(full.slice(4, 6), 16)
  // Relative luminance approximation
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return lum > 0.6
}

/**
 * LogoView — the standby screen shown when the 'L' key is pressed.
 * Shows the theme's logoPath image if configured, otherwise falls back
 * to the 'PRESENT / Sunday Task' text placeholder.
 *
 * Sizing: `h-full w-full` on the outer img + `object-contain` gives the
 * largest-possible render while preserving aspect ratio and centering
 * within the parent. The 10% inset via inline style leaves a small
 * safety margin so the logo never kisses the edge of the projector.
 */
function LogoView({ logoPath }: { logoPath: string | null }): JSX.Element {
  if (logoPath) {
    return (
      <img
        src={fileUrl(logoPath)}
        alt="Standby"
        className="h-full w-full object-contain"
        style={{ padding: '5%' }}
        draggable={false}
      />
    )
  }
  // Placeholder when no logoPath is set — scales via viewport units so it
  // stays legible on both the operator preview and the fullscreen output.
  return (
    <div className="text-center opacity-60">
      <div
        className="font-light tracking-widest"
        style={{ fontSize: 'min(12vw, 12vh)' }}
      >
        PRESENT
      </div>
      <div
        className="mt-2 uppercase tracking-[0.3em]"
        style={{ fontSize: 'min(1.6vw, 1.6vh)' }}
      >
        Sunday Task
      </div>
    </div>
  )
}

/**
 * PdfPageView — rasterizes one PDF page into a fresh HTMLCanvasElement
 * and swaps it into the DOM when the render resolves.
 *
 * Why create a new canvas each render instead of reusing one ref:
 *   pdf.js tracks canvas-busy state internally. Reusing the same
 *   <canvas> element across renders (e.g. when pageIndex changes or
 *   ResizeObserver re-triggers) hits "Cannot use the same canvas during
 *   multiple render() operations" because cancellation is not
 *   instantaneous — the previous task's cleanup may still be mid-flight
 *   when the new task calls page.render() on the same element.
 *
 *   Creating a fresh canvas per render sidesteps the problem entirely:
 *   pdf.js has no prior state for a brand-new DOM element.
 *
 * Why render off-DOM then swap:
 *   - No flash of empty canvas during rendering
 *   - On rapid page changes we can drop the stale canvas without ever
 *     having shown it
 *
 * Performance notes:
 *   - The PDFDocumentProxy is cached per absolute path in pdfLoader.ts,
 *     so navigating from page 3 → 4 in the same deck reuses the doc
 *   - We don't prerender adjacent pages; each page is rendered on
 *     demand when it becomes the active slide. A 60-page sermon deck
 *     at 1080p is ~500 MB if all pre-rendered — demand rendering keeps
 *     memory usage flat
 *   - A ResizeObserver on the parent triggers re-rasterization on
 *     window resize or display swap (stretching a fixed-size canvas
 *     with CSS would produce blurry output)
 */
function PdfPageView({
  pdfPath,
  pageIndex,
  animate,
  transitionDurationMs,
  useFade
}: {
  pdfPath: string
  pageIndex: number
  animate: boolean
  transitionDurationMs: number
  useFade: boolean
}): JSX.Element {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setError(null)

    const wrapper = wrapperRef.current
    if (!wrapper) return

    let cancelled = false
    // Track the current render task so a rapid page change / resize can
    // cancel it. pdf.js exposes .cancel() on the RenderTask — the task's
    // promise then rejects with RenderingCancelledException which we
    // catch and ignore below.
    let currentRenderTask: { cancel: () => void } | null = null
    // Monotonic generation counter — if a second doRender() starts while
    // the first is still in flight, the first's late completion is
    // ignored. Prevents a stale frame from winning the swap race.
    let generation = 0

    const doRender = async (): Promise<void> => {
      const myGen = ++generation

      // Cancel any in-flight task up front — don't wait, pdf.js marks
      // the old task as cancelled synchronously and its cleanup races
      // to completion in the background.
      currentRenderTask?.cancel()
      currentRenderTask = null

      try {
        const doc = await loadPdfDocument(pdfPath)
        if (cancelled || myGen !== generation) return
        const page = await doc.getPage(pageIndex)
        if (cancelled || myGen !== generation) return

        const rect = wrapper.getBoundingClientRect()
        const availW = rect.width
        const availH = rect.height
        if (availW === 0 || availH === 0) return

        // Contain-fit: pick the SMALLER axis ratio so the entire page
        // stays visible inside the container. The shorter axis
        // letterboxes against the container's background (which we
        // force to black for PDF slides — see SlideRenderer's
        // containerStyle override). This preserves every pixel of the
        // source PDF so footnotes, page numbers, and edge content
        // never get cropped.
        const unscaled = page.getViewport({ scale: 1 })
        const scale = Math.min(availW / unscaled.width, availH / unscaled.height)
        const viewport = page.getViewport({ scale })

        // Device pixel ratio for HiDPI projectors / Retina operator monitors.
        // Cap at 2 so a 4x pixel density display doesn't blow out memory
        // for a 60-page sermon (still sharper than any projector).
        const dpr = Math.min(window.devicePixelRatio || 1, 2)

        // Fresh canvas, detached from the DOM. pdf.js has no prior
        // state for it and can't raise "same canvas" errors.
        const canvas = document.createElement('canvas')
        canvas.width = Math.floor(viewport.width * dpr)
        canvas.height = Math.floor(viewport.height * dpr)
        canvas.style.width = `${viewport.width}px`
        canvas.style.height = `${viewport.height}px`
        canvas.className = 'max-h-full max-w-full'

        const ctx = canvas.getContext('2d')
        if (!ctx) return
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

        // pdf.js 5.x types require `canvas` in the render params.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const renderTask = page.render({
          canvasContext: ctx,
          viewport,
          canvas
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any)
        currentRenderTask = renderTask as unknown as { cancel: () => void }

        await renderTask.promise
        if (cancelled || myGen !== generation) return

        // Atomic swap: clear the wrapper and insert the just-rendered
        // canvas. The previous render's canvas (if any) was never
        // appended — it's garbage-collected on the next tick.
        while (wrapper.firstChild) wrapper.removeChild(wrapper.firstChild)
        if (useFade && animate) {
          canvas.style.animation = `fade-in-0 ${transitionDurationMs}ms`
        }
        wrapper.appendChild(canvas)
      } catch (err) {
        if (cancelled || myGen !== generation) return
        // pdf.js throws a RenderingCancelledException when .cancel() is
        // called — that's our own cleanup, not a real error.
        const name = (err as { name?: string } | null)?.name ?? ''
        if (name === 'RenderingCancelledException') return
        console.error('[PdfPageView] render failed', pdfPath, pageIndex, err)
        setError(err instanceof Error ? err.message : 'Failed to render PDF page')
      }
    }

    void doRender()

    // Re-render on container resize (display swap, window resize).
    // ResizeObserver.observe() fires an initial callback with the
    // current size — we don't special-case it because doRender's
    // generation guard drops the first-render-in-flight result if the
    // re-trigger supersedes it before it completes.
    const resizeObserver = new ResizeObserver(() => {
      if (cancelled) return
      void doRender()
    })
    resizeObserver.observe(wrapper)

    return () => {
      cancelled = true
      currentRenderTask?.cancel()
      resizeObserver.disconnect()
    }
  }, [pdfPath, pageIndex, animate, useFade, transitionDurationMs])

  return (
    <div
      ref={wrapperRef}
      className="relative flex h-full w-full items-center justify-center"
    >
      {error && (
        <div className="max-w-md rounded bg-red-900/70 px-3 py-2 text-xs text-white">
          PDF render failed: {error}
        </div>
      )}
    </div>
  )
}

/**
 * VideoSlide — renders a <video> element with imperative pause/mute
 * control driven by a `control` prop.
 *
 * Why imperative (not declarative) control?
 *   The `muted` attribute and `.play()/.pause()` methods on
 *   HTMLMediaElement don't round-trip cleanly through React's
 *   declarative model. There is no `paused` JSX attribute, and
 *   `autoPlay` only fires once on mount — if the user pauses then
 *   resumes, React can't re-trigger autoplay by re-rendering. Pause
 *   and resume must be done via `.pause()` / `.play()` on the element.
 *
 * Why one element, not re-mount on control change?
 *   Re-mounting would restart playback from 0, which is exactly what
 *   we DON'T want for pause/mute — the operator expects the video to
 *   resume from where it was paused.
 *
 * Mute semantics:
 *   - audio=false (confidence monitor): element is always muted
 *     regardless of control.muted.
 *   - audio=true (output window): element is muted iff control.muted
 *     is true. Default (no control passed) is unmuted.
 */
function VideoSlide({
  videoPath,
  audio,
  control
}: {
  videoPath: string
  audio: boolean
  control?: VideoControl
}): JSX.Element {
  const ref = useRef<HTMLVideoElement>(null)
  const paused = control?.paused ?? false
  // Only the output window (audio=true) honors the user's mute toggle.
  // Confidence monitor stays muted always so the operator doesn't hear
  // two overlapping audio streams.
  const muted = !audio || !!control?.muted

  // Apply pause state. Play()'s promise can reject if the element was
  // interrupted during load — we swallow that because it's not a real
  // error, just a race.
  useEffect(() => {
    const v = ref.current
    if (!v) return
    if (paused) {
      v.pause()
    } else {
      v.play().catch(() => {})
    }
  }, [paused])

  // Apply mute state. Setting .muted is side-effect-only — no promise
  // to handle.
  useEffect(() => {
    const v = ref.current
    if (!v) return
    v.muted = muted
  }, [muted])

  return (
    <video
      ref={ref}
      key={videoPath}
      src={fileUrl(videoPath)}
      autoPlay
      playsInline
      muted={muted}
      controls={false}
      className="h-full w-full object-contain"
    />
  )
}

function CountdownView({
  label,
  targetTime
}: {
  label: string
  targetTime: string
}): JSX.Element {
  const [now, setNow] = useState<number>(Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [])

  const text = formatCountdown(targetTime, now)

  return (
    <div className="flex flex-col gap-[0.2em]">
      {label && (
        <div className="text-[0.35em] font-medium uppercase tracking-[0.2em] opacity-70">
          {label}
        </div>
      )}
      <div className="font-bold tabular-nums">{text}</div>
    </div>
  )
}
