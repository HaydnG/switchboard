// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '@renderer/App';
import { Button, Chip, EmptyState, Icon, PanelHeader } from '@renderer/components/design-system';
import { SwitchboardShell } from '@renderer/components/SwitchboardShell';
import {
  dispatchLegacyShellCommand,
  SWITCHBOARD_REACT_COMMAND_EVENT,
} from '@renderer/lib/legacy-shell-bridge';
import { SESSION_OVERVIEW_EVENT } from '@renderer/store/session-overview-store';
import type { SwitchboardApi } from '@renderer/types/api';

function installApiStub() {
  window.api = {
    getSchedules: vi.fn().mockResolvedValue([]),
    listScheduleRuns: vi.fn().mockResolvedValue([]),
    getSessionAnnotations: vi.fn().mockResolvedValue({ note: '', tags: [] }),
    setSessionAnnotations: vi.fn().mockResolvedValue({ ok: true, note: '', tags: [] }),
    updaterCheck: vi.fn(),
    updaterDownload: vi.fn(),
    updaterInstall: vi.fn().mockResolvedValue({ ok: true }),
    onUpdaterEvent: vi.fn(),
    platform: 'test',
    isPackaged: false,
    getAppVersion: vi.fn().mockResolvedValue('0.0.0'),
  } as unknown as SwitchboardApi;
}

function installLegacyDom() {
  document.body.innerHTML = `
    <div id="app-container">
      <div id="react-shell-sidebar"></div>
      <div id="sidebar">
        <button id="sidebar-collapse-btn" type="button">Collapse</button>
        <button id="sidebar-expand-btn" type="button">Expand</button>
        <input id="search-input" type="text" />
      </div>
      <div id="main">
        <div id="react-shell-topbar"></div>
        <div id="placeholder"><p>Select a session.</p></div>
        <div id="terminal-area" style="display:none"></div>
      </div>
      <div id="react-shell-inspector"></div>
    </div>
    <div id="react-root"></div>
  `;
}

function publishOverview(overrides: Record<string, unknown> = {}) {
  fireEvent(
    window,
    new CustomEvent(SESSION_OVERVIEW_EVENT, {
      detail: {
        total: 0,
        running: 0,
        attention: 0,
        ready: 0,
        activeSessionId: null,
        gridViewActive: false,
        workspaceView: 'dashboard',
        groups: [],
        sessions: [],
        updatedAt: 1,
        ...overrides,
      },
    }),
  );
}

const session = {
  id: 'session-1',
  name: 'Checkout migration',
  projectPath: '/work/consumer/checkout',
  runtime: 'claude',
  status: 'needs-attention',
  statusLabel: 'Needs You',
  health: 'growing',
  healthLabel: 'Growing',
  running: true,
  starred: false,
  archived: false,
  modified: '2026-07-28T08:30:00.000Z',
  messageCount: 180,
  turnCount: 24,
  activeMinutes: 90,
  cacheReadTokens: 1200,
  groupId: 'launch',
  groupName: 'Launch',
  groupColor: '#e0b45a',
  groupOrder: 1,
  task: 'Update checkout tests',
};

