import type {
  SessionGroupOverview,
  SessionOverviewItem,
} from '@renderer/store/session-overview-store';

export interface SessionProjectGroup {
  path: string;
  label: string;
  sessions: SessionOverviewItem[];
  running: number;
  attention: number;
}

export interface SessionFolderGroup {
  id: string;
  name: string;
  color: string;
  order: number;
  sessions: SessionOverviewItem[];
  projects: SessionProjectGroup[];
  running: number;
  attention: number;
}

export function shortProjectName(projectPath: string): string {
  const parts = projectPath.split(/[\\/]/).filter(Boolean);
  return parts.slice(-2).join('/') || 'Other';
}

export function groupSessionsByProject(sessions: SessionOverviewItem[]): SessionProjectGroup[] {
  const groups = new Map<string, SessionOverviewItem[]>();
  for (const session of sessions) {
    const key = session.projectPath || 'Other';
    const members = groups.get(key) || [];
    members.push(session);
    groups.set(key, members);
  }
  return [...groups.entries()]
    .map(([path, members]) => ({
      path,
      label: shortProjectName(path),
      sessions: [...members].sort(
        (left, right) =>
          Number(right.running) - Number(left.running) ||
          new Date(right.modified).getTime() - new Date(left.modified).getTime(),
      ),
      running: members.filter((session) => session.running).length,
      attention: members.filter((session) =>
        ['needs-attention', 'response-ready'].includes(session.status),
      ).length,
    }))
    .sort(
      (left, right) =>
        right.attention - left.attention ||
        right.running - left.running ||
        left.label.localeCompare(right.label),
    );
}

export function groupSessionsByFolder(
  sessions: SessionOverviewItem[],
  definitions: SessionGroupOverview[] = [],
): {
  groups: SessionFolderGroup[];
  ungrouped: SessionOverviewItem[];
} {
  const grouped = new Map<string, SessionOverviewItem[]>();
  const ungrouped: SessionOverviewItem[] = [];
  for (const session of sessions) {
    if (!session.groupId) {
      ungrouped.push(session);
      continue;
    }
    const members = grouped.get(session.groupId) || [];
    members.push(session);
    grouped.set(session.groupId, members);
  }
  const knownIds = new Set(definitions.map((group) => group.id));
  const allDefinitions = [
    ...definitions,
    ...[...grouped.entries()]
      .filter(([id]) => !knownIds.has(id))
      .map(([id, members]) => ({
        id,
        name: members[0]?.groupName || 'Folder',
        color: members[0]?.groupColor || '#8088ff',
        order: members[0]?.groupOrder ?? Number.MAX_SAFE_INTEGER,
        sessionCount: members.length,
      })),
  ];
  const groups = allDefinitions
    .map((definition) => {
      const members = grouped.get(definition.id) || [];
      return {
        id: definition.id,
        name: definition.name,
        color: definition.color || '#8088ff',
        order: definition.order ?? Number.MAX_SAFE_INTEGER,
        sessions: members,
        projects: groupSessionsByProject(members),
        running: members.filter((session) => session.running).length,
        attention: members.filter((session) =>
          ['needs-attention', 'response-ready'].includes(session.status),
        ).length,
      };
    })
    .sort(
      (left, right) =>
        left.order - right.order ||
        right.attention - left.attention ||
        left.name.localeCompare(right.name),
    );
  return { groups, ungrouped };
}

export function relativeTime(value: string, now = Date.now()): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return '';
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 60) return 'now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

export function statusTone(status: string): string {
  if (status === 'needs-attention') return 'danger';
  if (status === 'response-ready') return 'info';
  if (status === 'busy' || status === 'running') return 'success';
  if (status === 'exited') return 'warning';
  return 'neutral';
}

export function compactDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '';
  if (minutes < 60) return `${Math.round(minutes)}m active`;
  const hours = minutes / 60;
  return `${hours < 10 ? hours.toFixed(1) : Math.round(hours)}h active`;
}
