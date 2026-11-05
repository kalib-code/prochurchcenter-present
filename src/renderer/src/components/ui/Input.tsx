/**
 * Form controls. One look for every field in the app: raised surface,
 * hairline outline, accent focus ring, 8px radius.
 *
 * `fieldClass` is exported for the rare control that can't use these
 * components directly (e.g. a third-party input).
 */
import { forwardRef, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { cn } from '../../lib/utils'

export const fieldClass =
  'w-full rounded-md border border-border bg-raised px-3 text-[14px] text-foreground ' +
  'placeholder:text-dim transition-colors hover:border-border/100 ' +
  'focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/25 ' +
  'disabled:cursor-not-allowed disabled:opacity-50'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    return <input ref={ref} className={cn(fieldClass, 'h-9', className)} {...rest} />
  }
)

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...rest }, ref) {
    return <textarea ref={ref} className={cn(fieldClass, 'py-2 leading-relaxed', className)} {...rest} />
  }
)

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, ...rest }, ref) {
    return <select ref={ref} className={cn(fieldClass, 'h-9 pr-8', className)} {...rest} />
  }
)

/** Label + optional hint wrapper for a single field. */
export function Field({
  label,
  hint,
  children,
  className
}: {
  label: string
  hint?: string
  children: React.ReactNode
  className?: string
}): JSX.Element {
  return (
    <label className={cn('flex flex-col gap-1.5', className)}>
      <span className="flex items-baseline justify-between gap-2 text-[13px] font-medium text-quiet">
        {label}
        {hint && <span className="text-[12px] font-normal text-muted-foreground">{hint}</span>}
      </span>
      {children}
    </label>
  )
}
