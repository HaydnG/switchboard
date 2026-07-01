import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ControlDialog } from '@renderer/components/ControlDialog';
import { ControlToastStack } from '@renderer/components/ControlToastStack';
import { normalizeControlDialogOptions } from '@renderer/lib/control-dialogs';
import { registerControlUi } from '@renderer/lib/control-ui-bridge';
import type {
  ActiveControlDialog,
  ControlDialogOptions,
  ControlDialogResult,
  ControlToastItem,
  ControlToastOptions,
} from '@renderer/types/control-ui';

let nextControlUiId = 0;

function createControlUiId(prefix: string) {
  nextControlUiId += 1;
  return `${prefix}-${nextControlUiId}`;
}

export function ControlUiHost() {
  const [activeDialog, setActiveDialog] = useState<ActiveControlDialog | null>(null);
  const [toasts, setToasts] = useState<ControlToastItem[]>([]);
  const toastTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismissToast = useCallback((id: string) => {
    const timer = toastTimersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      toastTimersRef.current.delete(id);
    }
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const pushToast = useCallback(
    ({ message, actionLabel, onAction, timeoutMs = 8000 }: ControlToastOptions) => {
      const id = createControlUiId('toast');
      const toast: ControlToastItem = { id, message, actionLabel, onAction, timeoutMs };
      setToasts((current) => [...current, toast]);

      const timer = setTimeout(() => dismissToast(id), timeoutMs);
      toastTimersRef.current.set(id, timer);
    },
    [dismissToast],
  );

  const showDialog = useCallback((options: ControlDialogOptions) => {
    const normalized = normalizeControlDialogOptions(options);
    return new Promise<ControlDialogResult>((resolve) => {
      setActiveDialog({
        id: createControlUiId('dialog'),
        options: normalized,
        resolve,
      });
    });
  }, []);

  const closeDialog = useCallback((result: ControlDialogResult) => {
    setActiveDialog((current) => {
      current?.resolve(result);
      return null;
    });
  }, []);

  useLayoutEffect(() => {
    registerControlUi({ showDialog, showToast: pushToast });
    return () => registerControlUi({ showDialog: async () => false, showToast: () => {} });
  }, [pushToast, showDialog]);

  return createPortal(
    <>
      {activeDialog ? <ControlDialog dialog={activeDialog} onClose={closeDialog} /> : null}
      <ControlToastStack toasts={toasts} onDismiss={dismissToast} />
    </>,
    document.body,
  );
}