describe('renderer application shell', () => {
  beforeEach(() => {
    installLegacyDom();
    installApiStub();
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    document.body.className = '';
    vi.restoreAllMocks();
  });

  it('renders primitives with stable semantic classes and accessible icon labels', () => {
    render(
      <>
        <Button variant="primary" size="sm" icon={<Icon name="search" label="Search" />}>
          Focus search
        </Button>
        <Chip tone="success">Renderer ready</Chip>
        <PanelHeader eyebrow="React shell" title="Command center" />
        <EmptyState
          icon={<Icon name="spark" label="Idle state" />}
          title="No session selected"
          action={<Button variant="secondary">Find session</Button>}
        >
          Select a session or focus search to locate one.
        </EmptyState>
      </>,
    );

    expect(screen.getByRole('button', { name: /focus search/i }).className).toContain(
      'sb-button--primary',
    );
    expect(screen.getByRole('img', { name: 'Search' })).toBeTruthy();
  });

  it('renders the integrated navigation, top bar, and productivity dashboard', () => {
    render(<SwitchboardShell />);

    expect(screen.getByRole('navigation', { name: 'Workspace' })).toBeTruthy();
    expect(screen.getByRole('main', { name: 'Productivity dashboard' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Search everything' })).toBeTruthy();
    expect(document.querySelector('#react-shell-topbar .sb-workspace-topbar')).toBeTruthy();
    const controls = document.querySelector('.sb-app-sidebar > .sb-sidebar-controls');
    expect(controls?.nextElementSibling?.classList.contains('sb-sidebar-sessions')).toBe(true);
  });

  it('reflects event-driven session state and opens a selected session', () => {
    const events: Array<Record<string, unknown>> = [];
    window.addEventListener(SWITCHBOARD_REACT_COMMAND_EVENT, (event) => {
      events.push((event as CustomEvent<Record<string, unknown>>).detail);
    });
    render(<SwitchboardShell />);
    publishOverview({
      total: 18,
      running: 4,
      attention: 2,
      ready: 3,
      sessions: [session],
    });

    expect(screen.getByText('2')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: /Checkout migration/i })[0]);
    expect(events).toContainEqual({ action: 'open-session', sessionId: 'session-1' });
  });

  it('keeps folder groups, attention inbox, and session filters visible', () => {
    render(<SwitchboardShell />);
    publishOverview({
      total: 1,
      running: 1,
      attention: 1,
      groups: [
        {
          id: 'launch',
          name: 'Launch',
          color: '#e0b45a',
          order: 1,
          sessionCount: 1,
        },
      ],
      sessions: [session],
    });

    expect(screen.getByText('Attention')).toBeTruthy();
    expect(screen.getByText('Launch')).toBeTruthy();
    expect(screen.getAllByText('Update checkout tests').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Needs You').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reply…' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pinned' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Today' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Archived' })).toBeTruthy();
  });

  it('exposes session and folder action menus', () => {
    const events: Array<Record<string, unknown>> = [];
    window.addEventListener(SWITCHBOARD_REACT_COMMAND_EVENT, (event) => {
      events.push((event as CustomEvent<Record<string, unknown>>).detail);
    });
    render(<SwitchboardShell />);
    publishOverview({
      total: 1,
      groups: [
        {
          id: 'launch',
          name: 'Launch',
          color: '#e0b45a',
          order: 1,
          sessionCount: 1,
        },
      ],
      sessions: [session],
    });

    fireEvent.click(screen.getAllByLabelText('More actions for Checkout migration')[0]);
    fireEvent.click(screen.getAllByRole('button', { name: 'Pin' })[0]);
    expect(events).toContainEqual({
      action: 'session-action',
      command: 'pin',
      sessionId: 'session-1',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Launch all sessions in Launch' }));
    expect(events).toContainEqual({ action: 'launch-group', groupId: 'launch' });
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(events).toContainEqual({
      action: 'quick-action',
      actionId: 'approve',
      anchor: expect.any(HTMLElement),
      sessionId: 'session-1',
    });
    fireEvent.click(screen.getByLabelText('Folder actions for Launch'));
    fireEvent.click(screen.getByRole('button', { name: 'Rename / recolor' }));
    expect(events).toContainEqual({ action: 'edit-group', groupId: 'launch' });
  });

  it('shows the session inspector for the active session and saves notes', async () => {
    render(<SwitchboardShell />);
    publishOverview({
      total: 1,
      running: 1,
      activeSessionId: 'session-1',
      groups: [
        {
          id: 'launch',
          name: 'Launch',
          color: '#e0b45a',
          order: 1,
          sessionCount: 1,
        },
      ],
      sessions: [session],
    });

    expect(await screen.findByRole('complementary', { name: 'Session details' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Private notes'), {
      target: { value: 'Review before merge' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save notes' }));

    await waitFor(() =>
      expect(window.api.setSessionAnnotations).toHaveBeenCalledWith('session-1', {
        note: 'Review before merge',
        tags: [],
      }),
    );
  });

  it('supports group assignment and returning from a secondary session view', async () => {
    const events: Array<Record<string, unknown>> = [];
    window.addEventListener(SWITCHBOARD_REACT_COMMAND_EVENT, (event) => {
      events.push((event as CustomEvent<Record<string, unknown>>).detail);
    });
    render(<SwitchboardShell />);
    publishOverview({
      total: 1,
      activeSessionId: 'session-1',
      workspaceView: 'timeline',
      groups: [
        {
          id: 'launch',
          name: 'Launch',
          color: '#e0b45a',
          order: 1,
          sessionCount: 1,
        },
      ],
      sessions: [session],
    });

    const folderSelect = await screen.findByLabelText('Session folder');
    expect((folderSelect as HTMLSelectElement).value).toBe('launch');
    fireEvent.change(folderSelect, { target: { value: '' } });
    expect(events).toContainEqual({
      action: 'assign-group',
      groupId: null,
      sessionId: 'session-1',
    });

    fireEvent.change(screen.getByLabelText('Session name'), {
      target: { value: 'Checkout final pass' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    expect(events).toContainEqual({
      action: 'rename-session',
      name: 'Checkout final pass',
      sessionId: 'session-1',
    });

    fireEvent.click(screen.getAllByRole('button', { name: 'Back to session' })[0]);
    expect(events).toContainEqual({ action: 'open-session', sessionId: 'session-1' });
  });

  it('drags sessions into folders and exposes the new-folder drop target', () => {
    const events: Array<Record<string, unknown>> = [];
    window.addEventListener(SWITCHBOARD_REACT_COMMAND_EVENT, (event) => {
      events.push((event as CustomEvent<Record<string, unknown>>).detail);
    });
    render(<SwitchboardShell />);
    publishOverview({
      total: 1,
      groups: [
        {
          id: 'launch',
          name: 'Launch',
          color: '#e0b45a',
          order: 1,
          sessionCount: 1,
        },
      ],
      sessions: [session],
    });

    const dataTransfer = {
      effectAllowed: '',
      dropEffect: '',
      getData: () => 'session-1',
      setData: vi.fn(),
    };
    const sessionRow = document.querySelector('.sb-folder-group .sb-session-row');
    if (!sessionRow) throw new Error('Draggable session row missing');
    fireEvent.dragStart(sessionRow, { dataTransfer });
    expect(screen.getByText('Drop to create a new folder')).toBeTruthy();

    const folder = screen.getByText('Launch').closest('.sb-folder-group');
    if (!folder) throw new Error('Folder drop target missing');
    fireEvent.dragOver(folder, { dataTransfer });
    fireEvent.drop(folder, { dataTransfer });
    expect(events).toContainEqual({
      action: 'assign-group',
      groupId: 'launch',
      sessionId: 'session-1',
    });

    fireEvent.dragStart(sessionRow, { dataTransfer });
    const newFolder = screen.getByText('Drop to create a new folder').closest('section');
    if (!newFolder) throw new Error('New-folder drop target missing');
    fireEvent.dragOver(newFolder, { dataTransfer });
    fireEvent.drop(newFolder, { dataTransfer });
    expect(events).toContainEqual({ action: 'create-group', sessionId: 'session-1' });
  });

  it('dispatches typed shell commands', () => {
    const events: Array<Record<string, unknown>> = [];
    window.addEventListener(SWITCHBOARD_REACT_COMMAND_EVENT, (event) => {
      events.push((event as CustomEvent<Record<string, unknown>>).detail);
    });

    dispatchLegacyShellCommand('open-view', { view: 'plans' });
    expect(events).toEqual([{ action: 'open-view', view: 'plans' }]);
  });

  it('mounts the shell while preserving legacy status bar ids', () => {
    render(<App />);

    expect(document.getElementById('status-bar')).toBeTruthy();
    expect(document.getElementById('status-bar-info')).toBeTruthy();
    expect(document.getElementById('status-bar-usage')).toBeTruthy();
    expect(document.getElementById('status-bar-activity')).toBeTruthy();
    expect(document.getElementById('status-bar-updater')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Workspace' })).toBeTruthy();
  });
});
