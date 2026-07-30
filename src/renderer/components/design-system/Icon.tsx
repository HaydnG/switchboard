import type { ReactNode, SVGProps } from 'react';
import { classNames } from '@renderer/components/design-system/classNames';

export type IconName =
  | 'attention'
  | 'chevronRight'
  | 'grid'
  | 'panel'
  | 'refresh'
  | 'search'
  | 'settings'
  | 'sidebar'
  | 'spark';

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  label?: string;
  size?: number;
}

const iconPaths: Record<IconName, ReactNode> = {
  attention: (
    <>
      <path d="M12 3 2.8 19h18.4L12 3Z" />
      <path d="M12 9v4m0 3h.01" />
    </>
  ),
  chevronRight: <path d="m9 5 7 7-7 7" />,
  grid: <path d="M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm10 0h6v6h-6v-6Z" />,
  panel: (
    <>
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <path d="M4 10h16M10 10v9" />
    </>
  ),
  refresh: <path d="M20 6v5h-5M4 18v-5h5M18.2 9A7 7 0 0 0 6.1 6.7M5.8 15a7 7 0 0 0 12.1 2.3" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="m16 16 4 4" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
    </>
  ),
  sidebar: (
    <>
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <path d="M9 5v14M13 12h4" />
    </>
  ),
  spark: (
    <>
      <path d="M12 3v5M12 16v5M3 12h5M16 12h5" />
      <path d="m6.5 6.5 3 3M14.5 14.5l3 3M17.5 6.5l-3 3M9.5 14.5l-3 3" />
    </>
  ),
};

export function Icon({ name, label, size = 16, className, ...props }: IconProps) {
  return (
    <svg
      className={classNames('sb-icon', className)}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : true}
      aria-label={label}
      focusable="false"
      role={label ? 'img' : undefined}
      {...props}
    >
      {iconPaths[name]}
    </svg>
  );
}
