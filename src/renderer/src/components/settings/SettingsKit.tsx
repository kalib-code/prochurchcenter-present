/**
 * Settings building blocks — the row/group vocabulary shared by every
 * Settings section and by ThemeFields.
 *
 *   SettingsGroup  a Panel with a sentence-case title (+ optional
 *                  description and header action); rows are divided by
 *                  quiet rules, not boxes.
 *   SettingRow     label + description on the left, control on the right.
 *   Switch         a styled native checkbox, so onChange still receives
 *                  `e.target.checked` and keyboard/forms behave natively.
 *   ColorInput     a native colour picker in the shared control shape.
 *   RangeInput     a native slider with a tabular value readout.
 *   Notice         a status strip coloured by meaning (ok / warn / neutral).
 */

import type { ChangeEvent, InputHTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/utils'
import { Panel } from '../ui/Card'
import { AlertIcon, CheckIcon } from '../icons'

export function SettingsGroup({
  title,
  description,
  action,
  children,
  className
}: {
  title: string
  description?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}): JSX.Element {
  return (
    <Panel
      className={className}
      title={
        <div className="min-w-0">
          <h3 className="text-[14px] font-semibold text-foreground">{title}</h3>
          {description && (
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">
              {description}
            </p>
          )}
        </div>
      }
      action={action}
    >
      <div className="divide-y divide-rule">{children}</div>
    </Panel>
  )
}

export function SettingRow({
  label,
  description,
  htmlFor,
  below,
  children
}: {
  label: string
  description?: ReactNode
  /** id of the control, so clicking the label focuses it. */
  htmlFor?: string
  /** Optional full-width content under the row (e.g. a list). */
  below?: ReactNode
  children?: ReactNode
}): JSX.Element {
  const LabelTag = htmlFor ? 'label' : 'div'
  return (
    <div className="px-4 py-3.5">
      <div className="flex items-center justify-between gap-6">
        <div className="min-w-0 flex-1">
          <LabelTag
            {...(htmlFor ? { htmlFor } : {})}
            className="block text-[13.5px] font-medium text-foreground"
          >
            {label}
          </LabelTag>
          {description && (
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {children !== undefined && <div className="flex shrink-0 items-center">{children}</div>}
      </div>
      {below && <div className="mt-3">{below}</div>}
    </div>
  )
}

export function Switch({
  checked,
  onChange,
  id,
  'aria-label': ariaLabel,
  disabled
}: {
  checked: boolean
  onChange: (e: ChangeEvent<HTMLInputElement>) => void
  id?: string
  'aria-label'?: string
  disabled?: boolean
}): JSX.Element {
  return (
    <span className="relative inline-flex h-5 w-9 shrink-0">
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={onChange}
        aria-label={ariaLabel}
        disabled={disabled}
        className="peer absolute inset-0 z-10 m-0 h-full w-full cursor-pointer appearance-none rounded-full focus-visible:outline-none disabled:cursor-not-allowed"
      />
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-0 rounded-full transition-colors',
          'peer-focus-visible:ring-2 peer-focus-visible:ring-accent/70 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-raised',
          'peer-disabled:opacity-50',
          checked ? 'bg-accent' : 'bg-hover ring-1 ring-inset ring-border'
        )}
      />
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute left-0.5 top-0.5 h-4 w-4 rounded-full shadow-sm transition-transform',
          checked ? 'translate-x-4 bg-white' : 'translate-x-0 bg-soft'
        )}
      />
    </span>
  )
}

export function ColorInput({
  className,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>): JSX.Element {
  return (
    <input
      type="color"
      className={cn(
        'h-9 w-12 cursor-pointer rounded-md border border-border bg-raised p-1 transition-colors hover:bg-hover',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70',
        '[&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded [&::-webkit-color-swatch]:border-0',
        className
      )}
      {...rest}
    />
  )
}

export function RangeInput({
  readout,
  className,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  readout: string
}): JSX.Element {
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        className={cn(
          'w-32 cursor-pointer accent-accent',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 rounded-full',
          className
        )}
        {...rest}
      />
      <span className="w-14 text-right text-[13px] tabular-nums text-soft">{readout}</span>
    </div>
  )
}

type NoticeTone = 'ok' | 'warn' | 'neutral'

const NOTICE_TONES: Record<NoticeTone, string> = {
  ok: 'border-ok/25 bg-ok/10',
  warn: 'border-warn/30 bg-warn/10',
  neutral: 'border-border bg-raised'
}

export function Notice({
  tone,
  children,
  className
}: {
  tone: NoticeTone
  children: ReactNode
  className?: string
}): JSX.Element {
  return (
    <div
      role={tone === 'warn' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-[13px] leading-relaxed text-bone',
        NOTICE_TONES[tone],
        className
      )}
    >
      {tone === 'warn' && <AlertIcon size={16} className="mt-0.5 shrink-0 text-warn" />}
      {tone === 'ok' && <CheckIcon size={16} className="mt-0.5 shrink-0 text-ok" />}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
