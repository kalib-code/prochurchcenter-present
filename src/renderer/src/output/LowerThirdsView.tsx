/**
 * LowerThirdsView — the OBS-facing chroma key window.
 *
 * Renders a full-screen chroma-keyed background (default bright
 * green) with a single lower-third graphic positioned in the bottom
 * portion of the screen. OBS captures this window as a "Window
 * Capture" source, applies a Chroma Key filter on the matching
 * green, and only the lower-third graphic survives into the
 * broadcast.
 *
 * Why chroma key instead of native window transparency: native
 * transparency requires `transparent: true` on the BrowserWindow,
 * which interacts badly with macOS window levels and Chromium's
 * compositor on some hardware (occasional black flashes during OBS
 * capture). Chroma key is uglier locally but rock-solid in the
 * broadcast pipeline. Decision C from the planning round.
 *
 * The chroma color is read from a `?chroma=#00FF00` query param
 * passed in by the main process when creating the window — that
 * keeps the BrowserWindow's `backgroundColor` and the body's CSS
 * background in lockstep without needing an additional IPC round
 * trip on first render.
 */

import { useEffect, useMemo, useState } from 'react'
import type { LowerThirdsContent } from '@shared/ipc-contract'

const DEFAULT_CHROMA = '#00FF00'
type Alignment = 'left' | 'center' | 'right'
const DEFAULT_ALIGN: Alignment = 'left'

/**
 * Parse the URL hash for `chroma` and `align` query parameters. The
 * hash looks like `#/lowerthirds?chroma=%2300FF00&align=center` —
 * we can't use react-router's useSearchParams here because the
 * params live inside the hash, not in the URL's search string.
 */
function readUrlParams(): { chroma: string; align: Alignment } {
  const hash = window.location.hash
  const queryStart = hash.indexOf('?')
  if (queryStart === -1) return { chroma: DEFAULT_CHROMA, align: DEFAULT_ALIGN }
  const params = new URLSearchParams(hash.slice(queryStart + 1))
  const align = params.get('align')
  return {
    chroma: params.get('chroma') ?? DEFAULT_CHROMA,
    align:
      align === 'center' || align === 'right' || align === 'left'
        ? align
        : DEFAULT_ALIGN
  }
}

export function LowerThirdsView(): JSX.Element {
  const { chroma, align } = useMemo(readUrlParams, [])
  const [content, setContent] = useState<LowerThirdsContent>({
    visible: false,
    title: '',
    subtitle: ''
  })

  // Map alignment to flex justification (which side of the strip
  // the graphic anchors to) and CSS text-align (how text wraps
  // within the graphic's box).
  const justifyClass =
    align === 'center'
      ? 'justify-center'
      : align === 'right'
        ? 'justify-end'
        : 'justify-start'
  const textAlign: 'left' | 'center' | 'right' = align

  console.log('[LowerThirdsView] render', { chroma, align, content })

  useEffect(() => {
    // Paint the body background to match the BrowserWindow background.
    // Without this, the React app's dark theme CSS would draw over
    // the chroma key and OBS would have nothing to key out.
    document.body.style.background = chroma
    document.documentElement.style.background = chroma
    return () => {
      document.body.style.background = ''
      document.documentElement.style.background = ''
    }
  }, [chroma])

  useEffect(() => {
    console.log('[LowerThirdsView] subscribing to onLowerThirdsContent')
    const off = window.api.output.onLowerThirdsContent((next) => {
      console.log('[LowerThirdsView] received content', next)
      setContent(next)
    })
    return off
  }, [])

  // The window is a strip (full width × ~280px) at the bottom of
  // the target display. Layout:
  //   - Whole strip = chroma green
  //   - Graphic vertically centered, horizontally aligned per setting
  //   - Graphic uses ~80% max width
  return (
    <div
      className={`flex h-screen w-screen items-center overflow-hidden px-12 ${justifyClass}`}
      style={{ background: chroma }}
    >
      {content.visible && content.title && (
        <LowerThirdsGraphic content={content} textAlign={textAlign} />
      )}
    </div>
  )
}

/**
 * The actual lower-third box (dark rectangle with text). Pulled out
 * of the parent so all the theme-application logic lives in one
 * place and the parent can stay focused on layout.
 */
function LowerThirdsGraphic({
  content,
  textAlign
}: {
  content: LowerThirdsContent
  textAlign: 'left' | 'center' | 'right'
}): JSX.Element {
  // Theme defaults — used when the broadcast payload doesn't include
  // theme (e.g. the cached default in main before any operator push).
  const fontSize = content.theme?.fontSize ?? 36
  const textColor = content.theme?.textColor ?? '#FFFFFF'
  const boxColor = content.theme?.boxColor ?? '#0F121C'
  const boxOpacity = content.theme?.boxOpacity ?? 92
  const effect = content.theme?.textEffect ?? 'shadow'

  // Map text effect to CSS. Shadow is a simple drop shadow;
  // outline is a 4-direction text-shadow trick that looks like a
  // 1px stroke on every character. Both work over arbitrary
  // backgrounds, which is why they're better than relying on the
  // box background alone for legibility — and they're essential
  // when boxOpacity is 0 because there's no plate behind the text.
  const textShadow =
    effect === 'shadow'
      ? '2px 2px 6px rgba(0,0,0,0.85)'
      : effect === 'outline'
        ? '-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 0 4px rgba(0,0,0,0.6)'
        : 'none'

  // Convert 0–100 opacity into a hex alpha byte (00–FF) and append
  // to the box color. boxOpacity = 0 → '#0F121C00' = fully transparent.
  // boxOpacity = 100 → '#0F121CFF' = fully opaque.
  const alphaHex = Math.round((boxOpacity / 100) * 255)
    .toString(16)
    .padStart(2, '0')
    .toUpperCase()
  const boxBg = `${boxColor}${alphaHex}`

  // When the box is essentially invisible (≤10% opacity), drop the
  // shadow + backdrop-filter too — a soft drop-shadow on a near-
  // transparent box looks like a phantom rectangle floating behind
  // the text. Same with backdrop blur. We also drop padding to
  // tighten up the text against the chroma edge.
  const showBoxStyling = boxOpacity > 10
  const boxClasses = showBoxStyling
    ? 'flex max-w-[80%] flex-col rounded-md px-8 py-5 shadow-2xl'
    : 'flex max-w-[80%] flex-col px-1 py-1'

  return (
    <div
      className={boxClasses}
      style={{
        background: boxBg,
        backdropFilter: showBoxStyling ? 'blur(2px)' : 'none'
      }}
    >
      {/* Title slot carries multi-line lyrics from the current song
          slide. whitespace-pre-wrap honors the \n joins from the
          operator side so each lyric line renders on its own row. */}
      <div
        className="whitespace-pre-wrap font-semibold leading-snug"
        style={{
          fontSize: `${fontSize}px`,
          color: textColor,
          textAlign,
          textShadow,
          fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif'
        }}
      >
        {content.title}
      </div>
      {content.subtitle && (
        <div
          className="mt-2 leading-snug"
          style={{
            fontSize: `${Math.round(fontSize * 0.5)}px`,
            color: textColor,
            opacity: 0.75,
            textAlign,
            textShadow,
            fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif'
          }}
        >
          {content.subtitle}
        </div>
      )}
    </div>
  )
}
