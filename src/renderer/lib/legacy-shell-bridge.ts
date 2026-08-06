export const SWITCHBOARD_REACT_COMMAND_EVENT = 'switchboard:react-command';

export type LegacyShellAction =
  | 'add-project'
  | 'assign-group'
  | 'create-group'
  | 'focus-next-attention'
  | 'focus-search'
  | 'delete-group'
  | 'edit-group'
  | 'new-session'
  | 'open-command-palette'
  | 'open-session'
  | 'open-settings'
  | 'open-view'
  | 'quick-action'
  | 'rename-session'
  | 'refresh-surface'
  | 'launch-group'
  | 'session-action'
  | 'show-dashboard'
  | 'toggle-grid'
  | 'toggle-sidebar';

export interface LegacySurfaceSnapshot {
  activePanel: string;
  mainAvailable: boolean;
  placeholderVisible: boolean;
  searchAvailable: boolean;
  sidebarAvailable: boolean;
  sidebarCollapsed: boolean;
}

function byId<T extends HTMLElement>(id: string, doc: Document): T | null {
  return doc.getElementById(id) as T | null;
}

function isVisible(element: HTMLElement | null, doc: Document): boolean {
  if (!element || element.hidden) return false;
  const style = doc.defaultView?.getComputedStyle(element);
  if (!style) return true;
  return style.display !== 'none' && style.visibility !== 'hidden';
}

export function getLegacySurfaceSnapshot(doc: Document = document): LegacySurfaceSnapshot {
  const sidebar = byId('sidebar', doc);
  const panels = [
    'grid-viewer',
    'jsonl-viewer',
    'timeline-viewer',
    'terminal-area',
    'plan-viewer',
    'memory-viewer',
    'settings-viewer',
    'stats-viewer',
  ];
  const activePanel =
    panels.find((id) => isVisible(byId(id, doc), doc)) ??
    (isVisible(byId('placeholder', doc), doc) ? 'placeholder' : 'unknown');

  return {
    activePanel,
    mainAvailable: !!byId('main', doc),
    placeholderVisible: isVisible(byId('placeholder', doc), doc),
    searchAvailable: !!byId<HTMLInputElement>('search-input', doc),
    sidebarAvailable: !!sidebar,
    sidebarCollapsed: sidebar?.classList.contains('collapsed') ?? false,
  };
}

export function dispatchLegacyShellCommand(
  action: LegacyShellAction,
  payload: Record<string, unknown> = {},
  doc: Document = document,
): boolean {
  const view = doc.defaultView ?? window;
  view.dispatchEvent(
    new CustomEvent(SWITCHBOARD_REACT_COMMAND_EVENT, { detail: { action, ...payload } }),
  );

  if (action === 'focus-search') {
    const searchInput = byId<HTMLInputElement>('search-input', doc);
    searchInput?.focus();
    searchInput?.select();
    return !!searchInput;
  }

  if (action === 'toggle-sidebar') {
    const sidebar = byId('sidebar', doc);
    const button = byId<HTMLButtonElement>(
      sidebar?.classList.contains('collapsed') ? 'sidebar-expand-btn' : 'sidebar-collapse-btn',
      doc,
    );
    button?.click();
    return !!button;
  }

  return true;
}
