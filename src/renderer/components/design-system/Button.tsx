import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { classNames } from '@renderer/components/design-system/classNames';

type ButtonVariant = 'danger' | 'ghost' | 'primary' | 'secondary';
type ButtonSize = 'md' | 'sm';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: ReactNode;
  iconPosition?: 'end' | 'start';
  size?: ButtonSize;
  variant?: ButtonVariant;
}

export function Button({
  children,
  className,
  icon,
  iconPosition = 'start',
  size = 'md',
  type = 'button',
  variant = 'secondary',
  ...props
}: ButtonProps) {
  const hasText = children !== undefined && children !== null;

  return (
    <button
      className={classNames(
        'sb-button',
        `sb-button--${variant}`,
        `sb-button--${size}`,
        !hasText && 'sb-button--icon-only',
        className,
      )}
      type={type}
      {...props}
    >
      {icon && iconPosition === 'start' ? <span className="sb-button__icon">{icon}</span> : null}
      {hasText ? <span className="sb-button__label">{children}</span> : null}
      {icon && iconPosition === 'end' ? <span className="sb-button__icon">{icon}</span> : null}
    </button>
  );
}
