import type { ReactNode } from 'react';
import { classNames } from '@renderer/components/design-system/classNames';

interface PanelHeaderProps {
  actions?: ReactNode;
  className?: string;
  description?: ReactNode;
  eyebrow?: ReactNode;
  title: ReactNode;
}

export function PanelHeader({ actions, className, description, eyebrow, title }: PanelHeaderProps) {
  return (
    <header className={classNames('sb-panel-header', className)}>
      <div className="sb-panel-header__copy">
        {eyebrow ? <div className="sb-panel-header__eyebrow">{eyebrow}</div> : null}
        <h2 className="sb-panel-header__title">{title}</h2>
        {description ? <div className="sb-panel-header__description">{description}</div> : null}
      </div>
      {actions ? <div className="sb-panel-header__actions">{actions}</div> : null}
    </header>
  );
}
