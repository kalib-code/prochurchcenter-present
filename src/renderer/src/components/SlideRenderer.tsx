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
import { shouldRewindLoop } from '../lib/videoPlayback'
import { loadPdfDocument } from '../lib/pdfLoader'
import PptxSlideView from './PptxSlideView'
import { toMediaUrl } from '@shared/mediaUrl'

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
  // Shared encoder: encodeURI left `#`/`?` raw and broke Windows paths.
  return toMediaUrl(path)
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
   *
   * Because only the projector passes it, this doubles as the
   * "congregation is watching" signal: when true, render failures
   * (PDF page, undecodable video) show black instead of an error
   * panel. Every audio=false mount (stage monitor, Settings / theme
   * editor previews) is operator-facing and still shows the message.
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
    showLive &&
    (payload.kind === 'pdf-page' ||
      payload.kind === 'pptx-slide' ||
      payload.kind === 'video')

  // Background: color always, plus optional image overlay (covers bg color).
  // Video, when set, renders as an absolutely-positioned <video> element
  // behind the content — see the JSX below. We use inline style for the
  // image background because URL paths aren't known at Tailwind compile time.
  // Blackout: skip rendering the video/image too, so the output truly
  // goes dark when the operator presses B. Without this the video would
  // keep playing behind a black-text-on-black slide, visible through any
  // slight transparency.
  const isBlackout = mode === 'black'

  // Blackout also forces the container itself to pure black: previously
  // a theme with a blue background colour or a background image kept
  // showing it during "blackout".
  const containerStyle: CSSProperties = {
    backgroundColor: isFullBleedMedia || isBlackout ? '#000000' : t.backgroundColor,
    color: t.textColor,
    fontFamily: t.fontFamily
  }
  if (t.backgroundImagePath && !isFullBleedMedia && !isBlackout) {
    containerStyle.backgroundImage = `url(${fileUrl(t.backgroundImagePath)})`
    containerStyle.backgroundSize = 'cover'
    containerStyle.backgroundPosition = 'center'
  }

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
          on top of an ambient background video.

          The manual `onEnded` handler is a defensive fallback for when
          the HTML `loop` attribute fails to restart playback. Per the
          HTML spec, `loop` should suppress the `ended` event entirely;
          when `ended` DOES fire, it means native loop didn't kick in
          (typically because the underlying source — our present-media://
          protocol via net.fetch — didn't expose byte-range seeking
          cleanly enough for Chromium to seek back to position 0).
          Manually setting currentTime + play() is a reliable rewind
          that costs nothing when native loop is working. */}
      {!isBlackout && !isFullBleedMedia && t.backgroundVideoPath && (
        <video
          key={t.backgroundVideoPath}
          src={fileUrl(t.backgroundVideoPath)}
          autoPlay
          loop
          muted
          playsInline
          onLoadedMetadata={(e) => {
            console.log(
              '[bg-video] loadedmetadata',
              t.backgroundVideoPath,
              'duration=',
              e.currentTarget.duration
            )
          }}
          onPlay={() => console.log('[bg-video] play', t.backgroundVideoPath)}
          onError={(e) => {
            const v = e.currentTarget
            console.error(
              '[bg-video] error',
              v.error?.code,
              v.error?.message,
              t.backgroundVideoPath
            )
          }}
          onTimeUpdate={(e) => {
            // Pre-emptive rewind: when we're within 500ms of the
            // end, seek back to 0 unconditionally. This sidesteps
            // both the unreliable native `loop` attribute and the
            // unreliable `ended` event by simply never reaching
            // the actual end frame. The rewind costs us 500ms of
            // ambient video per loop, which is imperceptible for
            // background motion.
            const v = e.currentTarget
            if (
              Number.isFinite(v.duration) &&
              v.currentTime >= v.duration - 0.5
            ) {
              v.currentTime = 0
              if (v.paused) void v.play().catch(() => {})
            }
          }}
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
            showError={!audio}
          />
        </div>
      )}

      {/* PowerPoint slides bypass auto-fit for the same reason PDF pages
          do: a pptx slide arrives already laid out at the deck's native
          pixel dimensions, and PptxSlideView itself scales that fixed
          layout to contain-fit this host via a CSS transform. Running it
          through AutoFitSlide's font-size-driven scaling on top would
          double-scale it. No onError prop is wired here — PptxSlideView
          already leaves the previous slide on screen on failure (its own
          documented contract) and logs the error to the console; there's
          no error-surfacing UI at this layer to hand the message to, so
          adding an inline callback would only risk an unstable identity
          (see PptxSlideView's effect deps) for no benefit. */}
      {!isBlackout && showLive && payload.kind === 'pptx-slide' && (
        <div className="absolute inset-0 flex items-center justify-center">
          <PptxSlideView
            pptxPath={payload.pptxPath}
            slideOrdinal={payload.slideOrdinal}
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
          (which would restart playback from 0).

          Deliberately NOT gated on mode: B / L only HIDE and pause the
          video. Unmounting it (the old `!isBlackout && showLive` guard)
          threw away the decoder, so returning to live replayed the clip
          from 0:00 in front of the congregation. Pausing on black (rather
          than letting audio run under a dark screen) is the least
          surprising behaviour in a service — blackout means "stop" — and
          resuming picks up exactly where it was. The pause also fires a
          timeupdate with paused=true, so the operator's runway freezes
          at the true position instead of drifting. */}
      {payload?.kind === 'video' && (
        <div
          className={`absolute inset-0 flex items-center justify-center ${
            showLive ? '' : 'invisible'
          }`}
        >
          <VideoSlide
            videoPath={payload.videoPath}
            audio={audio}
            control={videoControl}
            loop={payload.loop ?? true}
            hidden={!showLive}
          />
        </div>
      )}

      {/* Content layer — absolutely positioned sibling of the video so
          it paints above it in document order, and so the flex props
          (items/justify) control alignment of the AutoFitSlide inside
          without interfering with the video's layout. Only text and
          countdown go through auto-fit; image, pdf-page, pptx-slide, and
          video are handled by their own layers above. */}
      {!isBlackout &&
        showLive &&
        payload.kind !== 'pdf-page' &&
        payload.kind !== 'pptx-slide' &&
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
        theme={theme}
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
  if (payload.kind === 'pptx-slide')
    return `pptx:${payload.pptxPath}#${payload.slideOrdinal}`
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
 *
 * ResizeObserver + retry-on-zero:
 *   The first useLayoutEffect pass can land on a container that hasn't
 *   been laid out yet (clientWidth/Height === 0). This is the packaged-
 *   app bug: in dev, HMR + Fast Refresh cause enough re-renders that
 *   one of them catches a laid-out container; in production, the
 *   initial effect fires once against a hidden output window and if
 *   we bail on minDim === 0 without any retry, the text stays at its
 *   inherited browser font size forever. The ResizeObserver fires
 *   again the moment the container gets a real size (ready-to-show,
 *   display resize, bounds change), re-running the fit automatically.
 */
function AutoFitController({
  containerRef,
  contentRef,
  payload,
  theme
}: {
  containerRef: React.RefObject<HTMLDivElement>
  contentRef: React.RefObject<HTMLDivElement>
  payload: SlidePayload
  theme: Theme
}): null {
  // `theme` is intentionally a dependency of the whole effect below so
  // ANY theme change re-runs the fit. Font family, fontSizePercent,
  // textEffect (affects measured content width via stroke), textAlign
  // (affects wrapping) — all of these matter. Taking the whole theme
  // is simpler than enumerating every field and missing one.
  const fontSizePercent = theme.fontSizePercent

  useLayoutEffect(() => {
    // CRITICAL: read refs inside fit() on every call, not once at
    // effect-start closure time. The previous version captured
    // `container`/`content` at the top of the effect, so when the
    // content div remounted due to a React key change (payload /
    // fontFamily / fontSizePercent all feed into the key), the
    // ResizeObserver callback would write font-size onto the OLD,
    // now-detached element. The visible new element stayed at its
    // inherited browser default (tiny). This is what caused the
    // packaged-app "text is tiny until you resize the window" bug —
    // resizing triggered a full React commit that re-ran this effect
    // with fresh refs, not because resize itself was magic.
    const fit = (): void => {
      const container = containerRef.current
      const content = contentRef.current
      if (!container || !content) return

      // Starting font size: 8% of the smaller container dimension,
      // multiplied by the user's fontSizePercent setting.
      const minDim = Math.min(container.clientWidth, container.clientHeight)
      if (minDim === 0) return // not laid out yet; ResizeObserver will retry
      const basePx = minDim * 0.08 * (fontSizePercent / 100)

      content.style.fontSize = `${basePx}px`

      // Phase 1: one-shot ratio calc
      const availableH = container.clientHeight
      const availableW = container.clientWidth
      const contentH = content.scrollHeight
      const contentW = content.scrollWidth

      if (contentH === 0 || contentW === 0) return // content not measurable yet

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
    }

    // Initial pass — runs synchronously after layout in the same frame.
    fit()

    // A handful of requestAnimationFrame retries handles the specific
    // packaged-Electron timing where the output window's ready-to-show
    // + setBounds + show() sequence happens just after React's first
    // commit. The ResizeObserver below catches dimension *changes*,
    // but if the window is already at its final size when React first
    // paints and the layout just hasn't flushed yet, there's no resize
    // event to catch. Three frames (~50ms) is enough to let the browser
    // settle without the retries ever being user-visible.
    let rafCount = 0
    let rafId = 0
    const tick = (): void => {
      rafCount++
      fit()
      if (rafCount < 3) rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)

    // Retry on any container resize. This also catches the case where
    // the output window becomes visible mid-session or the operator
    // drags the display. We observe the container element currently
    // pointed to by the ref — if it changes later, the effect will
    // re-run and reattach a fresh observer.
    const container = containerRef.current
    let ro: ResizeObserver | null = null
    if (container) {
      ro = new ResizeObserver(() => fit())
      ro.observe(container)
    }
    return () => {
      cancelAnimationFrame(rafId)
      ro?.disconnect()
    }
  }, [containerRef, contentRef, payload, theme, fontSizePercent])

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

  if (
    payload.kind === 'pdf-page' ||
    payload.kind === 'video' ||
    payload.kind === 'pptx-slide'
  ) {
    // Defensive: AutoFitSlide is bypassed for pdf-page, video, and
    // pptx-slide at the SlideRenderer level (see isFullBleedMedia / the
    // content-layer guard above) — each has its own full-bleed layer
    // (PdfPageView, VideoSlide, PptxSlideView) that renders instead, so
    // these branches don't run in practice. Kept for exhaustiveness and
    // as a safety net if that guard is ever loosened.
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
 * to the 'PRESENT / ProChurchCenter' text placeholder.
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
  useFade,
  showError
}: {
  pdfPath: string
  pageIndex: number
  animate: boolean
  transitionDurationMs: number
  useFade: boolean
  /** False on the projector — see SlideRendererProps.audio. */
  showError: boolean
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
      {/* Never on the projector: a red debug panel in front of the
          congregation is worse than black. The failure is still
          console.error'd above; the operator's Service Mode grid
          thumbnail loads the same page through the same pdfLoader and
          shows a "pdf" placeholder when it fails, and the stage monitor
          and Settings previews (audio=false) show this message. */}
      {error && showError && (
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
 *   - audio=false (stage monitor / Settings' live preview — NOT
 *     Service Mode's confidence monitor, see VideoSlideOperator below):
 *     element is always muted regardless of control.muted.
 *   - audio=true (output window): element is muted iff control.muted
 *     is true. Default (no control passed) is unmuted.
 *
 * Cross-window position broadcast (output → Service Mode only):
 *   There is no cross-window <video> sync to do anymore — Service
 *   Mode's confidence monitor doesn't render a SlideRenderer instance
 *   at all, it's a pixel mirror of the output window via OutputMirror
 *   (desktopCapturer). The OUTPUT side still broadcasts its currentTime
 *   via IPC every ~250ms (the browser's native timeupdate rate), but
 *   the only consumer left is Service Mode's `<VideoRunway>`, which
 *   just formats it into a progress bar and time readout — there is no
 *   second decoder anywhere to keep in sync with it.
 */
function VideoSlide(props: {
  videoPath: string
  audio: boolean
  control?: VideoControl
  loop: boolean
  /** Blackout / logo is up: keep the decoder, but pause and hide. */
  hidden: boolean
}): JSX.Element | null {
  // Two completely different rendering strategies depending on which
  // window we're in, so we split into sub-components instead of
  // branching inside a single useEffect tangle:
  //
  //   audio=true  → decodes the video file with audio, honors the
  //                 operator's pause/mute controls (this is what the
  //                 congregation sees on the projector — the OUTPUT
  //                 window only)
  //   audio=false → mirrors the output window's actual pixels via
  //                 desktopCapturer + getUserMedia (Option C) instead of
  //                 decoding the file a second time. Zero clock drift
  //                 because there's only one decoder anywhere in the
  //                 app. Mounted by the stage monitor and Settings'
  //                 live preview — NOT by Service Mode's confidence
  //                 monitor, which mirrors the whole output window via
  //                 <OutputMirror> rather than a per-slide instance.
  return props.audio ? (
    <VideoSlideOutput
      // Keyed by path so every new video gets a fresh instance. Without
      // it, a decode error on video A leaves the listener effect (deps
      // [loop, videoPath]) bound to the null ref of the black fallback
      // when video B mounts — no runway updates, no auto-advance.
      key={props.videoPath}
      videoPath={props.videoPath}
      control={props.control}
      loop={props.loop}
      hidden={props.hidden}
    />
  ) : props.hidden ? (
    // The pixel mirror has no playback position to lose, so there's no
    // reason to keep a desktop capture running behind a blackout.
    null
  ) : (
    <VideoSlideOperator />
  )
}

/**
 * Output-window video: plays the file with audio, honors VideoControl,
 * and reports natural end-of-stream so the operator can auto-advance
 * non-looping videos.
 */
function VideoSlideOutput({
  videoPath,
  control,
  loop,
  hidden
}: {
  videoPath: string
  control?: VideoControl
  loop: boolean
  hidden: boolean
}): JSX.Element {
  const ref = useRef<HTMLVideoElement>(null)
  const paused = control?.paused ?? false
  const muted = !!control?.muted
  // Set when the <video> fires `error`. The element is swapped for
  // plain black — this component only ever mounts in the projector
  // window (audio=true), so any message drawn here would be read by
  // the congregation, not the operator. The details go to
  // console.error (piped to the dev terminal), and the operator's
  // runway in Service Mode flags "not playing" when no playback
  // updates arrive for the live video.
  // No reset-on-path-change effect: the caller keys this component by
  // videoPath, so a new video always starts with failed = false.
  const [failed, setFailed] = useState(false)

  // `hidden` (blackout / logo) pauses exactly like the operator's P.
  // An `ended` video is left alone: play() on an ended element restarts
  // it from 0, which would replay a finished clip the moment the
  // operator un-blacks.
  const shouldPause = paused || hidden
  useEffect(() => {
    const v = ref.current
    if (!v) return
    if (shouldPause) v.pause()
    else if (!v.ended) v.play().catch(() => {})
  }, [shouldPause])

  useEffect(() => {
    const v = ref.current
    if (!v) return
    v.muted = muted
  }, [muted])

  // Loop vs. advance use DIFFERENT end signals:
  //
  //   loop = true  → pre-emptive rewind from `timeupdate` near the end
  //                  (shouldRewindLoop). Native `loop` needs a seek back
  //                  to 0, which our present-media:// stream (net.fetch)
  //                  doesn't always serve cleanly; rewinding just before
  //                  the end never reaches the stuck final frame. Losing
  //                  up to 0.5s of a loop is invisible.
  //   loop = false → notify the operator (auto-advance) from the real
  //                  `ended` event. Firing early here (the old
  //                  duration-0.5s check) cut off the last half-second —
  //                  exactly where fade-outs and end title cards live.
  //                  Reaching the end needs no seek, so `ended` is
  //                  reliable for a play-once clip, and it also covers
  //                  very short and unknown-duration videos, which a
  //                  duration-based check can't.
  //
  // `ended` on a LOOPING video means native loop failed to kick in —
  // rewind manually, same defensive fallback as the background video.
  //
  // The `nearEndFired` flag prevents rewinding multiple times within
  // a single cycle (timeupdate fires ~4Hz so without it we'd
  // re-trigger 1–2x per cycle).
  useEffect(() => {
    const v = ref.current
    if (!v) return
    console.log(
      '[fg-video] mounted',
      videoPath,
      'loop=',
      loop,
      'duration=',
      v.duration
    )
    let nearEndFired = false
    const handleTimeUpdate = (): void => {
      // Broadcast position to the operator's runway readout. Sent BEFORE
      // the duration guard below so the operator gets currentTime
      // immediately; `duration` is NaN until metadata loads and the
      // consumer is documented to guard with Number.isFinite. Coercing
      // it here would be a lie. `v.paused` (not the `paused` prop) is
      // read so the operator sees the element's actual playback state,
      // not just the last commanded intent (e.g. if a play() call was
      // rejected by autoplay policy, `v.paused` stays true even though
      // the prop says otherwise).
      void window.api.output.setVideoTimeUpdate({
        videoPath,
        currentTime: v.currentTime,
        duration: v.duration,
        paused: v.paused
      })

      if (!loop) return
      const nearEnd = shouldRewindLoop(v.currentTime, v.duration)
      if (nearEnd && !nearEndFired) {
        nearEndFired = true
        console.log('[fg-video] near end, rewinding (loop=true)')
        v.currentTime = 0
        // Some Electron versions need an explicit play() after
        // a seek when the element was mid-playback near end.
        if (v.paused) void v.play().catch(() => {})
      } else if (!nearEnd && nearEndFired) {
        // Reset the flag once playback has clearly moved away
        // from the end (i.e., we successfully looped back to ~0).
        nearEndFired = false
      }
    }
    const handleEnded = (): void => {
      if (loop) {
        console.log('[fg-video] ended despite loop=true, rewinding')
        v.currentTime = 0
        void v.play().catch(() => {})
        return
      }
      console.log('[fg-video] ended, notifying operator (loop=false)')
      void window.api.output.setVideoEnded({ videoPath })
    }
    const handleError = (): void => {
      const err = v.error
      // Map the error code to a human-readable hint for the log. The
      // important distinction is "the file is broken" (decode/source)
      // vs "something else went wrong":
      //   1 MEDIA_ERR_ABORTED         — user abort, transient
      //   2 MEDIA_ERR_NETWORK         — network/protocol failure
      //   3 MEDIA_ERR_DECODE          — codec/pixel format unsupported
      //   4 MEDIA_ERR_SRC_NOT_SUPPORTED — container/codec not recognized
      const code = err?.code ?? 0
      const hint =
        code === 3 || code === 4
          ? 'unsupported format — re-export as H.264 8-bit (yuv420p), e.g. HandBrake "Fast 1080p30"'
          : code === 2
            ? 'could not load the file — check it still exists and is not corrupted'
            : 'playback failed — try re-encoding to H.264 8-bit'
      console.error('[fg-video] error', code, err?.message, videoPath, '—', hint)
      if (code !== 0) setFailed(true)
    }
    v.addEventListener('timeupdate', handleTimeUpdate)
    v.addEventListener('ended', handleEnded)
    v.addEventListener('error', handleError)
    return () => {
      v.removeEventListener('timeupdate', handleTimeUpdate)
      v.removeEventListener('ended', handleEnded)
      v.removeEventListener('error', handleError)
    }
  }, [loop, videoPath])

  // Failed decode → plain black on the projector (see `failed` above).
  if (failed) return <div className="h-full w-full bg-black" />

  return (
    <video
      ref={ref}
      key={videoPath}
      src={fileUrl(videoPath)}
      autoPlay
      playsInline
      loop={loop}
      muted={muted}
      controls={false}
      className="h-full w-full object-contain"
    />
  )
}

/**
 * NOT dead code, despite Service Mode's own confidence monitor no
 * longer mounting it — that monitor is <OutputMirror>, a component-level
 * mirror of the whole output window, not a per-slide SlideRenderer
 * instance. This function is the audio=false branch reached from two
 * OTHER mount sites:
 *   - the stage monitor (output/StageView.tsx:126 and :142, both pass
 *     `audio={false}`) — the on-demand projector for the speaker
 *   - Settings' live preview (Settings.tsx's <SlideRenderer> call,
 *     which passes no `audio` prop and so defaults to false)
 *
 * Mirrors the output window's pixels via `desktopCapturer` +
 * `navigator.mediaDevices.getUserMedia` with a `chromeMediaSource:
 * 'desktop'` constraint. Because only one decoder exists (on the output
 * side), there is literally nothing to drift — whichever window mounts
 * this sees exactly what the projector is showing, frame for frame, at
 * the projector's real framerate.
 *
 * Failure handling: if the capture source can't be resolved (output
 * window not yet registered with the OS compositor) or if getUserMedia
 * throws (macOS screen-recording permission denied), we surface a short
 * inline message telling the operator what to do. We don't fall back
 * to independent file playback because the whole point of Option C is
 * to eliminate that failure mode — a silent fallback would hide the
 * permission issue and put us right back in the drift problem.
 *
 * Note: intentionally takes NO props. This is a pure mirror of whatever
 * the output window is rendering, so it doesn't care about the specific
 * videoPath, pause state, or mute state — all of those are already
 * baked into the captured pixels.
 */
function VideoSlideOperator(): JSX.Element {
  const ref = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let stream: MediaStream | null = null

    const start = async (): Promise<void> => {
      try {
        const sourceId = await window.api.output.getCaptureSourceId()
        console.log('[VideoSlideOperator] sourceId', sourceId)
        if (cancelled) return
        if (!sourceId) {
          setError('Output window not available for mirroring.')
          return
        }

        // Electron extends MediaTrackConstraints with a non-standard
        // `mandatory` object for desktop capture. TypeScript's lib.dom
        // doesn't know about these, hence the cast through `unknown`.
        // Including explicit min AND max dimensions because some
        // Electron versions produce black frames if only max is set
        // (the capture source gets the default 0-pixel min and the
        // pipeline decides "nothing matches, return empty").
        const constraints = {
          audio: false,
          video: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: sourceId,
              minWidth: 640,
              maxWidth: 1920,
              minHeight: 360,
              maxHeight: 1080
            }
          }
        } as unknown as MediaStreamConstraints

        stream = await navigator.mediaDevices.getUserMedia(constraints)
        console.log(
          '[VideoSlideOperator] stream acquired',
          'tracks=',
          stream.getTracks().map((t) => ({
            kind: t.kind,
            label: t.label,
            readyState: t.readyState,
            enabled: t.enabled,
            muted: t.muted,
            settings: t.getSettings()
          }))
        )
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }

        const v = ref.current
        if (!v) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }

        v.srcObject = stream
        v.muted = true
        v.play().catch((e) => console.warn('[VideoSlideOperator] play() rejected', e))

        // Give the pipeline ~600ms to produce a frame, then check if
        // the video element is actually receiving non-zero dimensions.
        // If videoWidth is still 0, the capture is likely permission-
        // denied in silent-failure mode — surface it as an explicit
        // error instead of leaving the operator staring at black.
        setTimeout(() => {
          if (cancelled) return
          const local = ref.current
          if (!local) return
          console.log(
            '[VideoSlideOperator] post-play check',
            'videoWidth=',
            local.videoWidth,
            'videoHeight=',
            local.videoHeight,
            'readyState=',
            local.readyState
          )
          if (local.videoWidth === 0 && local.videoHeight === 0) {
            setError(
              'The output window capture returned no frames — most likely Screen Recording permission is missing. Grant it in System Settings → Privacy & Security → Screen Recording, then fully quit and relaunch ProChurchCenter Present.'
            )
          }
        }, 600)

        setError(null)
      } catch (err) {
        if (cancelled) return
        console.error('[VideoSlideOperator] capture failed', err)
        const msg = err instanceof Error ? err.message : String(err)
        setError(
          /permission|denied|notallowed/i.test(msg)
            ? 'Screen recording permission is required for the video preview. Grant it in System Settings → Privacy & Security → Screen Recording, then restart ProChurchCenter Present.'
            : 'Unable to mirror the output window for the video preview.'
        )
      }
    }

    void start()

    return () => {
      cancelled = true
      if (stream) {
        stream.getTracks().forEach((t) => t.stop())
      }
      const v = ref.current
      if (v) v.srcObject = null
    }
  }, [])

  if (error) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-black p-6 text-center text-sm text-white/70">
        {error}
      </div>
    )
  }

  return (
    <video
      ref={ref}
      playsInline
      muted
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
