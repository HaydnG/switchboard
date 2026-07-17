import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getApi,
  type UpdaterDownloadedPayload,
  type UpdaterEventType,
  type UpdaterEventData,
} from '@renderer/types/api';

const UPDATE_DISMISSED_KEY = 'update-dismissed';

export interface UpdateToastState {
  version: string;
  releaseName?: string;
}

function isDownloadedPayload(data: UpdaterEventData | undefined): data is UpdaterDownloadedPayload {
  return !!data && typeof (data as UpdaterDownloadedPayload).version === 'string';
}

export function useUpdater() {
  const [toast, setToast] = useState<UpdateToastState | null>(null);
  const [updaterStatus, setUpdaterStatusState] = useState('');
  const [pendingUpdate, setPendingUpdate] = useState<UpdateToastState | null>(null);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearStatusTimer = useCallback(() => {
    if (statusTimerRef.current) {
      clearTimeout(statusTimerRef.current);
      statusTimerRef.current = null;
    }
  }, []);

  const setUpdaterStatus = useCallback((text: string, durationMs?: number) => {
    clearStatusTimer();
    setUpdaterStatusState(text);
    if (durationMs) {
      statusTimerRef.current = setTimeout(() => {
        setUpdaterStatusState('');
        statusTimerRef.current = null;
      }, durationMs);
    }
  }, [clearStatusTimer]);

  useEffect(() => {
    const api = getApi();

    const handler = (type: UpdaterEventType, data?: UpdaterEventData) => {
      switch (type) {
        case 'checking':
          setUpdaterStatus('Checking for updates…');
          break;
        case 'update-available':
          setUpdaterStatus(`Downloading v${(data as { version?: string })?.version ?? '…'}…`);
          break;
        case 'update-not-available':
          setUpdaterStatus('Up to date', 3000);
          break;
        case 'download-progress':
          setUpdaterStatus(`Updating… ${Math.round((data as { percent?: number })?.percent ?? 0)}%`);
          break;
        case 'update-downloaded': {
          if (!isDownloadedPayload(data)) break;
          const update = { version: data.version, releaseName: data.releaseName };
          setPendingUpdate(update);
          setUpdaterStatus(`v${data.version} ready — restart to update`);
          const dismissed = localStorage.getItem(UPDATE_DISMISSED_KEY);
          if (dismissed === data.version) break;
          setToast(update);
          break;
        }
        case 'error':
          setUpdaterStatus('Update check failed', 5000);
          break;
      }
    };

    api.onUpdaterEvent(handler);
    return () => {
      clearStatusTimer();
    };
  }, [clearStatusTimer, setUpdaterStatus]);

  const dismissToast = useCallback((version: string) => {
    setToast(null);
    localStorage.setItem(UPDATE_DISMISSED_KEY, version);
  }, []);

  const restartToUpdate = useCallback(async () => {
    window.dispatchEvent(new CustomEvent('switchboard:save-update-restart-state'));
    const result = await getApi().updaterInstall();
    if (result?.ok === false) {
      const message = result.dev
        ? 'Update restart is only available in packaged builds.'
        : (result.error || 'Update restart failed. Please reinstall from the releases page.');
      window.showControlToast({ message });
    }
  }, []);

  return { toast, updaterStatus, pendingUpdate, dismissToast, restartToUpdate };
}
