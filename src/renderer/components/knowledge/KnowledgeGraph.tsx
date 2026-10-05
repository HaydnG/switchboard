import { useMemo, useRef, useState, type PointerEvent, type WheelEvent } from 'react';
import type { KnowledgeBaseState } from '@renderer/hooks/useKnowledgeBase';
import { forceLayout } from '@renderer/lib/force-layout';
import { degree, hubMap, LINK_KIND_LABELS, neighbourhood } from '@renderer/lib/knowledge-model';
import type { KbLinkKind } from '@renderer/types/knowledge';
import {
  entryName,
  formatCount,
  LINK_KIND_COLORS,
  LINK_KIND_HELP,
  rootColor,
  rootLabel,
} from '@renderer/components/knowledge/kb-ui';

const WIDTH = 1000;
const HEIGHT = 680;
const ALL_KINDS: KbLinkKind[] = ['source', 'related', 'wikilink', 'link', 'cite'];
const LIMITS = [60, 120, 250];

interface KnowledgeGraphProps {
  kb: KnowledgeBaseState;
  focusId: string | null;
  onFocus: (id: string) => void;
  onOpen: (id: string) => void;
}

interface ViewTransform {
  x: number;
  y: number;
  k: number;
}

const IDENTITY: ViewTransform = { x: 0, y: 0, k: 1 };

