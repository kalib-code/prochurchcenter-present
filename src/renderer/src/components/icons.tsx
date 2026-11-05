/**
 * Minimal stroke icon set (24px grid, 1.75 stroke, currentColor).
 * Inline SVG rather than an icon library — the app needs a handful.
 */
import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function Icon({ size = 18, children, ...rest }: IconProps & { children: React.ReactNode }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  )
}

export const HomeIcon = (p: IconProps): JSX.Element => (
  <Icon {...p}><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V20h14V9.5" /><path d="M10 20v-6h4v6" /></Icon>
)
export const MusicIcon = (p: IconProps): JSX.Element => (
  <Icon {...p}><path d="M9 18V5l11-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="17" cy="16" r="3" /></Icon>
)
export const SettingsIcon = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </Icon>
)
export const PlusIcon = (p: IconProps): JSX.Element => (
  <Icon {...p}><path d="M12 5v14M5 12h14" /></Icon>
)
export const PlayIcon = (p: IconProps): JSX.Element => (
  <Icon {...p}><path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none" /></Icon>
)
export const CalendarIcon = (p: IconProps): JSX.Element => (
  <Icon {...p}><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></Icon>
)
export const SearchIcon = (p: IconProps): JSX.Element => (
  <Icon {...p}><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></Icon>
)
export const ChevronLeftIcon = (p: IconProps): JSX.Element => (
  <Icon {...p}><path d="m15 18-6-6 6-6" /></Icon>
)
export const AlertIcon = (p: IconProps): JSX.Element => (
  <Icon {...p}><path d="M12 3 2 20h20z" /><path d="M12 10v4M12 17.5v.01" /></Icon>
)
export const CheckIcon = (p: IconProps): JSX.Element => (
  <Icon {...p}><path d="m5 12.5 4.5 4.5L19 7.5" /></Icon>
)
export const TrashIcon = (p: IconProps): JSX.Element => (
  <Icon {...p}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></Icon>
)
export const GripIcon = (p: IconProps): JSX.Element => (
  <Icon {...p}><circle cx="9" cy="6" r="1" /><circle cx="15" cy="6" r="1" /><circle cx="9" cy="12" r="1" /><circle cx="15" cy="12" r="1" /><circle cx="9" cy="18" r="1" /><circle cx="15" cy="18" r="1" /></Icon>
)
