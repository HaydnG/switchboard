import { useEffect, useRef } from 'react';
import { controlDialogKicker, controlDialogToneClass } from '@renderer/lib/control-dialogs';
import type { ActiveControlDialog, ControlDialogResult } from '@renderer/types/control-ui';

interface ControlDialogProps {
  dialog: ActiveControlDialog;
  onClose: (result: ControlDialogResult) => void;
}

export function ControlDialog({ dialog, onClose }: ControlDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const { options } = dialog;

  useEffect(() => {
    confirmRef.current?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose(false);
      if (event.key === 'Enter') {
        const target = event.target;
        if (target instanceof HTMLElement && target.matches('textarea, input')) return;
        onClose(true);
      }
    };

    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="control-dialog-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose(false);
      }}
    >
      <div
        className={`control-dialog ${controlDialogToneClass(options.tone)}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="control-dialog-title"
      >
        <div className="control-dialog-kicker">{controlDialogKicker(options.tone)}</div>
        <h3 id="control-dialog-title">{options.title}</h3>
        {options.message ? <p>{options.message}</p> : null}
        {options.details.length > 0 && (
          <div className="control-dialog-details">
            {options.details.map((row) => (
              <div className="control-dialog-detail-row" key={`${row.label}:${row.value}`}>
                <span className="control-dialog-detail-label">{row.label}</span>
                <span className="control-dialog-detail-value">{row.value}</span>
              </div>
            ))}
          </div>
        )}
        <div className="control-dialog-actions">
          {options.cancelLabel ? (
            <button type="button" className="control-dialog-cancel" onClick={() => onClose(false)}>
              {options.cancelLabel}
            </button>
          ) : null}
          {options.secondaryLabel ? (
            <button
              type="button"
              className="control-dialog-secondary"
              onClick={() => onClose('secondary')}
            >
              {options.secondaryLabel}
            </button>
          ) : null}
          <button
            ref={confirmRef}
            type="button"
            className="control-dialog-confirm"
            onClick={() => onClose(true)}
          >
            {options.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
