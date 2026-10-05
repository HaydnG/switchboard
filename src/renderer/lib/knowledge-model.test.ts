import { describe, expect, it } from 'vitest';
import { forceLayout } from '@renderer/lib/force-layout';
import {
  ancestorKeys,
  buildAdjacency,
  buildKbTree,
  connections,
  entryMatches,
  filterKbTree,
  hubMap,
  jevAgreement,
  jevPicks,
  neighbourhood,
  queryWords,
  scorePicks,
  searchPicks,
  toBenchCases,
  type KbEvalRun,
} from '@renderer/lib/knowledge-model';
import type { KbCandidate, KbEdge, KbEntry, KbLinkKind, KbRoot } from '@renderer/types/knowledge';

function entry(id: string, rootId: string, relPath: string, title = relPath): KbEntry {
  return {
    id,
    title,
    rootId,
    relPath,
    absPath: `/abs/${relPath}`,
    layer: relPath.startsWith('wiki/') ? 'wiki' : 'note',
    mtimeMs: 0,
    size: 0,
    chunks: 1,
    boost: 1,
  };
}

const roots: KbRoot[] = [
  { id: 'vault', label: 'Vault', path: '/v', isVault: true },
  { id: 'repo', label: 'Repo KB', path: '/r', isVault: false },
];
const entries = [
  entry('wiki/b.md', 'vault', 'wiki/b.md', 'Beta'),
  entry('wiki/a.md', 'vault', 'wiki/a.md', 'Alpha gateway'),
  entry('top.md', 'vault', 'top.md', 'Top'),
  entry('/r/docs/x10.md', 'repo', 'docs/x10.md', 'Ten'),
  entry('/r/docs/x2.md', 'repo', 'docs/x2.md', 'Two'),
  entry('/o/z.md', 'other', '/o/z.md', 'Stray'),
];
const allKinds = new Set<KbLinkKind>(['source', 'related', 'wikilink', 'link', 'cite']);

describe('knowledge tree', () => {
  it('groups entries per root with folders first and natural ordering', () => {
    const tree = buildKbTree(entries, roots);
    expect(tree.map((node) => [node.name, node.count])).toEqual([
      ['Vault', 3],
      ['Repo KB', 2],
      ['Other', 1],
    ]);
    expect(tree[0].children.map((node) => node.name)).toEqual(['wiki', 'top.md']);
    expect(tree[0].children[0].children.map((node) => node.name)).toEqual(['a.md', 'b.md']);
    expect(tree[1].children[0].children.map((node) => node.name)).toEqual(['x2.md', 'x10.md']);
  });

  it('filters to matching files and expands their folders', () => {
    const tree = buildKbTree(entries, roots);
    const byId = new Map(entries.map((e) => [e.id, e]));
    const words = queryWords('GATEWAY alpha');
    const filtered = filterKbTree(tree, (id) => entryMatches(byId.get(id)!, words));
    expect(filtered.matches).toBe(1);
    expect(filtered.nodes).toHaveLength(1);
    expect(filtered.nodes[0].count).toBe(1);
    expect([...filtered.expand]).toEqual(['vault/wiki', 'vault']);
    expect(ancestorKeys(entries[1])).toEqual(['vault', 'vault/wiki']);
  });
});