export function KnowledgeGraph({ kb, focusId, onFocus, onOpen }: KnowledgeGraphProps) {
  const [mode, setMode] = useState<'neighbourhood' | 'hubs'>(focusId ? 'neighbourhood' : 'hubs');
  const [depth, setDepth] = useState(1);
  const [kinds, setKinds] = useState<Set<KbLinkKind>>(() => new Set(ALL_KINDS));
  const [limit, setLimit] = useState(120);
  const [hubRoot, setHubRoot] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [view, setView] = useState<ViewTransform>(IDENTITY);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; view: ViewTransform; moved: boolean } | null>(null);
  const roots = useMemo(() => kb.overview?.config.roots ?? [], [kb.overview]);

  const [seenFocus, setSeenFocus] = useState(focusId);
  if (focusId !== seenFocus) {
    setSeenFocus(focusId);
    if (focusId) setMode('neighbourhood');
  }

  const subgraph = useMemo(() => {
    if (mode === 'neighbourhood' && focusId) {
      return neighbourhood(kb.adjacency, focusId, depth, kinds, limit);
    }
    return hubMap(kb.entries, kb.adjacency, kinds, limit, hubRoot);
  }, [depth, focusId, hubRoot, kb.adjacency, kb.entries, kinds, limit, mode]);

  const pinned = mode === 'neighbourhood' && focusId ? focusId : null;
  const layout = useMemo(
    () =>
      forceLayout(subgraph.nodes, subgraph.edges, {
        width: WIDTH,
        height: HEIGHT,
        pinned: pinned ? [pinned] : [],
      }),
    [pinned, subgraph],
  );

  const [viewedSubgraph, setViewedSubgraph] = useState(subgraph);
  if (viewedSubgraph !== subgraph) {
    setViewedSubgraph(subgraph);
    setView(IDENTITY);
  }

  const degreeOf = useMemo(() => {
    const map = new Map<string, number>();
    for (const id of subgraph.nodes) map.set(id, degree(kb.adjacency, id));
    return map;
  }, [kb.adjacency, subgraph.nodes]);

  const highlighted = useMemo(() => {
    const anchor = hover ?? pinned;
    if (!anchor) return null;
    const set = new Set([anchor]);
    for (const edge of subgraph.edges) {
      if (edge.from === anchor) set.add(edge.to);
      if (edge.to === anchor) set.add(edge.from);
    }
    return set;
  }, [hover, pinned, subgraph.edges]);

  const labelled = useMemo(() => {
    if (subgraph.nodes.length <= 30) return new Set(subgraph.nodes);
    const top = [...subgraph.nodes]
      .sort((a, b) => (degreeOf.get(b) ?? 0) - (degreeOf.get(a) ?? 0))
      .slice(0, 14);
    return new Set([
      ...top,
      ...(hover && highlighted ? highlighted : []),
      ...(pinned ? [pinned] : []),
    ]);
  }, [degreeOf, highlighted, hover, pinned, subgraph.nodes]);

  const toggleKind = (kind: KbLinkKind) =>
    setKinds((current) => {
      const next = new Set(current);
      if (next.has(kind)) {
        if (next.size > 1) next.delete(kind);
      } else next.add(kind);
      return next;
    });

  const toSvg = (clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return { x: 0, y: 0 };
    const scale = Math.max(WIDTH / rect.width, HEIGHT / rect.height);
    const offsetX = (rect.width * scale - WIDTH) / 2;
    const offsetY = (rect.height * scale - HEIGHT) / 2;
    return {
      x: (clientX - rect.left) * scale - offsetX,
      y: (clientY - rect.top) * scale - offsetY,
    };
  };

  const onWheel = (event: WheelEvent<SVGSVGElement>) => {
    const point = toSvg(event.clientX, event.clientY);
    setView((current) => {
      const k = Math.min(6, Math.max(0.3, current.k * Math.exp(-event.deltaY * 0.0015)));
      return {
        k,
        x: point.x - ((point.x - current.x) * k) / current.k,
        y: point.y - ((point.y - current.y) * k) / current.k,
      };
    });
  };

  const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    drag.current = { x: event.clientX, y: event.clientY, view, moved: false };
  };
  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const state = drag.current;
    if (!state) return;
    const from = toSvg(state.x, state.y);
    const to = toSvg(event.clientX, event.clientY);
    if (!state.moved && Math.hypot(to.x - from.x, to.y - from.y) < 3) return;
    if (!state.moved) {
      state.moved = true;
      svgRef.current?.setPointerCapture(event.pointerId);
    }
    setView({ ...state.view, x: state.view.x + to.x - from.x, y: state.view.y + to.y - from.y });
  };
  const onPointerUp = () => {
    window.setTimeout(() => {
      drag.current = null;
    }, 0);
  };
  const wasDrag = () => drag.current?.moved === true;

  const focusEntry = focusId ? kb.entriesById.get(focusId) : undefined;
  const hoverEntry = hover ? kb.entriesById.get(hover) : undefined;
  const cardEntry = hoverEntry ?? focusEntry;

  if (!kb.graph) {
    return (
      <div className="kb-empty">
        <h3>{kb.graphLoading ? 'Building the link graph…' : 'Link graph not loaded'}</h3>
        {kb.graphProgress && (
          <p>
            Reading notes {formatCount(kb.graphProgress.done)} /{' '}
            {formatCount(kb.graphProgress.total)}. The first build reads every note (slow on Google
            Drive); later builds reuse a per-file cache.
          </p>
        )}
        {!kb.graphLoading && (
          <button type="button" className="btn" onClick={() => void kb.loadGraph()}>
            Build link graph
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="kb-graph">
      <div className="kb-graph-toolbar">
        <div className="kb-segmented" role="group" aria-label="Graph mode">
          <button
            type="button"
            className={mode === 'neighbourhood' ? 'is-active' : ''}
            disabled={!focusId}
            title={focusId ? '' : 'Select an entry first'}
            onClick={() => setMode('neighbourhood')}
          >
            Neighbourhood
          </button>
          <button
            type="button"
            className={mode === 'hubs' ? 'is-active' : ''}
            onClick={() => setMode('hubs')}
          >
            Hubs
          </button>
        </div>
        {mode === 'neighbourhood' ? (
          <label className="kb-field">
            Depth
            <select value={depth} onChange={(event) => setDepth(Number(event.target.value))}>
              {[1, 2, 3].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="kb-field">
            Scope
            <select
              value={hubRoot ?? ''}
              onChange={(event) => setHubRoot(event.target.value || null)}
            >
              <option value="">All knowledge bases</option>
              {roots.map((root) => (
                <option key={root.id} value={root.id}>
                  {root.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="kb-field">
          Nodes
          <select value={limit} onChange={(event) => setLimit(Number(event.target.value))}>
            {LIMITS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <div className="kb-kind-toggles">
          {ALL_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              className={`chip${kinds.has(kind) ? ' is-on' : ''}`}
              title={LINK_KIND_HELP[kind]}
              aria-pressed={kinds.has(kind)}
              onClick={() => toggleKind(kind)}
            >
              <span className="kb-kind-dot" style={{ background: LINK_KIND_COLORS[kind] }} />
              {LINK_KIND_LABELS[kind]}
            </button>
          ))}
        </div>
        <button type="button" className="btn" onClick={() => setView(IDENTITY)}>
          Reset view
        </button>
      </div>

      <div className="kb-graph-stage">
        {subgraph.nodes.length === 0 ? (
          <div className="kb-empty">
            <p>
              {mode === 'neighbourhood'
                ? 'This entry has no links of the selected kinds.'
                : 'No linked entries for these filters.'}
            </p>
          </div>
        ) : (
          <svg
            ref={svgRef}
            className="kb-graph-svg"
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            onWheel={onWheel}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={() => {
              drag.current = null;
            }}
          >
            <defs>
              {ALL_KINDS.map((kind) => (
                <marker
                  key={kind}
                  id={`kb-arrow-${kind}`}
                  viewBox="0 0 10 10"
                  refX="10"
                  refY="5"
                  markerWidth="5"
                  markerHeight="5"
                  orient="auto-start-reverse"
                >
                  <path d="M0,0 L10,5 L0,10 z" fill={LINK_KIND_COLORS[kind]} />
                </marker>
              ))}
            </defs>
            <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
              {subgraph.edges.map((edge) => {
                const a = layout.get(edge.from);
                const b = layout.get(edge.to);
                if (!a || !b) return null;
                const active = highlighted?.has(edge.from) && highlighted.has(edge.to);
                const r = 4 + Math.min(10, Math.sqrt(degreeOf.get(edge.to) ?? 0) * 1.4);
                const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
                return (
                  <line
                    key={`${edge.from}->${edge.to}`}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x - ((b.x - a.x) / length) * (r + 2)}
                    y2={b.y - ((b.y - a.y) / length) * (r + 2)}
                    stroke={LINK_KIND_COLORS[edge.kind]}
                    strokeOpacity={highlighted ? (active ? 0.9 : 0.08) : 0.35}
                    strokeWidth={(active ? 1.6 : 1) / view.k}
                    markerEnd={`url(#kb-arrow-${edge.kind})`}
                  />
                );
              })}
              {subgraph.nodes.map((id) => {
                const point = layout.get(id);
                if (!point) return null;
                const entry = kb.entriesById.get(id);
                const r = 4 + Math.min(10, Math.sqrt(degreeOf.get(id) ?? 0) * 1.4);
                const dim = highlighted && !highlighted.has(id);
                return (
                  <g
                    key={id}
                    className={`kb-node${id === focusId ? ' is-focus' : ''}`}
                    transform={`translate(${point.x} ${point.y})`}
                    opacity={dim ? 0.25 : 1}
                    onPointerEnter={() => setHover(id)}
                    onPointerLeave={() => setHover((current) => (current === id ? null : current))}
                    onClick={() => {
                      if (!wasDrag()) onFocus(id);
                    }}
                    onDoubleClick={() => onOpen(id)}
                  >
                    <circle
                      r={r / Math.sqrt(view.k)}
                      fill={rootColor(entry?.rootId ?? 'other', roots)}
                    />
                    {labelled.has(id) && (
                      <text
                        x={(r + 4) / Math.sqrt(view.k)}
                        y={4 / Math.sqrt(view.k)}
                        fontSize={12 / Math.sqrt(view.k)}
                      >
                        {entryName(entry, id).slice(0, 48)}
                      </text>
                    )}
                    <title>{entry?.relPath ?? id}</title>
                  </g>
                );
              })}
            </g>
          </svg>
        )}
        <div className="kb-graph-info">
          <div>
            {formatCount(subgraph.nodes.length)} nodes · {formatCount(subgraph.edges.length)} links
            {subgraph.truncated && <span className="kb-muted"> · capped at {limit}</span>}
          </div>
          {cardEntry && (
            <div className="kb-graph-card">
              <strong>{entryName(cardEntry, cardEntry.id)}</strong>
              <span className="kb-muted">
                {rootLabel(cardEntry.rootId, roots)} · {cardEntry.relPath}
              </span>
              <span className="kb-muted">
                {kb.adjacency.out.get(cardEntry.id)?.length ?? 0} out ·{' '}
                {kb.adjacency.in.get(cardEntry.id)?.length ?? 0} in
              </span>
              <button type="button" className="btn" onClick={() => onOpen(cardEntry.id)}>
                Open in reader
              </button>
            </div>
          )}
          <div className="kb-legend">
            {roots.map((root) => (
              <span key={root.id}>
                <span
                  className="kb-tree-swatch"
                  style={{ background: rootColor(root.id, roots) }}
                />
                {root.label}
              </span>
            ))}
          </div>
          <div className="kb-muted kb-graph-hint">
            Click a node to centre on it, double-click to read it. Scroll to zoom, drag to pan.
          </div>
        </div>
      </div>
    </div>
  );
}
