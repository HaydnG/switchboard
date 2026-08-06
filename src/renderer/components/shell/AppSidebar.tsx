import { useMemo, useState, type CSSProperties, type DragEvent } from 'react';
import { Button, Chip, Icon } from '@renderer/components/design-system';
import { dispatchLegacyShellCommand } from '@renderer/lib/legacy-shell-bridge';
import type {
  SessionOverviewItem,
  SessionOverviewSnapshot,
} from '@renderer/store/session-overview-store';
import {
  compactDuration,
  groupSessionsByFolder,
  groupSessionsByProject,
  relativeTime,
  statusTone,
} from '@renderer/components/shell/shell-utils';

type SessionFilter = 'all' | 'archived' | 'attention' | 'running' | 'starred' | 'today';
type SidebarMode = 'groups' | 'projects';

interface AppSidebarProps {
  collapsed: boolean;
  overview: SessionOverviewSnapshot;
  onToggleCollapsed: () => void;
}

const navigation = [
  { id: 'dashboard', label: 'Command center', icon: 'spark' as const, action: 'show-dashboard' },
  { id: 'plans', label: 'Plans', icon: 'panel' as const, action: 'open-view', view: 'plans' },
  {
    id: 'memory',
    label: 'Agent files',
    icon: 'sidebar' as const,
    action: 'open-view',
    view: 'memory',
  },
  { id: 'stats', label: 'Activity', icon: 'grid' as const, action: 'open-view', view: 'stats' },
];

const filters: Array<{ id: SessionFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'attention', label: 'Needs me' },
  { id: 'running', label: 'Running' },
  { id: 'starred', label: 'Pinned' },
  { id: 'today', label: 'Today' },
  { id: 'archived', label: 'Archived' },
];

