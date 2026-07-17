import type { UpdateToastState } from '@renderer/hooks/useUpdater';

interface StatusBarProps {
  updaterStatus: string;
  pendingUpdate: UpdateToastState | null;
  onRestart: () => void;
}

/** Status bar shell — legacy app.js still updates child nodes by id. */
export function StatusBar({ updaterStatus, pendingUpdate, onRestart }: StatusBarProps) {
  return (
    <div id="status-bar">
      <span id="status-bar-info" />
      <span id="status-bar-usage" />
      <span id="status-bar-activity" />
      <span id="status-bar-updater">
        {updaterStatus}
        {pendingUpdate && (
          <button
            id="status-bar-update-restart-btn"
            type="button"
            onClick={onRestart}
          >
            Restart
          </button>
        )}
      </span>
    </div>
  );
}
