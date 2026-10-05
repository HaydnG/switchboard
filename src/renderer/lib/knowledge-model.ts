import type {
  KbBenchCase,
  KbCandidate,
  KbEdge,
  KbEntry,
  KbLayer,
  KbLinkKind,
  KbRoot,
  KbSearchResult,
} from '@renderer/types/knowledge';

// --- File tree -------------------------------------------------------------

export interface KbTreeNode {
  key: string;
  name: string;
  kind: 'root' | 'dir' | 'file';
  rootId: string;
  entryId?: string;
  layer?: KbLayer;
  count: number;
  children: KbTreeNode[];
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function sortTree(node: KbTreeNode): void {
  node.children.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
    return collator.compare(a.name, b.name);
  });
  for (const child of node.children) if (child.kind === 'dir') sortTree(child);
}

/** One tree per connected knowledge base, folders first, counting the entries below each node. */
export function buildKbTree(entries: KbEntry[], roots: KbRoot[]): KbTreeNode[] {
  const rootNodes = new Map<string, KbTreeNode>();
  const dirs = new Map<string, KbTreeNode>();
  const rootLabel = new Map(roots.map((root) => [root.id, root.label]));
  for (const root of roots) {
    rootNodes.set(root.id, {
      key: root.id,
      name: root.label,
      kind: 'root',
      rootId: root.id,
      count: 0,
      children: [],
    });
  }

  for (const entry of entries) {
    let parent = rootNodes.get(entry.rootId);
    if (!parent) {
      parent = {
        key: entry.rootId,
        name: rootLabel.get(entry.rootId) ?? (entry.rootId === 'other' ? 'Other' : entry.rootId),
        kind: 'root',
        rootId: entry.rootId,
        count: 0,
        children: [],
      };
      rootNodes.set(entry.rootId, parent);
    }
    parent.count++;
    const segments = entry.relPath.split('/').filter(Boolean);
    let prefix = entry.rootId;
    for (const segment of segments.slice(0, -1)) {
      prefix = `${prefix}/${segment}`;
      let dir = dirs.get(prefix);
      if (!dir) {
        dir = {
          key: prefix,
          name: segment,
          kind: 'dir',
          rootId: entry.rootId,
          count: 0,
          children: [],
        };
        dirs.set(prefix, dir);
        parent.children.push(dir);
      }
      dir.count++;
      parent = dir;
    }
    parent.children.push({
      key: `${entry.rootId}::${entry.id}`,
      name: segments.at(-1) ?? entry.relPath,
      kind: 'file',
      rootId: entry.rootId,
      entryId: entry.id,
      layer: entry.layer,
      count: 1,
      children: [],
    });
  }

  const ordered = [...rootNodes.values()];
  for (const node of ordered) sortTree(node);
  return ordered;
}

export function entryMatches(entry: KbEntry, words: string[]): boolean {
  if (words.length === 0) return true;
  const haystack = `${entry.title} ${entry.relPath}`.toLocaleLowerCase();
  return words.every((word) => haystack.includes(word));
}

