import type { UpdateToastState } from '@renderer/hooks/useUpdater';

const RELEASE_NOTES_URL = 'https://github.com/doctly/switchboard/releases';

interface UpdateToastProps {
  toast: UpdateToastState;
  onRestart: () => void;
  onDismiss: () => void;
}

function shouldShowReleaseSummary(version: string, releaseName?: string): boolean {
  if (!releaseName) return false;
  return releaseName !== `v${version}` && releaseName !== version;
}

export function UpdateToast({ toast, onRestart, onDismiss }: UpdateToastProps) {
  const { version, releaseName } = toast;

  return (
    <div id="update-toast" role="status" aria-live="polite">
      <span id="update-toast-msg">
        New Version Ready
        <br />
        <span className="update-version">v{version}</span>{' '}
        (
        <a href={RELEASE_NOTES_URL} target="_blank" rel="noreferrer" className="update-notes-link">
          release notes
        </a>
        )
        {shouldShowReleaseSummary(version, releaseName) && (
          <span className="update-summary">{releaseName}</span>
        )}
      </span>
      <button id="update-restart-btn" type="button" onClick={onRestart}>
        Restart
      </button>
      <button id="update-dismiss-btn" type="button" onClick={onDismiss}>
        Later
      </button>
    </div>
  );
}
