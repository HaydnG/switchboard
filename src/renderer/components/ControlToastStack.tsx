import type { ControlToastItem } from '@renderer/types/control-ui';

interface ControlToastStackProps {
  toasts: ControlToastItem[];
  onDismiss: (id: string) => void;
}

export function ControlToastStack({ toasts, onDismiss }: ControlToastStackProps) {
  if (toasts.length === 0) return null;

  return (
    <>
      {toasts.map((toast) => (
        <div key={toast.id} className="control-toast">
          <span>{toast.message}</span>
          {toast.actionLabel && toast.onAction ? (
            <button
              type="button"
              onClick={async () => {
                onDismiss(toast.id);
                await toast.onAction?.();
              }}
            >
              {toast.actionLabel}
            </button>
          ) : null}
        </div>
      ))}
    </>
  );
}
