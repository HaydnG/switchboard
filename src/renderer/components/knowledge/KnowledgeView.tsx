import type { ReactNode } from 'react';
import type { KnowledgeBaseState } from '@renderer/hooks/useKnowledgeBase';
import { formatCount, timeAgo, type KbTab } from '@renderer/components/knowledge/kb-ui';

const TABS: Array<{ id: KbTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'reader', label: 'Reader' },
  { id: 'graph', label: 'Graph' },
  { id: 'search', label: 'Search & eval' },
];

interface KnowledgeViewProps {
  kb: KnowledgeBaseState;
  tab: KbTab;
  onTab: (tab: KbTab) => void;
  children: ReactNode;
}

function StatusChip({
  tone,
  children,
  title,
}: {
  tone: 'ok' | 'warn' | 'off';
  children: ReactNode;
  title?: string;
}) {
  return (
    <span className={`kb-status is-${tone}`} title={title}>
      <span className="kb-status-dot" />
      {children}
    </span>
  );
}

function NotConfigured({ kb }: { kb: KnowledgeBaseState }) {
  const overview = kb.overview;
  return (
    <div className="kb-empty">
      <h3>No second-brain knowledge base found</h3>
      <p>
        Switchboard reads the second-brain plugin’s config and index. Install the plugin from{' '}
        <a
          href="https://github.com/doordash/second-brain-kb"
          onClick={(event) => {
            event.preventDefault();
            void window.api.openExternal('https://github.com/doordash/second-brain-kb');
          }}
        >
          doordash/second-brain-kb
        </a>{' '}
        and let it index once.
      </p>
      {overview?.config.error && <p className="kb-error">{overview.config.error}</p>}
      {overview?.index.error && <p className="kb-error">{overview.index.error}</p>}
      <dl className="kb-props">
        <div>
          <dt>Config</dt>
          <dd>{overview?.config.file ?? '—'}</dd>
        </div>
        <div>
          <dt>Index</dt>
          <dd>{overview?.index.dbPath ?? '—'}</dd>
        </div>
      </dl>
      {overview?.plugin && overview.config.vault && (
        <button
          type="button"
          className="btn"
          disabled={kb.busy !== null}
          onClick={() => void kb.reindex(true)}
        >
          Build the index now
        </button>
      )}
    </div>
  );
}

export function KnowledgeView({ kb, tab, onTab, children }: KnowledgeViewProps) {
  const overview = kb.overview;
  const health = overview?.daemon.health;
  const indexed = overview?.index.exists ?? false;

  return (
    <div className="kb-view">
      <header className="kb-header">
        <div className="kb-title">
          <h2>Knowledge</h2>
          <span className="kb-muted">
            second-brain{overview?.plugin?.version ? ` ${overview.plugin.version}` : ''}
          </span>
        </div>
        <div className="kb-status-row">
          {overview && (
            <>
              <StatusChip
                tone={overview.daemon.running ? 'ok' : 'off'}
                title={
                  overview.daemon.running
                    ? `Daemon on port ${overview.daemon.port}`
                    : 'Search needs the daemon'
                }
              >
                {overview.daemon.running ? 'Daemon running' : 'Daemon stopped'}
              </StatusChip>
              {!overview.daemon.running && overview.plugin && (
                <button
                  type="button"
                  className="btn"
                  disabled={kb.busy !== null}
                  onClick={() => void kb.startDaemon()}
                >
                  {kb.busy === 'daemon' ? 'Starting…' : 'Start'}
                </button>
              )}
              {indexed && (
                <StatusChip
                  tone="ok"
                  title={`${overview.index.dbPath}${overview.index.model ? ` · ${overview.index.model}` : ''}`}
                >
                  {formatCount(kb.entries.length)} entries ·{' '}
                  {formatCount(kb.entries.reduce((sum, entry) => sum + entry.chunks, 0))} chunks ·
                  indexed {timeAgo(overview.index.lastIndexMs)}
                </StatusChip>
              )}
              <StatusChip
                tone={overview.jev.readable ? 'ok' : overview.jev.configured ? 'warn' : 'off'}
                title={
                  overview.jev.readable
                    ? `Jev key from ${overview.jev.source}`
                    : overview.jev.configured
                      ? 'The configured Jev key file is not readable'
                      : 'No Jev key configured — search runs without the relevance gate'
                }
              >
                {overview.jev.readable
                  ? 'Jev ready'
                  : overview.jev.configured
                    ? 'Jev key unreadable'
                    : 'Jev off'}
              </StatusChip>
              {health && health.unpromoted > 0 && (
                <StatusChip tone="warn" title="Discovered notes waiting for /promote">
                  {formatCount(health.unpromoted)} to promote
                </StatusChip>
              )}
            </>
          )}
        </div>
        <div className="kb-actions">
          <button
            type="button"
            className="btn"
            disabled={kb.busy !== null || !overview?.plugin}
            title={
              overview?.plugin
                ? 'Index notes that changed since the last run'
                : 'second-brain plugin not found'
            }
            onClick={() => void kb.reindex(false)}
          >
            {kb.busy === 'reindex' ? 'Reindexing…' : 'Reindex'}
          </button>
          <button
            type="button"
            className="btn"
            disabled={kb.overviewLoading}
            onClick={() => {
              void kb.refreshOverview();
              void kb.loadGraph();
            }}
          >
            Refresh
          </button>
        </div>
      </header>

      {kb.notice && (
        <div className={`kb-notice is-${kb.notice.tone}`} role="status">
          <span>{kb.notice.text}</span>
          <button type="button" aria-label="Dismiss" onClick={() => kb.setNotice(null)}>
            ×
          </button>
        </div>
      )}

      {overview && !indexed && !kb.overviewLoading ? (
        <NotConfigured kb={kb} />
      ) : (
        <>
          <nav className="kb-tabs" role="tablist">
            {TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={tab === item.id}
                className={tab === item.id ? 'is-active' : ''}
                onClick={() => onTab(item.id)}
              >
                {item.label}
              </button>
            ))}
            {kb.graphLoading && (
              <span className="kb-muted kb-tabs-status">
                Building link graph
                {kb.graphProgress
                  ? ` · ${formatCount(kb.graphProgress.done)}/${formatCount(kb.graphProgress.total)}`
                  : '…'}
              </span>
            )}
          </nav>
          <div className="kb-tab-body">{children}</div>
        </>
      )}
    </div>
  );
}
