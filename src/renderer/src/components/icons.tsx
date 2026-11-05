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

// ── Settings section nav ────────────────────────────────────────────────
export const TextLinesIcon = (p: IconProps): JSX.Element => (
  <Icon {...p}><rect x="3" y="4.5" width="18" height="15" rx="2" /><path d="M7.5 10h9M9 14h6" /></Icon>
)
export const PaletteIcon = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.8-.8 1.8-1.8 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3z" />
    <circle cx="7.5" cy="11" r="1" /><circle cx="10" cy="7" r="1" /><circle cx="14.5" cy="7" r="1" />
  </Icon>
)
export const ProjectorIcon = (p: IconProps): JSX.Element => (
  <Icon {...p}><rect x="2.5" y="4" width="19" height="12.5" rx="2" /><path d="M8 20h8M12 16.5V20" /></Icon>
)
export const ArchiveIcon = (p: IconProps): JSX.Element => (
  <Icon {...p}><rect x="3" y="4" width="18" height="4.5" rx="1" /><path d="M5 8.5V19a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8.5M10 12.5h4" /></Icon>
)
export const InfoCircleIcon = (p: IconProps): JSX.Element => (
  <Icon {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v5.5M12 7.5v.01" /></Icon>
)
export const RefreshCwIcon = (p: IconProps): JSX.Element => (
  <Icon {...p}><path d="M20 11a8 8 0 0 0-14.8-3.5M4 4v4h4" /><path d="M4 13a8 8 0 0 0 14.8 3.5M20 20v-4h-4" /></Icon>
)
export const LinkChainIcon = (p: IconProps): JSX.Element => (
  <Icon {...p}><path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1" /><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" /></Icon>
)
export const CopyIcon = (p: IconProps): JSX.Element => (
  <Icon {...p}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" /></Icon>
)
export const CloseIcon = (p: IconProps): JSX.Element => (
  <Icon {...p}><path d="M6 6l12 12M18 6 6 18" /></Icon>
)
export const ClockIcon = (p: IconProps): JSX.Element => (
  <Icon {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></Icon>
)
