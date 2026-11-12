import { Button, Chip, Icon } from '@renderer/components/design-system';
import { dispatchLegacyShellCommand } from '@renderer/lib/legacy-shell-bridge';
import type {
  SessionOverviewItem,
  SessionOverviewSnapshot,
} from '@renderer/store/session-overview-store';
import { shortProjectName } from '@renderer/components/shell/shell-utils';

interface WorkspaceTopbarProps {
  activeSession: SessionOverviewItem | null;
  attentionPanelOpen: boolean;
  inspectorOpen: boolean;
  overview: SessionOverviewSnapshot;
  onToggleAttentionPanel: () => void;
  onToggleInspector: () => void;
}

export function WorkspaceTopbar({
  activeSession,
  attentionPanelOpen,
  inspectorOpen,
  overview,
  onToggleAttentionPanel,
  onToggleInspector,
}: WorkspaceTopbarProps) {
  return (
    <header className="sb-workspace-topbar">
      <div className="sb-workspace-topbar__context">
        <button
          type="button"
          onClick={() => dispatchLegacyShellCommand('show-dashboard')}
          aria-label="Open command center"
        >
          <Icon name="spark" size={15} />
        </button>
        <span className="sb-topbar-divider" />
        {activeSession ? (
          <div>
            <small>{shortProjectName(activeSession.projectPath)}</small>
            <strong>{activeSession.name}</strong>
          </div>
        ) : (
          <div>
            <small>Workspace</small>
            <strong>{overview.gridViewActive ? 'Session overview' : 'Command center'}</strong>
          </div>
        )}
      </div>

      <div className="sb-workspace-topbar__actions">
        {activeSession && !['terminal', 'grid'].includes(overview.workspaceView) && (
          <Button
            icon={<Icon name="chevronRight" />}
            onClick={() =>
              dispatchLegacyShellCommand('open-session', {
                sessionId: activeSession.id,
              })
            }
            size="sm"
            variant="primary"
          >
            Back to session
          </Button>
        )}
        <Button
          aria-label={attentionPanelOpen ? 'Hide attention panel' : 'Show attention panel'}
          aria-pressed={attentionPanelOpen}
          icon={<Icon name="attention" />}
          onClick={onToggleAttentionPanel}
          size="sm"
          variant={attentionPanelOpen ? 'secondary' : 'ghost'}
        >
          Attention
        </Button>
        {overview.attention > 0 && (
          <Button
            icon={<Icon name="attention" />}
            onClick={() => dispatchLegacyShellCommand('focus-next-attention')}
            size="sm"
            variant="secondary"
          >
            {overview.attention} need you
          </Button>
        )}
        <Button
          aria-pressed={overview.gridViewActive}
          icon={<Icon name="grid" />}
          onClick={() => dispatchLegacyShellCommand('toggle-grid')}
          size="sm"
          variant={overview.gridViewActive ? 'primary' : 'ghost'}
        >
          Overview
        </Button>
        <Button
          icon={<Icon name="search" />}
          onClick={() => dispatchLegacyShellCommand('open-command-palette')}
          size="sm"
          variant="ghost"
        >
          Search
        </Button>
        {activeSession && (
          <Button
            aria-pressed={inspectorOpen}
            icon={<Icon name="panel" />}
            onClick={onToggleInspector}
            size="sm"
            variant={inspectorOpen ? 'secondary' : 'ghost'}
          >
            Details
          </Button>
        )}
        <button
          className="sb-topbar-icon-button"
          type="button"
          onClick={() => dispatchLegacyShellCommand('open-settings')}
          aria-label="Open settings"
        >
          <Icon name="settings" size={16} />
        </button>
        <Chip tone={overview.running > 0 ? 'success' : 'neutral'}>{overview.running} live</Chip>
      </div>
    </header>
  );
}
