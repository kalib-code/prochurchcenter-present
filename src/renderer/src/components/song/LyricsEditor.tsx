/**
 * LyricsEditor — the song's lyrics as plain text, with the slide
 * structure drawn alongside it.
 *
 * Two layers with identical typography:
 *   - a "mirror" <div> that renders each line, coloured headers, the
 *     slide number in the gutter, dashed rules at automatic max-lines
 *     splits, and a tint on the slide the cursor is in;
 *   - a transparent <textarea> on top that does all the editing (caret,
 *     selection, IME, spellcheck, native undo).
 * The mirror is in normal flow and sizes the box; the textarea fills it,
 * so the two never scroll independently — the pane around them scrolls.
 * Anything that changes text width (font, size, weight, padding, wrapping)
 * must change in TEXT_STYLE, which both layers share, or the caret and the
 * coloured text drift apart. Headers are coloured, never bolded, for the
 * same reason.
 *
 * Edits made for the operator (insert section, tidy, reorder) go through
 * `document.execCommand('insertText')` so they land on the textarea's own
 * undo stack: ⌘Z undoes a tidy or a reorder like any typing.
 */

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties
} from 'react'
import type { LyricsLayout } from '../../lib/lyricsLayout'
import { lineAtOffset, offsetOfLine } from '../../lib/lyricsLayout'
import {
  SECTION_KINDS,
  nextSectionLabel,
  sectionInsertion,
  type SectionKind
} from '../../lib/lyricsEdit'
import { looksUntidy, tidyLyrics, type TidyResult } from '../../lib/tidyLyrics'
import { cn } from '../../lib/utils'
import { Button } from '../ui/Button'
import { ChevronDownIcon, MusicIcon, PlusIcon, SparkleIcon } from '../icons'
import { MenuButton } from './MenuButton'

export interface LyricsEditorHandle {
  /** Put the cursor at the start of `line` and scroll it into view. */
  focusLine: (line: number) => void
  insertSection: (kind: SectionKind) => void
  /** Replace the whole text (undoable), e.g. after reordering sections. */
  replaceAll: (text: string) => void
}

const GUTTER = 56

/** Shared by the mirror and the textarea — see the module comment. */
const TEXT_STYLE: CSSProperties = {
  fontFamily: 'inherit',
  fontSize: 15,
  lineHeight: '29px',
  letterSpacing: 'normal',
  fontWeight: 400,
  whiteSpace: 'pre-wrap',
  overflowWrap: 'break-word',
  wordBreak: 'normal',
  tabSize: 4,
  padding: `18px 24px 120px ${GUTTER}px`,
  margin: 0,
  border: 0
}

const QUICK_KINDS: SectionKind[] = ['verse', 'chorus']
const MORE_KINDS = SECTION_KINDS.filter((k) => !QUICK_KINDS.includes(k.kind))

const toolbarButton =
  'inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-raised px-2.5 text-[12.5px] font-medium text-quiet transition-colors hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70'

export const LyricsEditor = forwardRef<
  LyricsEditorHandle,
  {
    value: string
    onChange: (text: string) => void
    layout: LyricsLayout
    maxLines: number
    /** Slide the cursor is in, highlighted in the text. */
    currentSlide: number | null
    onCaretLine: (line: number) => void
    /** Called after a tidy, so the page can fill CCLI / copyright. */
    onTidied: (result: TidyResult) => void
  }
