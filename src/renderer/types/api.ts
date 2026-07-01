/** Typed surface of preload.js — expand as modules migrate to React. */

import type {
  ControlDialogOptions,
  ControlDialogResult,
  ControlToastOptions,
} from '@renderer/types/control-ui';

export type {
  ControlDialogOptions,
  ControlDialogResult,
  ControlToastOptions,
};

export type UpdaterEventType =
  | 'checking'
  | 'update-available'
  | 'update-not-available'
  | 'download-progress'
  | 'update-downloaded'
  | 'error';

export interface UpdaterDownloadProgress {
  percent: number;
}

export interface UpdaterDownloadedPayload {
  version: string;
  releaseName?: string;
}

export type UpdaterEventData =
  | UpdaterDownloadProgress
  | UpdaterDownloadedPayload
  | Record<string, unknown>
  | undefined;

export interface UpdaterInstallResult {
  ok?: boolean;
  dev?: boolean;
  error?: string;
}

export interface SwitchboardApi {
  updaterCheck: () => Promise<unknown>;
  updaterDownload: () => Promise<unknown>;
  updaterInstall: () => Promise<UpdaterInstallResult>;
  onUpdaterEvent: (callback: (type: UpdaterEventType, data?: UpdaterEventData) => void) => void;
  platform: string;
  isPackaged: boolean;
  getAppVersion: () => Promise<string>;
}

declare global {
  interface Window {
    api: SwitchboardApi;
    showControlDialog: (options: ControlDialogOptions) => Promise<ControlDialogResult>;
    showControlMessage: (options: ControlDialogOptions) => Promise<ControlDialogResult>;
    showControlToast: (options: ControlToastOptions) => void;
  }

  interface WindowEventMap {
    'switchboard:save-update-restart-state': CustomEvent<void>;
  }
}

export function getApi(): SwitchboardApi {
  if (!window.api) {
    throw new Error('window.api is not available — preload may not have loaded');
  }
  return window.api;
}