export function queryWords(query: string): string[] {
  return query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * The tree reduced to files whose title or path contains every query word,
 * plus the keys of the folders leading to them (to expand).
 */
export function filterKbTree(
  nodes: KbTreeNode[],
  matchesEntry: (entryId: string) => boolean,
): { nodes: KbTreeNode[]; expand: Set<string>; matches: number } {
  const expand = new Set<string>();
  let matches = 0;
  const visit = (node: KbTreeNode): KbTreeNode | null => {
    if (node.kind === 'file') {
      if (!node.entryId || !matchesEntry(node.entryId)) return null;
      matches++;
      return node;
    }
    const children = node.children.map(visit).filter((child): child is KbTreeNode => !!child);
    if (children.length === 0) return null;
    expand.add(node.key);
    const count = children.reduce((sum, child) => sum + child.count, 0);
    return { ...node, children, count };
  };
  const filtered = nodes.map(visit).filter((node): node is KbTreeNode => !!node);
  return { nodes: filtered, expand, matches };
}

/** Folder keys from the root down to (not including) an entry, for revealing it. */
export function ancestorKeys(entry: KbEntry): string[] {
  const keys = [entry.rootId];
  let prefix = entry.rootId;
  for (const segment of entry.relPath.split('/').filter(Boolean).slice(0, -1)) {
    prefix = `${prefix}/${segment}`;
    keys.push(prefix);
  }
  return keys;
}

// --- Links -----------------------------------------------------------------

export const LINK_KIND_LABELS: Record<KbLinkKind, string> = {
  source: 'Source',
  related: 'Related',
  wikilink: 'Wikilink',
  link: 'Link',
  cite: 'Citation',
};

export interface KbAdjacency {
  out: Map<string, KbEdge[]>;
  in: Map<string, KbEdge[]>;
}

export function buildAdjacency(edges: KbEdge[]): KbAdjacency {
  const out = new Map<string, KbEdge[]>();
  const incoming = new Map<string, KbEdge[]>();
  for (const edge of edges) {
    if (!out.has(edge.from)) out.set(edge.from, []);
    out.get(edge.from)!.push(edge);
    if (!incoming.has(edge.to)) incoming.set(edge.to, []);
    incoming.get(edge.to)!.push(edge);
  }
  return { out, in: incoming };
}

export function degree(adjacency: KbAdjacency, id: string): number {
  return (adjacency.out.get(id)?.length ?? 0) + (adjacency.in.get(id)?.length ?? 0);
}

export interface KbSubgraph {
  nodes: string[];
  edges: KbEdge[];
  depthOf: Map<string, number>;
  truncated: boolean;
}

function edgesAmong(nodes: Set<string>, adjacency: KbAdjacency, kinds: Set<KbLinkKind>) {
  const edges: KbEdge[] = [];
  for (const id of nodes) {
    for (const edge of adjacency.out.get(id) ?? []) {
      if (kinds.has(edge.kind) && nodes.has(edge.to)) edges.push(edge);
    }
  }
  return edges;
}

/** Entries within `depth` links of `center` in either direction, nearest first, capped at `limit`. */
export function neighbourhood(
  adjacency: KbAdjacency,
  center: string,
  depth: number,
  kinds: Set<KbLinkKind>,
  limit: number,
): KbSubgraph {
  const depthOf = new Map<string, number>([[center, 0]]);
  let frontier = [center];
  let truncated = false;
  for (let level = 1; level <= depth && frontier.length > 0; level++) {
    const next: string[] = [];
    for (const id of frontier) {
      const neighbours = [
        ...(adjacency.out.get(id) ?? []).filter((e) => kinds.has(e.kind)).map((e) => e.to),
        ...(adjacency.in.get(id) ?? []).filter((e) => kinds.has(e.kind)).map((e) => e.from),
      ];
      for (const neighbour of neighbours) {
        if (depthOf.has(neighbour)) continue;
        if (depthOf.size >= limit) {
          truncated = true;
          break;
        }
        depthOf.set(neighbour, level);
        next.push(neighbour);
      }
    }
    frontier = next;
  }
  const nodes = new Set(depthOf.keys());
  return { nodes: [...nodes], edges: edgesAmong(nodes, adjacency, kinds), depthOf, truncated };
}

/** The most connected entries (optionally within one knowledge base) and the links between them. */
export function hubMap(
  entries: KbEntry[],
  adjacency: KbAdjacency,
  kinds: Set<KbLinkKind>,
  limit: number,
  rootId: string | null,
): KbSubgraph {
  const kindDegree = (id: string) =>
    (adjacency.out.get(id) ?? []).filter((e) => kinds.has(e.kind)).length +
    (adjacency.in.get(id) ?? []).filter((e) => kinds.has(e.kind)).length;
  const ranked = entries
    .filter((entry) => !rootId || entry.rootId === rootId)
    .map((entry) => [entry.id, kindDegree(entry.id)] as const)
    .filter(([, d]) => d > 0)
    .sort((a, b) => b[1] - a[1]);
  const nodes = new Set(ranked.slice(0, limit).map(([id]) => id));
  return {
    nodes: [...nodes],
    edges: edgesAmong(nodes, adjacency, kinds),
    depthOf: new Map(),
    truncated: ranked.length > limit,
  };
}

export interface KbConnection {
  id: string;
  kind: KbLinkKind;
}

/** Direct connections of one entry for the connection tree, sorted by title. */
export function connections(
  adjacency: KbAdjacency,
  id: string,
  direction: 'out' | 'in',
  titleOf: (id: string) => string,
): KbConnection[] {
  const edges = (direction === 'out' ? adjacency.out : adjacency.in).get(id) ?? [];
  return edges
    .map((edge) => ({ id: direction === 'out' ? edge.to : edge.from, kind: edge.kind }))
    .sort((a, b) => collator.compare(titleOf(a.id), titleOf(b.id)));
}

// --- Search evaluation -------------------------------------------------------

export interface KbEvalRun {
  id: string;
  ranAt: number;
  query: string;
  pool: number;
  max: number;
  threshold: number;
  candidates: KbCandidate[];
  labels: Record<number, boolean>;
  timings: KbSearchResult['timings'];
  jev: KbSearchResult['jev'];
  productionTimeoutMs: number;
}

export function evalRunFromResult(result: KbSearchResult): KbEvalRun {
  return {
    id: `${result.ranAt}-${Math.random().toString(36).slice(2, 8)}`,
    ranAt: result.ranAt,
    query: result.query,
    pool: result.pool,
    max: result.max,
    threshold: result.threshold,
    candidates: result.candidates.map((candidate) => ({
      ...candidate,
      excerpt: candidate.excerpt.slice(0, 500),
    })),
    labels: {},
    timings: result.timings,
    jev: result.jev,
    productionTimeoutMs: result.productionTimeoutMs,
  };
}

/** Jev's picks at a threshold: probability ≥ threshold, most relevant first, at most `max`. */
export function jevPicks(run: KbEvalRun, threshold = run.threshold): number[] {
  return run.candidates
    .map((candidate, i) => [candidate.relevance, i] as const)
    .filter((pair): pair is readonly [number, number] => typeof pair[0] === 'number')
    .filter(([p]) => p >= threshold)
    .sort((a, b) => b[0] - a[0])
    .slice(0, run.max)
    .map(([, i]) => i);
}

/** Search alone: the top `max` candidates by fused rank. */
export function searchPicks(run: KbEvalRun): number[] {
  return run.candidates.slice(0, run.max).map((_, i) => i);
}

export function isLabelled(run: KbEvalRun): boolean {
  return Object.keys(run.labels).length > 0;
}

export function relevantIndices(run: KbEvalRun): number[] {
  return Object.entries(run.labels)
    .filter(([, relevant]) => relevant)
    .map(([index]) => Number(index))
    .sort((a, b) => a - b);
}

export interface KbPickScore {
  injected: number;
  hits: number;
  precision: number | null;
  recall: number | null;
  silentOk: number;
  silentCases: number;
  cases: number;
}

/**
 * Scores picks the way bench/relevance.ts does: precision over everything
 * injected, recall capped at `max` per case, and silence when nothing is relevant.
 * Unlabelled candidates count as not relevant.
 */
export function scorePicks(runs: KbEvalRun[], pick: (run: KbEvalRun) => number[]): KbPickScore {
  let injected = 0;
  let hits = 0;
  let coverNum = 0;
  let coverDen = 0;
  let silentOk = 0;
  let silentCases = 0;
  for (const run of runs) {
    const want = new Set(relevantIndices(run));
    const got = pick(run);
    const good = got.filter((i) => want.has(i)).length;
    injected += got.length;
    hits += good;
    coverNum += Math.min(run.max, good);
    coverDen += Math.min(run.max, want.size);
    if (want.size === 0) {
      silentCases++;
      if (got.length === 0) silentOk++;
    }
  }
  return {
    injected,
    hits,
    precision: injected > 0 ? hits / injected : null,
    recall: coverDen > 0 ? coverNum / coverDen : null,
    silentOk,
    silentCases,
    cases: runs.length,
  };
}

/** Share of labelled candidates where Jev's p ≥ threshold agrees with the label. */
export function jevAgreement(runs: KbEvalRun[], threshold: number): number | null {
  let agree = 0;
  let total = 0;
  for (const run of runs) {
    for (const [index, relevant] of Object.entries(run.labels)) {
      const p = run.candidates[Number(index)]?.relevance;
      if (typeof p !== 'number') continue;
      total++;
      if (p >= threshold === relevant) agree++;
    }
  }
  return total > 0 ? agree / total : null;
}

export function toBenchCases(runs: KbEvalRun[]): KbBenchCase[] {
  return runs.filter(isLabelled).map((run) => ({
    prompt: run.query,
    hits: run.candidates.map(({ path, realpath, heading, excerpt }) => ({
      path,
      realpath,
      heading,
      excerpt,
    })),
    relevant: relevantIndices(run),
  }));
}

export function formatRatio(value: number | null): string {
  return value === null ? '—' : value.toFixed(2);
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