>(function LyricsEditor(
  { value, onChange, layout, maxLines, currentSlide, onCaretLine, onTidied },
  ref
) {
  const textarea = useRef<HTMLTextAreaElement>(null)
  const mirror = useRef<HTMLDivElement>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // Tidy notices fade after a few seconds.
  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 6000)
    return () => clearTimeout(t)
  }, [notice])

  /** Tell the page which line the cursor is on, and keep that line visible. */
  const reportCaret = (): void => {
    const ta = textarea.current
    if (!ta) return
    const line = lineAtOffset(ta.value, ta.selectionStart)
    onCaretLine(line)
    if (document.activeElement === ta) scrollLineIntoView(line, 'nearest')
  }

  /** Replace [start, end) through the textarea so it's undoable. */
  const replaceRange = (start: number, end: number, text: string): void => {
    const ta = textarea.current
    if (!ta) return
    ta.focus()
    ta.setSelectionRange(start, end)
    // execCommand is deprecated but is still the only way to edit a
    // textarea and keep the browser's undo stack; Chromium supports it.
    const ok = document.execCommand('insertText', false, text)
    if (!ok) {
      onChange(ta.value.slice(0, start) + text + ta.value.slice(end))
      requestAnimationFrame(() => ta.setSelectionRange(start + text.length, start + text.length))
    }
    requestAnimationFrame(reportCaret)
  }

  function scrollLineIntoView(line: number, block: ScrollLogicalPosition): void {
    mirror.current
      ?.querySelector<HTMLElement>(`[data-line="${line}"]`)
      ?.scrollIntoView({ block, behavior: block === 'center' ? 'smooth' : 'auto' })
  }

  const insertSection = (kind: SectionKind): void => {
    const ta = textarea.current
    if (!ta) return
    const label = nextSectionLabel(kind, layout)
    const { at, text } = sectionInsertion(ta.value, ta.selectionEnd, label)
    replaceRange(at, at, text)
  }

  const applyTidy = (result: TidyResult, start: number, end: number): void => {
    replaceRange(start, end, result.text)
    onTidied(result)
    setNotice(
      result.changes.length > 0
        ? `${result.changes.join(' · ')}. ⌘Z to undo.`
        : 'Already tidy — nothing to change.'
    )
  }

  useImperativeHandle(ref, () => ({
    focusLine: (line) => {
      const ta = textarea.current
      if (!ta) return
      const at = offsetOfLine(ta.value, line)
      ta.focus({ preventScroll: true })
      ta.setSelectionRange(at, at)
      onCaretLine(line)
      scrollLineIntoView(line, 'center')
    },
    insertSection,
    replaceAll: (text) => replaceRange(0, textarea.current?.value.length ?? 0, text)
  }))

  const pasteFromClipboard = async (): Promise<void> => {
    const text = await navigator.clipboard.readText().catch(() => '')
    if (!text.trim()) {
      textarea.current?.focus()
      setNotice('The clipboard is empty — copy the lyrics first, then paste.')
      return
    }
    applyTidy(tidyLyrics(text), 0, value.length)
  }

  const rows = value.split('\n')
  const empty = value.trim() === ''

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-1.5 border-b border-rule px-4 py-2.5">
        {QUICK_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            className={toolbarButton}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => insertSection(kind)}
          >
            <PlusIcon size={13} />
            {SECTION_KINDS.find((k) => k.kind === kind)!.label}
          </button>
        ))}
        <MenuButton
          className={toolbarButton}
          label={
            <>
              More <ChevronDownIcon size={13} />
            </>
          }
          items={MORE_KINDS.map((k) => ({ id: k.kind, label: k.label }))}
          onPick={(id) => insertSection(id as SectionKind)}
        />
        <div className="ml-auto">
          <button
            type="button"
            className={toolbarButton}
            title="Remove chord lines, turn “Chorus:” into [Chorus], fill in repeats, clean blank lines"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => applyTidy(tidyLyrics(value), 0, value.length)}
            disabled={empty}
          >
            <SparkleIcon size={13} />
            Tidy lyrics
          </button>
        </div>
      </div>

      {notice && (
        <div
          role="status"
          className="flex shrink-0 items-center gap-2 border-b border-rule bg-ok/[0.06] px-4 py-2 text-[12.5px] text-soft"
        >
          <SparkleIcon size={13} className="shrink-0 text-ok" />
          <span className="min-w-0 flex-1">{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="shrink-0 rounded px-1.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Text */}
      <div className="scroll-hairline relative min-h-0 flex-1 overflow-y-auto">
        <div className="relative">
          <div ref={mirror} aria-hidden="true" style={TEXT_STYLE} className="pointer-events-none">
            {rows.map((row, i) => {
              const info = layout.lines[i]
              const isCurrent = info?.slide !== null && info?.slide === currentSlide
              return (
                <div
                  key={i}
                  data-line={i}
                  className={cn(
                    'relative',
                    info?.kind === 'header' ? 'text-accent' : 'text-bone',
                    isCurrent && 'bg-accent/[0.07] shadow-[inset_2px_0_0_hsl(var(--accent)/0.55)]'
                  )}
                >
                  {info?.slideStart && info.slide !== null && (
                    <span
                      className={cn(
                        'absolute top-[6px] flex h-[18px] min-w-[22px] items-center justify-center rounded-[5px] px-1 text-[11px] font-medium tabular-nums',
                        isCurrent ? 'bg-accent text-app' : 'bg-hover text-quiet'
                      )}
                      style={{ left: -GUTTER + 16 }}
                    >
                      {info.slide + 1}
                    </span>
                  )}
                  {info?.autoSplit && (
                    <span className="absolute -top-px left-0 right-0 flex items-center">
                      <span className="flex-1 border-t border-dashed border-dim/80" />
                      <span className="-mt-px bg-panel pl-2 text-[11px] leading-none text-muted-foreground">
                        auto-split · max {maxLines} lines
                      </span>
                    </span>
                  )}
                  {row === '' ? '​' : row}
                </div>
              )
            })}
          </div>

          <textarea
            ref={textarea}
            id="song-lyrics"
            aria-label="Lyrics"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onSelect={reportCaret}
            onPaste={(e) => {
              // A paste into an empty song is the "add a new song" moment:
              // tidy it straight away. Elsewhere paste as-is; Tidy is one click.
              const ta = e.currentTarget
              const text = e.clipboardData.getData('text/plain')
              const replacingAll = ta.selectionStart === 0 && ta.selectionEnd === ta.value.length
              if ((empty || replacingAll) && looksUntidy(text)) {
                e.preventDefault()
                applyTidy(tidyLyrics(text), 0, ta.value.length)
              }
            }}
            spellCheck={false}
            style={TEXT_STYLE}
            className="absolute inset-0 h-full w-full resize-none overflow-hidden bg-transparent text-transparent caret-foreground outline-none selection:bg-accent/30 placeholder:text-dim"
            placeholder={empty ? 'Type or paste lyrics…' : undefined}
          />
        </div>

        {empty && (
          <EmptyLyrics
            maxLines={maxLines}
            onPaste={pasteFromClipboard}
            onType={() => textarea.current?.focus()}
          />
        )}
      </div>
    </div>
  )
})

