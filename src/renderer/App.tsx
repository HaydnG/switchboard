import { createPortal } from 'react-dom';
import { ControlUiHost } from '@renderer/components/ControlUiHost';
import { StatusBar } from '@renderer/components/StatusBar';
import { SwitchboardShell } from '@renderer/components/SwitchboardShell';
import { UpdateToast } from '@renderer/components/UpdateToast';
import { useUpdater } from '@renderer/hooks/useUpdater';

/**
 * Root React shell. Mounts alongside the legacy vanilla renderer and
 * incrementally replaces UI islands. See docs/react-migration.md.
 */
export function App() {
  const { toast, updaterStatus, pendingUpdate, dismissToast, restartToUpdate } = useUpdater();

  return (
    <>
      <SwitchboardShell />
      {createPortal(
        <StatusBar
          updaterStatus={updaterStatus}
          pendingUpdate={pendingUpdate}
          onRestart={restartToUpdate}
        />,
        document.body,
      )}
      <ControlUiHost />
      {toast && (
        <UpdateToast
          toast={toast}
          onRestart={restartToUpdate}
          onDismiss={() => dismissToast(toast.version)}
        />
      )}
    </>
  );
}
