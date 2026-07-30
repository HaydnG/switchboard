import { useSyncExternalStore } from 'react';

export const SESSION_OVERVIEW_EVENT = 'switchboard:session-overview';

export interface SessionOverviewItem {
  id: string;
  name: string;
  projectPath: string;
  runtime: string;
  type: string;
  status: string;
  statusLabel: string;
  health: string;
  healthLabel: string;
  running: boolean;
  starred: boolean;
  archived: boolean;
  modified: string;
  messageCount: number;
  turnCount: number;
  activeMinutes: number;
  cacheReadTokens: number;
  worktreeLabel: string;
  gitLabel: string;
  gitDetail: string;
  gitLevel: string;
  fileSummary: string;
  fileSummaryType: string;
  queuedCount: number;
  attentionReason: string;
  groupId: string;
  groupName: string;
  groupColor: string;
  groupOrder: number;
  task: string;
}

export interface SessionGroupOverview {
  id: string;
  name: string;
  color: string;
  order: number;
  sessionCount: number;
}

export interface SessionOverviewSnapshot {
  total: number;
  running: number;
  attention: number;
  ready: number;
  activeSessionId: string | null;
  gridViewActive: boolean;
  workspaceView: string;
  groups: SessionGroupOverview[];
  sessions: SessionOverviewItem[];
  updatedAt: number;
}

const EMPTY_SNAPSHOT: SessionOverviewSnapshot = Object.freeze({
  total: 0,
  running: 0,
  attention: 0,
  ready: 0,
  activeSessionId: null,
  gridViewActive: false,
  workspaceView: 'dashboard',
  groups: [],
  sessions: [],
  updatedAt: 0,
});

let snapshot = EMPTY_SNAPSHOT;
const listeners = new Set<() => void>();

function count(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
}

function onOverview(event: Event): void {
  const detail = (event as CustomEvent<Partial<SessionOverviewSnapshot>>).detail || {};
  const sessions = Array.isArray(detail.sessions)
    ? detail.sessions.filter((session): session is SessionOverviewItem =>
        Boolean(session && typeof session.id === 'string' && typeof session.name === 'string'),
      )
    : [];
  const groups = Array.isArray(detail.groups)
    ? detail.groups.filter((group): group is SessionGroupOverview =>
        Boolean(group && typeof group.id === 'string' && typeof group.name === 'string'),
      )
    : [];
  snapshot = Object.freeze({
    total: count(detail.total),
    running: count(detail.running),
    attention: count(detail.attention),
    ready: count(detail.ready),
    activeSessionId: typeof detail.activeSessionId === 'string' ? detail.activeSessionId : null,
    gridViewActive: detail.gridViewActive === true,
    workspaceView: typeof detail.workspaceView === 'string' ? detail.workspaceView : 'dashboard',
    groups,
    sessions,
    updatedAt: count(detail.updatedAt) || Date.now(),
  });
  for (const listener of listeners) listener();
}

window.addEventListener(SESSION_OVERVIEW_EVENT, onOverview);

export function getSessionOverviewSnapshot(): SessionOverviewSnapshot {
  return snapshot;
}

export function subscribeSessionOverview(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSessionOverview(): SessionOverviewSnapshot {
  return useSyncExternalStore(
    subscribeSessionOverview,
    getSessionOverviewSnapshot,
    () => EMPTY_SNAPSHOT,
  );
}

declare global {
  interface WindowEventMap {
    [SESSION_OVERVIEW_EVENT]: CustomEvent<SessionOverviewSnapshot>;
  }
}
