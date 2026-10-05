import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ancestorKeys,
  buildKbTree,
  entryMatches,
  filterKbTree,
  queryWords,
  type KbTreeNode,
} from '@renderer/lib/knowledge-model';
import type { KnowledgeBaseState } from '@renderer/hooks/useKnowledgeBase';
import { formatCount, rootColor } from '@renderer/components/knowledge/kb-ui';

const MAX_FILTERED_ROWS = 400;

interface KnowledgeSidebarProps {
  kb: KnowledgeBaseState;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

interface VisibleRow {
  node: KbTreeNode;
  depth: number;
}

/** Rows visible with the given folders expanded, depth-first, stopping at `limit`. */
function visibleRows(nodes: KbTreeNode[], expanded: Set<string>, limit: number) {
  const rows: VisibleRow[] = [];
  const visit = (list: KbTreeNode[], depth: number): boolean => {
    for (const node of list) {
      if (rows.length >= limit) return false;
      rows.push({ node, depth });
      if (node.kind !== 'file' && expanded.has(node.key) && !visit(node.children, depth + 1)) {
        return false;
      }
    }
    return true;
  };
  const complete = visit(nodes, 0);
  return { rows, complete };
}

export function KnowledgeSidebar({ kb, selectedId, onSelect }: KnowledgeSidebarProps) {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['vault']));
  const [collapsedWhileFiltering, setCollapsedWhileFiltering] = useState<Set<string>>(
    () => new Set(),
  );
  const [revealedId, setRevealedId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const roots = useMemo(() => kb.overview?.config.roots ?? [], [kb.overview]);
  const tree = useMemo(() => buildKbTree(kb.entries, roots), [kb.entries, roots]);
  const words = useMemo(() => queryWords(query), [query]);
  const filtered = useMemo(
    () =>
      words.length
        ? filterKbTree(tree, (id) => {
            const entry = kb.entriesById.get(id);
            return !!entry && entryMatches(entry, words);
          })
        : null,
    [kb.entriesById, tree, words],
  );

  const selectedEntry = selectedId ? kb.entriesById.get(selectedId) : undefined;
  if (selectedEntry && revealedId !== selectedEntry.id) {
    setRevealedId(selectedEntry.id);
    const keys = ancestorKeys(selectedEntry);
    if (!keys.every((key) => expanded.has(key))) setExpanded(new Set([...expanded, ...keys]));
  }

  useEffect(() => {
    if (!selectedId) return;
    const frame = requestAnimationFrame(() => {
      const rows = listRef.current?.querySelectorAll<HTMLElement>('[data-entry-id]') ?? [];
      [...rows]
        .find((row) => row.dataset.entryId === selectedId)
        ?.scrollIntoView({ block: 'nearest' });
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedId]);

  const toggle = (key: string) =>
    (filtered ? setCollapsedWhileFiltering : setExpanded)((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const { rows, complete } = useMemo(() => {
    if (!filtered) return visibleRows(tree, expanded, Number.POSITIVE_INFINITY);
    const open = new Set([...filtered.expand].filter((key) => !collapsedWhileFiltering.has(key)));
    return visibleRows(filtered.nodes, open, MAX_FILTERED_ROWS);
  }, [collapsedWhileFiltering, expanded, filtered, tree]);

  return (
    <div className="kb-sidebar">
      <div className="kb-sidebar-head">
        <strong>Knowledge bases</strong>
        <span>
          {kb.entries.length ? `${formatCount(kb.entries.length)} entries` : ''}
          {kb.overviewLoading ? ' · loading…' : ''}
        </span>
      </div>
      <div className="kb-sidebar-filter">
        <input
          type="search"
          value={query}
          placeholder="Filter by title or path…"
          aria-label="Filter knowledge base entries"
          onChange={(event) => {
            setQuery(event.target.value);
            setCollapsedWhileFiltering(new Set());
          }}
        />
        {filtered && (
          <span className="kb-sidebar-matches">
            {formatCount(filtered.matches)} match{filtered.matches === 1 ? '' : 'es'}
          </span>
        )}
      </div>
      <div className="kb-tree" ref={listRef} role="tree">
        {rows.length === 0 && (
          <div className="kb-sidebar-empty">
            {kb.overview && !kb.overview.index.exists
              ? 'No second-brain index yet.'
              : words.length
                ? 'Nothing matches.'
                : kb.activated && !kb.overviewLoading
                  ? 'No entries.'
                  : ''}
          </div>
        )}
        {rows.map(({ node, depth }) => {
          const indent = { paddingLeft: `${8 + depth * 12}px` };
          if (node.kind === 'file') {
            return (
              <button
                key={node.key}
                type="button"
                role="treeitem"
                className={`kb-tree-row is-file${node.entryId === selectedId ? ' is-selected' : ''}`}
                style={indent}
                title={node.entryId}
                data-entry-id={node.entryId}
                aria-selected={node.entryId === selectedId}
                onClick={() => node.entryId && onSelect(node.entryId)}
              >
                <span className={`kb-tree-dot layer-${node.layer}`} />
                <span className="kb-tree-name">{node.name.replace(/\.md$/i, '')}</span>
              </button>
            );
          }
          const open = filtered
            ? filtered.expand.has(node.key) && !collapsedWhileFiltering.has(node.key)
            : expanded.has(node.key);
          return (
            <button
              key={node.key}
              type="button"
              role="treeitem"
              className={`kb-tree-row is-${node.kind}`}
              style={indent}
              aria-expanded={open}
              onClick={() => toggle(node.key)}
            >
              <span className={`kb-tree-chevron${open ? ' is-open' : ''}`}>▸</span>
              {node.kind === 'root' && (
                <span
                  className="kb-tree-swatch"
                  style={{ background: rootColor(node.rootId, roots) }}
                />
              )}
              <span className="kb-tree-name">{node.name}</span>
              <span className="kb-tree-count">{formatCount(node.count)}</span>
            </button>
          );
        })}
        {!complete && (
          <div className="kb-sidebar-empty">
            Showing the first {MAX_FILTERED_ROWS} rows; refine the filter.
          </div>
        )}
      </div>
    </div>
  );
}
