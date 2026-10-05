import { useMemo } from 'react';
import type { KnowledgeBaseState } from '@renderer/hooks/useKnowledgeBase';
import { degree, LINK_KIND_LABELS } from '@renderer/lib/knowledge-model';
import type { KbLinkKind } from '@renderer/types/knowledge';
import {
  entryName,
  formatCount,
  formatMs,
  LINK_KIND_COLORS,
  rootColor,
  rootLabel,
  timeAgo,
} from '@renderer/components/knowledge/kb-ui';

interface KnowledgeOverviewProps {
  kb: KnowledgeBaseState;
  onOpen: (id: string) => void;
}

export function KnowledgeOverview({ kb, onOpen }: KnowledgeOverviewProps) {
  const roots = useMemo(() => kb.overview?.config.roots ?? [], [kb.overview]);

  const rootStats = useMemo(() => {
    const stats = new Map<
      string,
      {
        entries: number;
        chunks: number;
        wiki: number;
        discovered: number;
        latest: number;
        links: number;
      }
    >();
    for (const entry of kb.entries) {
      const s = stats.get(entry.rootId) ?? {
        entries: 0,
        chunks: 0,
        wiki: 0,
        discovered: 0,
        latest: 0,
        links: 0,
      };
      s.entries++;
      s.chunks += entry.chunks;
      if (entry.layer === 'wiki') s.wiki++;
      if (entry.layer === 'discovered') s.discovered++;
      s.latest = Math.max(s.latest, entry.mtimeMs);
      s.links += kb.adjacency.out.get(entry.id)?.length ?? 0;
      stats.set(entry.rootId, s);
    }
    return stats;
  }, [kb.adjacency, kb.entries]);

  const rootIds = useMemo(() => {
    const ids = roots.map((root) => root.id);
    for (const id of rootStats.keys()) if (!ids.includes(id)) ids.push(id);
    return ids;
  }, [rootStats, roots]);

  const hubs = useMemo(
    () =>
      kb.entries
        .map((entry) => ({ entry, degree: degree(kb.adjacency, entry.id) }))
        .filter((item) => item.degree > 0)
        .sort((a, b) => b.degree - a.degree)
        .slice(0, 12),
    [kb.adjacency, kb.entries],
  );

  const recent = useMemo(
    () => [...kb.entries].sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, 12),
    [kb.entries],
  );

  const health = useMemo(() => {
    if (!kb.graph) return null;
    const byKind = new Map<KbLinkKind, number>();
    for (const edge of kb.graph.edges) byKind.set(edge.kind, (byKind.get(edge.kind) ?? 0) + 1);
    const unresolved = Object.values(kb.graph.unresolved).reduce(
      (sum, list) => sum + list.length,
      0,
    );
    const orphans = kb.entries.filter((entry) => degree(kb.adjacency, entry.id) === 0).length;
    const worst = Object.entries(kb.graph.unresolved)
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 6);
    return { byKind, unresolved, orphans, worst };
  }, [kb.adjacency, kb.entries, kb.graph]);

  return (
    <div className="kb-overview">
      <section className="kb-cards">
        {rootIds.map((rootId) => {
          const s = rootStats.get(rootId);
          const root = roots.find((item) => item.id === rootId);
          return (
            <article key={rootId} className="kb-card">
              <header>
                <span className="kb-tree-swatch" style={{ background: rootColor(rootId, roots) }} />
                <strong>{rootLabel(rootId, roots)}</strong>
                {root?.isVault && <span className="kb-pill">vault</span>}
              </header>
              {root && (
                <div className="kb-card-path" title={root.path}>
                  {root.path}
                </div>
              )}
              <dl className="kb-stat-grid">
                <div>
                  <dt>Entries</dt>
                  <dd>{formatCount(s?.entries ?? 0)}</dd>
                </div>
                <div>
                  <dt>Chunks</dt>
                  <dd>{formatCount(s?.chunks ?? 0)}</dd>
                </div>
                <div>
                  <dt>Outgoing links</dt>
                  <dd>{kb.graph ? formatCount(s?.links ?? 0) : '…'}</dd>
                </div>
                <div>
                  <dt>Updated</dt>
                  <dd>{timeAgo(s?.latest ?? 0)}</dd>
                </div>
                {root?.isVault && (
                  <>
                    <div>
                      <dt>Wiki articles</dt>
                      <dd>{formatCount(s?.wiki ?? 0)}</dd>
                    </div>
                    <div>
                      <dt>Discovered</dt>
                      <dd>{formatCount(s?.discovered ?? 0)}</dd>
                    </div>
                  </>
                )}
              </dl>
            </article>
          );
        })}
      </section>

      <div className="kb-overview-columns">
        <section className="kb-panel">
          <h4>Most connected</h4>
          {hubs.length === 0 ? (
            <p className="kb-muted">
              {kb.graph ? 'No links found.' : 'Waiting for the link graph…'}
            </p>
          ) : (
            <ol className="kb-rank-list">
              {hubs.map(({ entry, degree: d }) => (
                <li key={entry.id}>
                  <span
                    className="kb-tree-swatch"
                    style={{ background: rootColor(entry.rootId, roots) }}
                  />
                  <button
                    type="button"
                    className="kb-link-button"
                    title={entry.id}
                    onClick={() => onOpen(entry.id)}
                  >
                    {entryName(entry, entry.id)}
                  </button>
                  <span className="kb-muted">
                    {kb.adjacency.out.get(entry.id)?.length ?? 0}↗{' '}
                    {kb.adjacency.in.get(entry.id)?.length ?? 0}↙ · {d}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="kb-panel">
          <h4>Recently updated</h4>
          <ol className="kb-rank-list">
            {recent.map((entry) => (
              <li key={entry.id}>
                <span
                  className="kb-tree-swatch"
                  style={{ background: rootColor(entry.rootId, roots) }}
                />
                <button
                  type="button"
                  className="kb-link-button"
                  title={entry.id}
                  onClick={() => onOpen(entry.id)}
                >
                  {entryName(entry, entry.id)}
                </button>
                <span className="kb-muted">{timeAgo(entry.mtimeMs)}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="kb-panel">
          <h4>Link health</h4>
          {!health || !kb.graph ? (
            <p className="kb-muted">
              {kb.graphLoading
                ? `Building${kb.graphProgress ? ` · ${formatCount(kb.graphProgress.done)}/${formatCount(kb.graphProgress.total)}` : '…'}`
                : 'Link graph not loaded.'}
            </p>
          ) : (
            <>
              <dl className="kb-stat-grid">
                <div>
                  <dt>Links</dt>
                  <dd>{formatCount(kb.graph.edges.length)}</dd>
                </div>
                <div>
                  <dt title="References that point at files that are not in the index (other repos, deleted notes, external docs)">
                    Outside the index
                  </dt>
                  <dd>{formatCount(health.unresolved)}</dd>
                </div>
                <div>
                  <dt>Unlinked entries</dt>
                  <dd>{formatCount(health.orphans)}</dd>
                </div>
                <div>
                  <dt>Unreadable</dt>
                  <dd>{formatCount(kb.graph.unreadable.length)}</dd>
                </div>
              </dl>
              <div className="kb-kind-bars">
                {[...health.byKind.entries()]
                  .sort((a, b) => b[1] - a[1])
                  .map(([kind, count]) => (
                    <div key={kind} className="kb-kind-bar">
                      <span>{LINK_KIND_LABELS[kind]}</span>
                      <span className="kb-bar">
                        <span
                          style={{
                            width: `${(count / Math.max(1, kb.graph!.edges.length)) * 100}%`,
                            background: LINK_KIND_COLORS[kind],
                          }}
                        />
                      </span>
                      <span className="kb-muted">{formatCount(count)}</span>
                    </div>
                  ))}
              </div>
              {health.worst.length > 0 && (
                <>
                  <h5>Most references outside the index</h5>
                  <ul className="kb-plain-list">
                    {health.worst.map(([id, list]) => (
                      <li key={id}>
                        <button type="button" className="kb-link-button" onClick={() => onOpen(id)}>
                          {entryName(kb.entriesById.get(id), id)}
                        </button>{' '}
                        <span className="kb-muted">{list.length}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <p className="kb-muted">
                Built in {formatMs(kb.graph.ms)} · {timeAgo(kb.graph.builtAt)}{' '}
                <button
                  type="button"
                  className="kb-link-button"
                  onClick={() => void kb.loadGraph(true)}
                >
                  Rebuild
                </button>
              </p>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