describe('knowledge graph helpers', () => {
  const edges: KbEdge[] = [
    { from: 'a', to: 'b', kind: 'related' },
    { from: 'b', to: 'c', kind: 'link' },
    { from: 'd', to: 'a', kind: 'wikilink' },
    { from: 'c', to: 'e', kind: 'source' },
  ];
  const adjacency = buildAdjacency(edges);

  it('walks both directions up to the requested depth', () => {
    const one = neighbourhood(adjacency, 'a', 1, allKinds, 50);
    expect(one.nodes.sort()).toEqual(['a', 'b', 'd']);
    expect(one.edges).toHaveLength(2);
    const two = neighbourhood(adjacency, 'a', 2, allKinds, 50);
    expect(two.nodes.sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(two.depthOf.get('c')).toBe(2);
  });

  it('respects link kinds and the node limit', () => {
    const relatedOnly = neighbourhood(adjacency, 'a', 3, new Set<KbLinkKind>(['related']), 50);
    expect(relatedOnly.nodes.sort()).toEqual(['a', 'b']);
    const capped = neighbourhood(adjacency, 'a', 3, allKinds, 2);
    expect(capped.nodes).toHaveLength(2);
    expect(capped.truncated).toBe(true);
  });

  it('ranks hubs by degree within a root', () => {
    const hubEntries = ['a', 'b', 'c', 'd', 'e'].map((id) =>
      entry(id, id === 'e' ? 'repo' : 'vault', `${id}.md`),
    );
    const hubs = hubMap(hubEntries, adjacency, allKinds, 2, 'vault');
    expect(hubs.nodes.sort()).toEqual(['a', 'b']);
    expect(hubs.truncated).toBe(true);
  });

  it('lists outgoing and incoming connections sorted by title', () => {
    expect(connections(adjacency, 'a', 'out', (id) => id)).toEqual([{ id: 'b', kind: 'related' }]);
    expect(connections(adjacency, 'a', 'in', (id) => id)).toEqual([{ id: 'd', kind: 'wikilink' }]);
  });

  it('lays out nodes deterministically inside the canvas', () => {
    const nodes = ['a', 'b', 'c', 'd', 'e'];
    const first = forceLayout(nodes, edges, { width: 400, height: 300, pinned: ['a'] });
    const second = forceLayout(nodes, edges, { width: 400, height: 300, pinned: ['a'] });
    expect([...first.entries()]).toEqual([...second.entries()]);
    for (const point of first.values()) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(400);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(300);
    }
  });
});

function candidate(relevance: number | null): KbCandidate {
  return {
    path: 'p.md',
    realpath: '/p.md',
    heading: 'H',
    excerpt: 'x',
    score: 0.02,
    source: 'both',
    relevance,
  };
}

function run(probs: Array<number | null>, labels: Record<number, boolean>, max = 3): KbEvalRun {
  return {
    id: 'r',
    ranAt: 0,
    query: 'q',
    pool: probs.length,
    max,
    threshold: 0.5,
    candidates: probs.map(candidate),
    labels,
    timings: { searchMs: 50, jevMs: 300, totalMs: 360 },
    jev: { ok: true, error: null, model: 'jev', cost: 0.0001, inputTokens: 1, outputTokens: 1 },
    productionTimeoutMs: 1500,
  };
}

describe('search evaluation', () => {
  it('picks the search top-N and Jev selections at a threshold', () => {
    const r = run([0.2, 0.9, 0.6, 0.4, 0.8], {});
    expect(searchPicks(r)).toEqual([0, 1, 2]);
    expect(jevPicks(r)).toEqual([1, 4, 2]);
    expect(jevPicks(r, 0.7)).toEqual([1, 4]);
    expect(jevPicks(run([null, null], {}))).toEqual([]);
  });

  it('scores precision, capped recall and silence like the bench', () => {
    const runs = [
      run([0.2, 0.9, 0.6, 0.4, 0.8], { 1: true, 4: true, 0: false }),
      run([0.1, 0.2, 0.3], { 0: false }),
    ];
    const search = scorePicks(runs, searchPicks);
    expect(search).toMatchObject({ injected: 6, hits: 1, silentOk: 0, silentCases: 1, cases: 2 });
    expect(search.precision).toBeCloseTo(1 / 6);
    expect(search.recall).toBeCloseTo(1 / 2);

    const jev = scorePicks(runs, (r) => jevPicks(r));
    expect(jev).toMatchObject({ injected: 3, hits: 2, silentOk: 1, silentCases: 1 });
    expect(jev.precision).toBeCloseTo(2 / 3);
    expect(jev.recall).toBe(1);
    expect(jevAgreement(runs, 0.5)).toBe(1);
    expect(scorePicks([], searchPicks).precision).toBeNull();
  });

  it('exports labelled runs in the bench case format', () => {
    const cases = toBenchCases([run([0.9, 0.1], { 0: true, 1: false }), run([0.9], {})]);
    expect(cases).toEqual([
      {
        prompt: 'q',
        hits: [
          { path: 'p.md', realpath: '/p.md', heading: 'H', excerpt: 'x' },
          { path: 'p.md', realpath: '/p.md', heading: 'H', excerpt: 'x' },
        ],
        relevant: [0],
      },
    ]);
  });
});