function EmptyLyrics({
  maxLines,
  onPaste,
  onType
}: {
  maxLines: number
  onPaste: () => void
  onType: () => void
}): JSX.Element {
  return (
    <div className="absolute inset-x-0 top-24 flex justify-center px-8">
      <div className="w-full max-w-[440px] text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-raised text-quiet">
          <MusicIcon size={22} />
        </div>
        <h3 className="text-[17px] font-semibold text-foreground">Paste or type the lyrics</h3>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-soft">
          Copy lyrics from any website and paste them here. Present tidies them up: chord lines
          removed, “Chorus:” turned into a section, repeats filled in, extra blank lines cleaned.
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <Button variant="primary" onClick={onPaste}>
            Paste lyrics
          </Button>
          <Button variant="secondary" onClick={onType}>
            Start typing
          </Button>
        </div>
        <div className="mt-6 rounded-lg border border-dashed border-border px-4 py-3 text-left text-[12.5px] leading-[1.8] text-muted-foreground">
          <div className="font-medium text-quiet">Format</div>
          <div>
            <span className="text-accent">[Verse 1]</span> starts a section
          </div>
          <div>A blank line starts a new slide</div>
          <div>
            Long sections split automatically (max {maxLines} lines per slide)
          </div>
        </div>
      </div>
    </div>
  )
}
