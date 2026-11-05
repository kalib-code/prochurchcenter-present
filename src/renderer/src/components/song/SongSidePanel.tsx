/**
 * SongSidePanel — the song editor's right column, in four tabs:
 *
 *   Preview  the slide the cursor is in, rendered by the real
 *            SlideRenderer with the song's effective theme, then every
 *            slide grouped by section. Clicking a slide moves the cursor
 *            to its lyrics.
 *   Details  CCLI, copyright, year, language, tags — filled in once.
 *   Look     the per-song theme override.
 *   Notes    operator notes (never projected).
 *
 * Only ONE SlideRenderer is mounted (the large preview): the grid uses
 * lightweight themed thumbnails, because a SlideRenderer per card would
 * start one background video per card when the theme has one.
 */

import { useEffect, useRef, useState } from 'react'
import type { SongLanguage, Theme, ThemeOverride } from '@shared/types'
import type { SlidePayload } from '@shared/ipc-contract'
import type { LyricsLayout, LayoutSlide } from '../../lib/lyricsLayout'
import { themedBodyStyle, themedTextStyle } from '../../lib/slideTheming'
import { cn } from '../../lib/utils'
import { SlideRenderer } from '../SlideRenderer'
import { ThemeOverrideEditor } from '../ThemeOverrideEditor'
import { Field, Input, Select, Textarea } from '../ui/Input'
import { ChevronLeftIcon, ChevronRightIcon } from '../icons'

export type SidePanelTab = 'preview' | 'details' | 'look' | 'notes'

export interface SongDetails {
  ccli: string
  copyright: string
  year: string
  language: SongLanguage
  categories: string
  notes: string
}

const TABS: { id: SidePanelTab; label: string }[] = [
  { id: 'preview', label: 'Preview' },
  { id: 'details', label: 'Details' },
  { id: 'look', label: 'Look' },
  { id: 'notes', label: 'Notes' }
]

