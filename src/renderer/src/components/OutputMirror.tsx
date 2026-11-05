/**
 * OutputMirror — a live pixel-perfect mirror of the projector
 * (output) window. Captures the output window's pixels via
 * `desktopCapturer` + `navigator.mediaDevices.getUserMedia` with a
 * `chromeMediaSource: 'desktop'` constraint, then displays the
 * resulting MediaStream in a `<video>` element.
 *
 * Used by the operator's confidence monitor in Service Mode to
 * show exactly what the congregation is seeing — including text
 * slides, scripture, images, PDF pages, and videos — with zero
 * rendering drift between operator and projector. Previously the
 * confidence monitor ran its own SlideRenderer instance, which
 * meant text slides could subtly differ from the output (font
 * loading timing, autofit calculations, theme override race
 * conditions). The mirror eliminates that entire class of bugs by
 * making the confidence monitor a literal copy of the projector's
 * pixels.
 *
 * Failure handling: if the capture source can't be resolved
 * (output window not yet registered with the OS compositor) or if
 * getUserMedia throws (macOS Screen Recording permission denied),
 * we surface an inline error overlay with the specific permission
 * grant instructions. We deliberately do NOT fall back to
 * independent rendering — the whole point of the mirror is
 * elimination of drift, and a silent fallback would hide the
 * permission issue and put us right back where we started.
 *
 * Note: takes NO props on purpose. It is a pure mirror — the
 * payload, theme, mode, and video controls are all baked into the
 * captured pixels by the output renderer. Adding props would
 * suggest the mirror cares about content, which it doesn't.
 *
 * The frame (red ring when on air, neutral when the output is cut to
 * black/logo) and the Blackout/Logo overlay caption are Service Mode's
 * concern, not this component's — they're drawn by
 * the wrapping container in ServiceMode.tsx so this file stays a
 * content-blind mirror.
 */

import { useEffect, useRef, useState } from 'react'

export function OutputMirror(): JSX.Element {
  const ref = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let stream: MediaStream | null = null

    const start = async (): Promise<void> => {
      try {
        const sourceId = await window.api.output.getCaptureSourceId()
        if (cancelled) return
        if (!sourceId) {
          setError('Output window not available for mirroring.')
          return
        }

        // Electron extends MediaTrackConstraints with a non-standard
        // `mandatory` object for desktop capture. TypeScript's
        // lib.dom doesn't know about these, hence the cast through
        // `unknown`.
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
        v.play().catch(() => {})
        setError(null)
      } catch (err) {
        if (cancelled) return
        console.error('[OutputMirror] capture failed', err)
        const msg = err instanceof Error ? err.message : String(err)
        setError(
          /permission|denied|notallowed/i.test(msg)
            ? 'Screen recording permission required for the confidence monitor. Grant it in System Settings → Privacy & Security → Screen Recording, then quit and relaunch ProChurchCenter Present.'
            : 'Unable to mirror the output window.'
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
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-black p-5 text-center text-[13px] leading-relaxed text-soft">
        <span className="font-medium text-warn">Preview unavailable</span>
        <span className="max-w-[340px]">{error}</span>
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
