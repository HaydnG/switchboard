/** Typed surface of preload.js — expand as modules migrate to React. */

import type {
  ControlDialogOptions,
  ControlDialogResult,
  ControlToastOptions,
} from '@renderer/types/control-ui';
import type { LegacyShellAction } from '@renderer/lib/legacy-shell-bridge';

export type { ControlDialogOptions, ControlDialogResult, ControlToastOptions };

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
  UpdaterDownloadProgress | UpdaterDownloadedPayload | Record<string, unknown> | undefined;

export interface UpdaterInstallResult {
  ok?: boolean;
  dev?: boolean;
  error?: string;
}

export interface ApiResult<T = undefined> {
  ok: boolean;
  error?: string;
  canceled?: boolean;
  value?: T;
}

export interface SessionAnnotations {
  note: string;
  tags: string[];
  updatedAt?: string | null;
}

export interface SavedView {
  id: string;
  name: string;
  definition: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

export interface ScheduleSummary {
  id: string;
  file: string;
  filePath: string;
  projectPath: string;
  name: string;
  cron: string;
  slug: string;
  enabled: boolean;
}

export interface ScheduleRun {
  id: string;
  scheduleId: string;
  status: 'running' | 'succeeded' | 'failed' | string;
  startedAt: string;
  finishedAt?: string | null;
  sessionId?: string | null;
  runtime?: string | null;
  metadata?: Record<string, unknown> | null;
  error?: string | null;
}

export interface SearchResult {
  id: string;
  type: 'session' | 'plan' | 'memory' | string;
  snippet?: string;
}

export type EventCallback = (...args: unknown[]) => void;

export interface SwitchboardApi {
  getPlans: () => Promise<unknown[]>;
  readPlan: (filename: string) => Promise<{ content: string; filePath: string }>;
  savePlan: (filePath: string, content: string) => Promise<ApiResult>;
  getStats: () => Promise<unknown>;
  refreshStats: () => Promise<unknown>;
  getUsage: () => Promise<unknown>;
  getMemories: () => Promise<unknown>;
  readMemory: (filePath: string) => Promise<string>;
  saveMemory: (filePath: string, content: string) => Promise<ApiResult>;
  getProjects: (showArchived?: boolean) => Promise<unknown[]>;
  getActiveSessions: () => Promise<string[]>;
  getActiveTerminals: () => Promise<Array<{ sessionId: string; projectPath: string }>>;
  stopSession: (id: string) => Promise<unknown>;
  getGitSummary: (projectPath: string) => Promise<unknown>;
  toggleStar: (id: string) => Promise<unknown>;
  renameSession: (id: string, name: string) => Promise<unknown>;
  archiveSession: (id: string, archived: boolean) => Promise<unknown>;
  openTerminal: (
    id: string,
    projectPath: string,
    isNew: boolean,
    sessionOptions?: Record<string, unknown>,
  ) => Promise<{ ok: boolean; error?: string; mcpActive?: boolean }>;
  search: (type: string, query: string, titleOnly?: boolean) => Promise<SearchResult[]>;
  readSessionJsonl: (sessionId: string) => Promise<{ entries?: unknown[] }>;
  getSetting: <T = unknown>(key: string) => Promise<T | null>;
  setSetting: (key: string, value: unknown) => Promise<unknown>;
  deleteSetting: (key: string) => Promise<unknown>;
  getEffectiveSettings: (projectPath?: string) => Promise<Record<string, unknown>>;
  listSavedViews: () => Promise<SavedView[]>;
  saveSavedView: (view: SavedView) => Promise<{ ok: boolean; view?: SavedView; error?: string }>;
  deleteSavedView: (id: string) => Promise<{ ok: boolean; deleted?: boolean; error?: string }>;
  getSessionAnnotations: (sessionId: string) => Promise<SessionAnnotations>;
  setSessionAnnotations: (
    sessionId: string,
    annotations: SessionAnnotations,
  ) => Promise<{ ok: boolean; note?: string; tags?: string[]; error?: string }>;
  getAgentRuntimes: () => Promise<unknown[]>;
  getScheduleCreatorCommand: () => Promise<string | null>;
  createScheduleSession: (
    projectPath: string,
  ) => Promise<{ sessionId: string; systemPrompt: string } | null>;
  getSchedules: () => Promise<ScheduleSummary[]>;
  runScheduleNow: (
    filePath: string,
  ) => Promise<{ ok: boolean; sessionId?: string; error?: string }>;
  listScheduleRuns: (scheduleId: string, limit?: number) => Promise<ScheduleRun[]>;
  getShellProfiles: () => Promise<unknown[]>;
  browseFolder: () => Promise<string | null>;
  addProject: (projectPath: string) => Promise<unknown>;
  removeProject: (projectPath: string) => Promise<unknown>;
  remapProject: (oldPath: string, newPath: string) => Promise<unknown>;
  openExternal: (url: string) => Promise<unknown>;
  writeClipboard: (text: string) => Promise<void>;
  sendInput: (id: string, data: string) => void;
  resizeTerminal: (id: string, cols: number, rows: number) => void;
  closeTerminal: (id: string) => void;
  notify: (payload: unknown) => void;
  setBadge: (count: number) => void;
  setTraySummary: (text: string) => void;
  onFocusSession: (callback: (id: string) => void) => void;
  onFocusNextAttention: (callback: () => void) => void;
  onTerminalData: (callback: (sessionId: string, data: string) => void) => void;
  onSessionDetected: (callback: (tempId: string, realId: string) => void) => void;
  onProcessExited: (callback: (sessionId: string, exitCode: number | null) => void) => void;
  onTerminalNotification: (callback: (sessionId: string, message: string) => void) => void;
  onCliBusyState: (callback: (sessionId: string, busy: boolean) => void) => void;
  onAttentionSignal: (callback: (signal: unknown) => void) => void;
  configureAttentionHook: (enabled: boolean) => Promise<ApiResult>;
  onSessionForked: (callback: (oldId: string, newId: string) => void) => void;
  onProjectsChanged: (callback: () => void) => void;
  onStatusUpdate: (callback: (text: string, type: string) => void) => void;
  getPathForFile: (file: File) => string;
  exportDiagnostics: () => Promise<{
    ok: boolean;
    filePath?: string;
    canceled?: boolean;
    error?: string;
  }>;
  updaterCheck: () => Promise<unknown>;
  updaterDownload: () => Promise<unknown>;
  updaterInstall: () => Promise<UpdaterInstallResult>;
  onUpdaterEvent: (callback: (type: UpdaterEventType, data?: UpdaterEventData) => void) => void;
  onMcpOpenDiff: (callback: EventCallback) => void;
  onMcpOpenFile: (callback: EventCallback) => void;
  onMcpCloseAllDiffs: (callback: EventCallback) => void;
  onMcpCloseTab: (callback: EventCallback) => void;
  mcpDiffResponse: (
    sessionId: string,
    diffId: string,
    action: string,
    editedContent?: string,
  ) => void;
  readFileForPanel: (
    filePath: string,
  ) => Promise<{ ok: boolean; content?: string; error?: string }>;
  saveFileForPanel: (filePath: string, content: string) => Promise<ApiResult>;
  watchFile: (filePath: string) => Promise<ApiResult>;
  unwatchFile: (filePath: string) => Promise<ApiResult>;
  onFileChanged: (callback: (filePath: string) => void) => () => void;
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
    'switchboard:react-command': CustomEvent<{ action: LegacyShellAction }>;
    'switchboard:save-update-restart-state': CustomEvent<void>;
  }
}

export function getApi(): SwitchboardApi {
  if (!window.api) {
    throw new Error('window.api is not available — preload may not have loaded');
  }
  return window.api;
}
