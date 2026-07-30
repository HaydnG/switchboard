import type { HTMLAttributes, ReactNode } from 'react';
import { classNames } from '@renderer/components/design-system/classNames';

type ChipTone = 'danger' | 'info' | 'neutral' | 'success' | 'warning';

interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode;
  tone?: ChipTone;
}

export function Chip({ children, className, tone = 'neutral', ...props }: ChipProps) {
  return (
    <span className={classNames('sb-chip', `sb-chip--${tone}`, className)} {...props}>
      {children}
    </span>
  );
}
