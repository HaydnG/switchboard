import type { ReactNode } from 'react';
import { classNames } from '@renderer/components/design-system/classNames';

interface EmptyStateProps {
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
  icon?: ReactNode;
  title: ReactNode;
}

export function EmptyState({ action, children, className, icon, title }: EmptyStateProps) {
  return (
    <section className={classNames('sb-empty-state', className)}>
      {icon ? <div className="sb-empty-state__icon">{icon}</div> : null}
      <div className="sb-empty-state__copy">
        <h3 className="sb-empty-state__title">{title}</h3>
        {children ? <p className="sb-empty-state__body">{children}</p> : null}
      </div>
      {action ? <div className="sb-empty-state__action">{action}</div> : null}
    </section>
  );
}