function readString(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function readCollapsedGroups(): Set<string> {
  try {
    const parsed = JSON.parse(localStorage.getItem('reactCollapsedGroups') || '[]');
    return new Set(
      Array.isArray(parsed) ? parsed.filter((value) => typeof value === 'string') : [],
    );
  } catch {
    return new Set();
  }
}

function persistCollapsedGroups(groups: Set<string>) {
  try {
    localStorage.setItem('reactCollapsedGroups', JSON.stringify([...groups]));
  } catch {
    // Collapse remains usable when persistence is unavailable.
  }
}

function isToday(value: string): boolean {
  const date = new Date(value);
  const now = new Date();
  return (
    Number.isFinite(date.getTime()) &&
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

function sessionMatchesFilter(session: SessionOverviewItem, filter: SessionFilter): boolean {
  if (filter !== 'archived' && session.archived) return false;
  if (filter === 'archived') return session.archived;
  if (filter === 'attention') {
    return ['needs-attention', 'response-ready'].includes(session.status);
  }
  if (filter === 'running') return session.running;
  if (filter === 'starred') return session.starred;
  if (filter === 'today') return isToday(session.modified);
  return true;
}

function launchRuntime(projectPath: string, runtime: string) {
  dispatchLegacyShellCommand('new-session', { projectPath, runtime });
}

function ProjectLauncher({
  label,
  path,
  onClose,
}: {
  label: string;
  path: string;
  onClose: () => void;
}) {
  return (
    <div className="sb-project-launcher" aria-label={`Launch in ${label}`}>
      {[
        ['claude', 'Claude'],
        ['pi', 'Pi'],
        ['omp', 'omp'],
        ['terminal', 'Terminal'],
      ].map(([runtime, runtimeLabel]) => (
        <button
          key={runtime}
          type="button"
          onClick={() => {
            launchRuntime(path, runtime);
            onClose();
          }}
        >
          <span>{runtime === 'pi' ? 'π' : runtime.slice(0, 1).toUpperCase()}</span>
          {runtimeLabel}
        </button>
      ))}
    </div>
  );
}

function SessionRow({
  active,
  compact = false,
  onDragEnd,
  onDragStart,
  session,
}: {
  active: boolean;
  compact?: boolean;
  onDragEnd?: () => void;
  onDragStart?: (sessionId: string) => void;
  session: SessionOverviewItem;
}) {
  const details = [
    relativeTime(session.modified),
    session.messageCount > 0 ? `${session.messageCount} msgs` : '',
    session.turnCount > 0 ? `${session.turnCount} turns` : '',
    compactDuration(session.activeMinutes),
    session.worktreeLabel,
  ].filter(Boolean);
  const runAction = (command: string) =>
    dispatchLegacyShellCommand('session-action', {
      command,
      sessionId: session.id,
    });
  const actions = [
    { command: 'pin', label: session.starred ? 'Unpin' : 'Pin' },
    ...(session.running ? [{ command: 'stop', label: 'Stop' }] : []),
    ...(session.running ? [{ command: 'queue', label: 'Queue prompt' }] : []),
    { command: 'timeline', label: 'Timeline' },
    { command: 'messages', label: 'Messages' },
    ...(session.type !== 'terminal'
      ? [
          { command: 'fork', label: 'Fork' },
          { command: 'resume-config', label: 'Resume with options' },
          { command: 'handoff', label: 'Hand off' },
        ]
      : []),
    { command: 'copy-id', label: 'Copy session ID' },
    { command: 'archive', label: session.archived ? 'Unarchive' : 'Archive' },
  ];
  return (
    <div
      draggable
      className={`sb-session-row-wrap${active ? ' is-active' : ''}${compact ? ' is-compact' : ''}`}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/switchboard-session', session.id);
        onDragStart?.(session.id);
      }}
      onDragEnd={onDragEnd}
    >
      <button
        type="button"
        className="sb-session-row"
        title={compact ? session.name : undefined}
        onClick={() => dispatchLegacyShellCommand('open-session', { sessionId: session.id })}
      >
        <span
          className={`sb-session-row__status tone-${statusTone(session.status)}`}
          aria-label={session.statusLabel}
        />
        {!compact && (
          <>
            <span className="sb-session-row__copy">
              <span className="sb-session-row__title">
                {session.runtime !== 'claude' && <b>{session.runtime}</b>}
                <strong>{session.name}</strong>
              </span>
              <span className="sb-session-row__task">
                {session.task || session.attentionReason || session.statusLabel}
              </span>
              <span className="sb-session-row__chips">
                <span className={`tone-${statusTone(session.status)}`}>{session.statusLabel}</span>
                {session.health !== 'healthy' && (
                  <span className={`health-${session.health}`}>{session.healthLabel}</span>
                )}
                {session.gitLabel && (
                  <span className={`git-${session.gitLevel}`} title={session.gitDetail}>
                    {session.gitLabel}
                  </span>
                )}
                {session.fileSummary && (
                  <span title={session.fileSummary}>
                    {session.fileSummaryType === 'diff' ? 'Diff' : 'File'} {session.fileSummary}
                  </span>
                )}
                {session.queuedCount > 0 && <span>{session.queuedCount} queued</span>}
              </span>
              <small>{details.join(' · ')}</small>
            </span>
            {session.starred && <span className="sb-session-row__pin">◆</span>}
          </>
        )}
      </button>
      {!compact && (
        <details className="sb-session-action-menu">
          <summary aria-label={`More actions for ${session.name}`}>•••</summary>
          <div>
            {actions.map((action) => (
              <button
                key={action.command}
                type="button"
                className={action.command === 'archive' ? 'is-warning' : ''}
                onClick={(event) => {
                  runAction(action.command);
                  const detailsElement = event.currentTarget.closest('details');
                  if (detailsElement) detailsElement.open = false;
                }}
              >
                {action.label}
              </button>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function AttentionInbox({
  activeSessionId,
  onDragEnd,
  onDragStart,
  sessions,
}: {
  activeSessionId: string | null;
  onDragEnd: () => void;
  onDragStart: (sessionId: string) => void;
  sessions: SessionOverviewItem[];
}) {
  if (sessions.length === 0) return null;
  return (
    <section className="sb-attention-inbox">
      <header>
        <div>
          <span className="sb-attention-pulse" />
          <strong>Attention</strong>
          <span>{sessions.length}</span>
        </div>
        <button type="button" onClick={() => dispatchLegacyShellCommand('focus-next-attention')}>
          Focus next
        </button>
      </header>
      <div>
        {sessions.slice(0, 4).map((session) => (
          <div className="sb-attention-entry" key={session.id}>
            <SessionRow
              active={activeSessionId === session.id}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              session={session}
            />
            {session.running && (
              <div className="sb-attention-entry__actions">
                {session.status === 'needs-attention' && (
                  <>
                    <button
                      type="button"
                      className="is-approve"
                      onClick={(event) =>
                        dispatchLegacyShellCommand('quick-action', {
                          actionId: 'approve',
                          anchor: event.currentTarget,
                          sessionId: session.id,
                        })
                      }
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      className="is-deny"
                      onClick={(event) =>
                        dispatchLegacyShellCommand('quick-action', {
                          actionId: 'deny',
                          anchor: event.currentTarget,
                          sessionId: session.id,
                        })
                      }
                    >
                      Deny
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={(event) =>
                    dispatchLegacyShellCommand('quick-action', {
                      actionId: 'reply',
                      anchor: event.currentTarget,
                      sessionId: session.id,
                    })
                  }
                >
                  Reply…
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

export function AppSidebar({ collapsed, overview, onToggleCollapsed }: AppSidebarProps) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<SessionFilter>('all');
  const [mode, setMode] = useState<SidebarMode>(() =>
    readString('reactSidebarMode', 'groups') === 'projects' ? 'projects' : 'groups',
  );
  const [launchProjectPath, setLaunchProjectPath] = useState<string | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState(readCollapsedGroups);
  const [draggedSessionId, setDraggedSessionId] = useState<string | null>(null);
  const [dragOverGroupId, setDragOverGroupId] = useState<string | null>(null);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredSessions = useMemo(
    () =>
      overview.sessions.filter((session) => {
        if (!sessionMatchesFilter(session, filter)) return false;
        if (
          normalizedQuery &&
          !`${session.name} ${session.projectPath} ${session.task} ${session.groupName}`
            .toLocaleLowerCase()
            .includes(normalizedQuery)
        ) {
          return false;
        }
        return true;
      }),
    [filter, normalizedQuery, overview.sessions],
  );
  const attentionSessions = useMemo(
    () =>
      overview.sessions.filter(
        (session) =>
          !session.archived && ['needs-attention', 'response-ready'].includes(session.status),
      ),
    [overview.sessions],
  );
  const projectGroups = useMemo(() => groupSessionsByProject(filteredSessions), [filteredSessions]);
  const folderGroups = useMemo(
    () => groupSessionsByFolder(filteredSessions, overview.groups),
    [filteredSessions, overview.groups],
  );

  const changeMode = (next: SidebarMode) => {
    setMode(next);
    try {
      localStorage.setItem('reactSidebarMode', next);
    } catch {
      // The selected view still works when storage is unavailable.
    }
  };
  const toggleGroup = (groupId: string) => {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      persistCollapsedGroups(next);
      return next;
    });
  };
  const finishDrag = () => {
    setDraggedSessionId(null);
    setDragOverGroupId(null);
  };
  const dropIntoGroup = (event: DragEvent<HTMLElement>, groupId: string | null) => {
    event.preventDefault();
    const sessionId = draggedSessionId || event.dataTransfer.getData('text/switchboard-session');
    if (sessionId) {
      dispatchLegacyShellCommand('assign-group', { groupId, sessionId });
    }
    finishDrag();
  };
  const createGroupFromDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    const sessionId = draggedSessionId || event.dataTransfer.getData('text/switchboard-session');
    if (sessionId) dispatchLegacyShellCommand('create-group', { sessionId });
    finishDrag();
  };

  const projectSection = (
    project: ReturnType<typeof groupSessionsByProject>[number],
    nested = false,
  ) => (
    <section className={`sb-project-section${nested ? ' is-nested' : ''}`} key={project.path}>
      {!collapsed && (
        <header>
          <div>
            <strong>{project.label}</strong>
            <span>{project.sessions.length}</span>
          </div>
          <button
            type="button"
            aria-label={`New session in ${project.label}`}
            aria-expanded={launchProjectPath === project.path}
            onClick={() =>
              setLaunchProjectPath((current) => (current === project.path ? null : project.path))
            }
          >
            +
          </button>
        </header>
      )}
      {!collapsed && launchProjectPath === project.path && (
        <ProjectLauncher
          label={project.label}
          path={project.path}
          onClose={() => setLaunchProjectPath(null)}
        />
      )}
      <div>
        {project.sessions.slice(0, collapsed ? 8 : 16).map((session) => (
          <SessionRow
            key={session.id}
            active={overview.activeSessionId === session.id}
            compact={collapsed}
            onDragStart={setDraggedSessionId}
            onDragEnd={finishDrag}
            session={session}
          />
        ))}
      </div>
    </section>
  );

  return (
    <nav className={`sb-app-sidebar${collapsed ? ' is-collapsed' : ''}`} aria-label="Workspace">
      <div className="sb-app-sidebar__brand">
        <button
          className="sb-brand"
          type="button"
          onClick={() => dispatchLegacyShellCommand('show-dashboard')}
          aria-label="Open command center"
        >
          <span className="sb-brand__mark">S</span>
          {!collapsed && (
            <span className="sb-brand__copy">
              <strong>Switchboard</strong>
              <small>Agent command center</small>
            </span>
          )}
        </button>
        <button
          className="sb-sidebar-collapse"
          type="button"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
        >
          <Icon name="sidebar" size={15} />
        </button>
      </div>

      <div className="sb-sidebar-search">
        <Icon name="search" size={15} />
        {!collapsed && (
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter sessions"
            aria-label="Filter sessions"
          />
        )}
        {!collapsed && (
          <button
            type="button"
            onClick={() => dispatchLegacyShellCommand('open-command-palette')}
            title="Search everything"
          >
            ⌘K
          </button>
        )}
      </div>

      <div className="sb-sidebar-nav">
        {navigation.map((item) => (
          <button
            key={item.id}
            type="button"
            title={collapsed ? item.label : undefined}
            onClick={() =>
              dispatchLegacyShellCommand(
                item.action as 'show-dashboard' | 'open-view',
                item.view ? { view: item.view } : {},
              )
            }
          >
            <Icon name={item.icon} size={16} />
            {!collapsed && <span>{item.label}</span>}
          </button>
        ))}
      </div>

      {!collapsed && (
        <div className="sb-sidebar-controls">
          <div className="sb-sidebar-mode" role="group" aria-label="Sidebar organization">
            <button
              type="button"
              className={mode === 'groups' ? 'is-active' : ''}
              onClick={() => changeMode('groups')}
            >
              Folders
            </button>
            <button
              type="button"
              className={mode === 'projects' ? 'is-active' : ''}
              onClick={() => changeMode('projects')}
            >
              Projects
            </button>
          </div>
          <button
            type="button"
            className="sb-sidebar-new-folder"
            onClick={() => dispatchLegacyShellCommand('create-group', {})}
          >
            <span>+</span> New folder
          </button>
          <div className="sb-session-filter" role="group" aria-label="Session filter">
            {filters.map((value) => (
              <button
                key={value.id}
                type="button"
                className={filter === value.id ? 'is-active' : ''}
                onClick={() => setFilter(value.id)}
              >
                {value.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="sb-sidebar-sessions" aria-label="Sessions">
        {!collapsed && (
          <AttentionInbox
            activeSessionId={overview.activeSessionId}
            onDragStart={setDraggedSessionId}
            onDragEnd={finishDrag}
            sessions={attentionSessions}
          />
        )}

        {mode === 'groups' && !collapsed ? (
          <>
            {folderGroups.groups
              .filter((group) => group.sessions.length > 0 || draggedSessionId)
              .map((group) => {
                const isCollapsed = collapsedGroups.has(group.id);
                const style = { '--sb-folder-color': group.color } as CSSProperties;
                return (
                  <section
                    className={`sb-folder-group${
                      dragOverGroupId === group.id ? ' is-drop-target' : ''
                    }`}
                    key={group.id}
                    style={style}
                    onDragEnter={() => setDragOverGroupId(group.id)}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = 'move';
                      setDragOverGroupId(group.id);
                    }}
                    onDragLeave={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                        setDragOverGroupId(null);
                      }
                    }}
                    onDrop={(event) => dropIntoGroup(event, group.id)}
                  >
                    <div className="sb-folder-group__top">
                      <button
                        className="sb-folder-group__header"
                        type="button"
                        aria-expanded={!isCollapsed}
                        onClick={() => toggleGroup(group.id)}
                      >
                        <span className="sb-folder-group__chevron">{isCollapsed ? '›' : '⌄'}</span>
                        <span className="sb-folder-group__icon">▰</span>
                        <span>
                          <strong>{group.name}</strong>
                          <small>
                            <i /> {group.sessions.length}{' '}
                            {group.sessions.length === 1 ? 'session' : 'sessions'}
                          </small>
                        </span>
                        {group.attention > 0 && (
                          <Chip tone="warning">{group.attention} need you</Chip>
                        )}
                      </button>
                      <div className="sb-folder-group__actions">
                        <button
                          type="button"
                          title="Launch all sessions"
                          aria-label={`Launch all sessions in ${group.name}`}
                          onClick={() =>
                            dispatchLegacyShellCommand('launch-group', {
                              groupId: group.id,
                            })
                          }
                        >
                          ▶
                        </button>
                        <details>
                          <summary aria-label={`Folder actions for ${group.name}`}>•••</summary>
                          <div>
                            <button
                              type="button"
                              onClick={() =>
                                dispatchLegacyShellCommand('edit-group', {
                                  groupId: group.id,
                                })
                              }
                            >
                              Rename / recolor
                            </button>
                            <button
                              type="button"
                              className="is-warning"
                              onClick={() =>
                                dispatchLegacyShellCommand('delete-group', {
                                  groupId: group.id,
                                })
                              }
                            >
                              Delete folder
                            </button>
                          </div>
                        </details>
                      </div>
                    </div>
                    {!isCollapsed && (
                      <div className="sb-folder-group__body">
                        {group.projects.map((project) => projectSection(project, true))}
                        {group.projects.length === 0 && (
                          <div className="sb-empty-folder">Drop sessions here</div>
                        )}
                      </div>
                    )}
                  </section>
                );
              })}
            {folderGroups.ungrouped.length > 0 && (
              <section
                className={`sb-ungrouped-section${
                  dragOverGroupId === '__ungrouped__' ? ' is-drop-target' : ''
                }`}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                  setDragOverGroupId('__ungrouped__');
                }}
                onDrop={(event) => dropIntoGroup(event, null)}
              >
                <header>Ungrouped</header>
                {groupSessionsByProject(folderGroups.ungrouped).map((project) =>
                  projectSection(project, true),
                )}
              </section>
            )}
          </>
        ) : (
          projectGroups.map((project) => projectSection(project))
        )}

        {draggedSessionId && !collapsed && (
          <section
            className={`sb-new-folder-drop${
              dragOverGroupId === '__new__' ? ' is-drop-target' : ''
            }`}
            onDragEnter={() => setDragOverGroupId('__new__')}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              setDragOverGroupId('__new__');
            }}
            onDragLeave={() => setDragOverGroupId(null)}
            onDrop={createGroupFromDrop}
          >
            <span>{dragOverGroupId === '__new__' ? '✓' : '+'}</span>
            <strong>Drop to create a new folder</strong>
          </section>
        )}

        {filteredSessions.length === 0 && !collapsed && (
          <div className="sb-sidebar-empty">
            <span>No matching sessions</span>
            <button type="button" onClick={() => setQuery('')}>
              Clear filter
            </button>
          </div>
        )}
      </div>

      <footer className="sb-app-sidebar__footer">
        {collapsed ? (
          <span className="sb-footer-pulse" title={`${overview.running} running`} />
        ) : (
          <>
            <div>
              <span className="sb-footer-pulse" />
              <span>{overview.running} running</span>
              <span>{overview.attention} need you</span>
            </div>
            <Button
              aria-label="Add project"
              icon={<span>+</span>}
              onClick={() => dispatchLegacyShellCommand('add-project')}
              size="sm"
              variant="ghost"
            />
          </>
        )}
      </footer>
    </nav>
  );
}