export function SongSidePanel({
  layout,
  currentSlide,
  onSelectSlide,
  theme,
  globalTheme,
  themeOverride,
  onThemeOverride,
  details,
  onDetails,
  maxLines
}: {
  layout: LyricsLayout
  currentSlide: number | null
  onSelectSlide: (slide: number) => void
  /** Effective theme: global merged with this song's override. */
  theme: Theme | null
  globalTheme: Theme | null
  themeOverride: ThemeOverride | null
  onThemeOverride: (next: ThemeOverride | null) => void
  details: SongDetails
  onDetails: (patch: Partial<SongDetails>) => void
  maxLines: number
}): JSX.Element {
  const [tab, setTab] = useState<SidePanelTab>('preview')
  const { slides, sections } = layout
  const shown = currentSlide ?? (slides.length > 0 ? 0 : null)
  const slide = shown !== null ? slides[shown] : undefined

  const payload: SlidePayload = slide
    ? { kind: 'text', lines: slide.lines, sectionLabel: slide.sectionLabel }
    : { kind: 'text', lines: [], sectionLabel: '' }

  // Keep the current thumbnail in view as the cursor moves.
  const grid = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (shown === null) return
    grid.current
      ?.querySelector(`[data-slide="${shown}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [shown])

  return (
    <aside aria-label="Song panel" className="flex min-h-0 flex-col border-l border-rule">
      <div role="tablist" className="flex shrink-0 gap-1 border-b border-rule px-4 pt-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              '-mb-px border-b-2 px-2.5 pb-2.5 pt-2 text-[13px] font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70',
              tab === t.id
                ? 'border-foreground text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {t.label}
            {t.id === 'look' && themeOverride && (
              <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-accent align-middle" />
            )}
          </button>
        ))}
      </div>

      <div className="scroll-hairline min-h-0 flex-1 overflow-y-auto">
        {tab === 'preview' && (
          <div className="p-4">
            <div className="relative aspect-video overflow-hidden rounded-lg ring-1 ring-inset ring-white/5">
              <SlideRenderer payload={payload} mode="live" theme={theme} animate={false} />
              {!slide && (
                <span className="absolute inset-0 flex items-center justify-center text-[13px] text-white/35">
                  Your first slide shows here
                </span>
              )}
            </div>
            <div className="mt-2.5 flex items-center justify-between gap-3">
              <span className="min-w-0 truncate text-[13px] tabular-nums text-soft" title="The preview follows your cursor in the lyrics">
                {slide ? (
                  <>
                    <span className="font-medium text-bone">{slide.sectionLabel}</span>
                    {` · Slide ${slide.index + 1} of ${slides.length}`}
                  </>
                ) : (
                  `Max ${maxLines} lines per slide`
                )}
              </span>
              <span className="flex gap-1">
                <StepButton
                  label="Previous slide"
                  disabled={!slide || slide.index === 0}
                  onClick={() => slide && onSelectSlide(slide.index - 1)}
                >
                  <ChevronLeftIcon size={14} />
                </StepButton>
                <StepButton
                  label="Next slide"
                  disabled={!slide || slide.index >= slides.length - 1}
                  onClick={() => slide && onSelectSlide(slide.index + 1)}
                >
                  <ChevronRightIcon size={14} />
                </StepButton>
              </span>
            </div>

            {slides.length > 0 && (
              <div ref={grid} className="mt-5">
                <div className="mb-2 flex justify-between text-[12px] font-medium text-muted-foreground">
                  <span>All slides</span>
                  <span className="tabular-nums">{slides.length}</span>
                </div>
                {sections.map((section, si) => {
                  const own = slides.filter((s) => s.section === si)
                  if (own.length === 0) return null
                  return (
                    <div key={si} className="mb-3">
                      <div className="mb-1.5 text-[12px] text-quiet">
                        {section.label || 'Before first section'}
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        {own.map((s) => (
                          <Thumb
                            key={s.index}
                            slide={s}
                            theme={theme}
                            current={s.index === shown}
                            onClick={() => onSelectSlide(s.index)}
                          />
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {tab === 'details' && (
          <div className="grid grid-cols-2 gap-x-3 gap-y-4 p-4">
            <Field label="CCLI number">
              <Input
                value={details.ccli}
                onChange={(e) => onDetails({ ccli: e.target.value })}
                placeholder="Optional"
                className="tabular-nums"
              />
            </Field>
            <Field label="Year">
              <Input
                inputMode="numeric"
                value={details.year}
                onChange={(e) => onDetails({ year: e.target.value })}
                placeholder="Optional"
                className="tabular-nums"
              />
            </Field>
            <Field label="Copyright" className="col-span-2">
              <Input
                value={details.copyright}
                onChange={(e) => onDetails({ copyright: e.target.value })}
                placeholder="Optional"
              />
            </Field>
            <Field label="Language">
              <Select
                value={details.language}
                onChange={(e) => onDetails({ language: e.target.value as SongLanguage })}
              >
                <option value="en">English</option>
                <option value="tl">Tagalog</option>
                <option value="ceb">Cebuano</option>
                <option value="ilo">Ilocano</option>
                <option value="other">Other</option>
              </Select>
            </Field>
            <Field label="Tags" hint="Comma-separated">
              <Input
                value={details.categories}
                onChange={(e) => onDetails({ categories: e.target.value })}
                placeholder="praise, christmas"
              />
            </Field>
          </div>
        )}

        {tab === 'look' && (
          <div className="p-4">
            {globalTheme ? (
              <ThemeOverrideEditor
                override={themeOverride}
                globalTheme={globalTheme}
                onChange={onThemeOverride}
                previewSlide={
                  slides[0]
                    ? { kind: 'text', lines: slides[0].lines, sectionLabel: slides[0].sectionLabel }
                    : { kind: 'text', lines: ['Sample lyric line', 'Shows your theme override'], sectionLabel: 'Preview' }
                }
              />
            ) : (
              <p className="text-[13px] text-muted-foreground">Loading theme…</p>
            )}
          </div>
        )}

        {tab === 'notes' && (
          <div className="flex flex-col gap-2 p-4">
            <label htmlFor="song-notes" className="text-[13px] font-medium text-quiet">
              Operator notes
              <span className="ml-2 font-normal text-muted-foreground">Shown in Service Mode, never projected</span>
            </label>
            <Textarea
              id="song-notes"
              value={details.notes}
              onChange={(e) => onDetails({ notes: e.target.value })}
              className="min-h-[200px] resize-y px-3.5 py-3 text-[13.5px] leading-[1.6] text-bone"
              placeholder="Key of G. Skip bridge if running long."
            />
          </div>
        )}
      </div>
    </aside>
  )
}

function StepButton({
  label,
  disabled,
  onClick,
  children
}: {
  label: string
  disabled: boolean
  onClick: () => void
  children: React.ReactNode
}): JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-raised text-quiet transition-colors hover:bg-hover hover:text-foreground disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
    >
      {children}
    </button>
  )
}

/** Themed thumbnail (colours, image, font) without SlideRenderer's video. */
function Thumb({
  slide,
  theme,
  current,
  onClick
}: {
  slide: LayoutSlide
  theme: Theme | null
  current: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      data-slide={slide.index}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      aria-label={`Slide ${slide.index + 1}: ${slide.lines.join(' / ')}`}
      aria-current={current ? 'true' : undefined}
      className={cn(
        'relative flex aspect-video items-center justify-center overflow-hidden rounded-md px-1.5 pb-2.5 pt-1.5 transition-shadow',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70',
        current ? 'ring-2 ring-accent' : 'ring-1 ring-inset ring-white/5 hover:ring-white/20'
      )}
      style={themedBodyStyle(theme)}
    >
      <span
        className="line-clamp-4 whitespace-pre-line text-center text-[7.5px] font-bold leading-[1.35] text-white"
        style={themedTextStyle(theme)}
      >
        {slide.lines.join('\n')}
      </span>
      <span className="absolute bottom-0.5 left-1 text-[8px] tabular-nums text-white/55">
        {slide.index + 1}
      </span>
    </button>
  )
}
