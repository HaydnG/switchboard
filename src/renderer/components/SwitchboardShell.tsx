import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AppSidebar } from '@renderer/components/shell/AppSidebar';
import { ProductivityDashboard } from '@renderer/components/shell/ProductivityDashboard';
import { SessionInspector } from '@renderer/components/shell/SessionInspector';
import { WorkspaceTopbar } from '@renderer/components/shell/WorkspaceTopbar';
import { useSessionOverview } from '@renderer/store/session-overview-store';

function storedBoolean(key: string, fallback: boolean): boolean {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value === '1';
  } catch {
    return fallback;
  }
}

function persistBoolean(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch {
    // The layout remains usable when persistence is unavailable.
  }
}

export function SwitchboardShell() {
  const overview = useSessionOverview();
  const [navigationCollapsed, setNavigationCollapsed] = useState(() =>
    storedBoolean('reactNavigationCollapsed', false),
  );
  const [inspectorOpen, setInspectorOpen] = useState(() =>
    storedBoolean('reactInspectorOpen', true),
  );
  const activeSession = useMemo(
    () => overview.sessions.find((session) => session.id === overview.activeSessionId) || null,
    [overview.activeSessionId, overview.sessions],
  );

  useEffect(() => {
    document.body.classList.add('sb-shell-active');
    return () => document.body.classList.remove('sb-shell-active');
  }, []);

  const sidebarSlot = document.getElementById('react-shell-sidebar');
  const topbarSlot = document.getElementById('react-shell-topbar');
  const inspectorSlot = document.getElementById('react-shell-inspector');
  const dashboardSlot = document.getElementById('placeholder');
  if (!sidebarSlot || !topbarSlot || !inspectorSlot || !dashboardSlot) return null;

  const toggleNavigation = () => {
    const next = !navigationCollapsed;
    setNavigationCollapsed(next);
    persistBoolean('reactNavigationCollapsed', next);
  };
  const toggleInspector = () => {
    const next = !inspectorOpen;
    setInspectorOpen(next);
    persistBoolean('reactInspectorOpen', next);
  };

  return (
    <>
      {createPortal(
        <AppSidebar
          collapsed={navigationCollapsed}
          overview={overview}
          onToggleCollapsed={toggleNavigation}
        />,
        sidebarSlot,
      )}
      {createPortal(
        <WorkspaceTopbar
          activeSession={activeSession}
          inspectorOpen={inspectorOpen}
          overview={overview}
          onToggleInspector={toggleInspector}
        />,
        topbarSlot,
      )}
      {createPortal(<ProductivityDashboard overview={overview} />, dashboardSlot)}
      {activeSession &&
        inspectorOpen &&
        createPortal(
          <SessionInspector
            key={activeSession.id}
            groups={overview.groups}
            session={activeSession}
            onClose={toggleInspector}
          />,
          inspectorSlot,
        )}
    </>
  );
}
