const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeSearchFilters,
  parseFtsSnippet,
  buildUnifiedSearchItems,
  interleaveUnifiedSearchItems,
  applyUnifiedSearchFilters,
  deserializeSavedSearches,
  upsertSavedSearch,
  getSessionCommandDescriptors,
} = require('../public/unified-search-model');

test('parseFtsSnippet preserves context and isolates trusted highlight markers', () => {
  assert.deepEqual(parseFtsSnippet('...fixed <mark>search</mark> & <script>alert(1)</script>...'), [
    { text: '...fixed ', highlighted: false },
    { text: 'search', highlighted: true },
    { text: ' & <script>alert(1)</script>...', highlighted: false },
  ]);
  assert.deepEqual(parseFtsSnippet(null), []);
});

test('buildUnifiedSearchItems joins FTS snippets to all supported result kinds', () => {
  const items = buildUnifiedSearchItems({
    sessions: [
      {
        sessionId: 's1',
        name: 'Search work',
        subtitle: 'apps/web',
        status: 'busy',
        starred: 1,
      },
      { sessionId: 's2', name: 'Not matched' },
    ],
    plans: [{ filename: 'launch.md', title: 'Launch plan' }],
    memories: [{ filePath: '/repo/CLAUDE.md', filename: 'CLAUDE.md', displayPath: 'repo/' }],
    results: {
      session: [{ id: 's1', snippet: 'context <mark>search</mark>' }],
      plan: [{ id: 'launch.md', snippet: 'plan <mark>step</mark>' }],
      memory: [{ id: '/repo/CLAUDE.md', snippet: '<mark>Rule</mark> text' }],
    },
  });

  assert.deepEqual(
    items.map((item) => [item.kind, item.id, item.snippet]),
    [
      ['session', 's1', 'context <mark>search</mark>'],
      ['plan', 'launch.md', 'plan <mark>step</mark>'],
      ['memory', '/repo/CLAUDE.md', '<mark>Rule</mark> text'],
    ],
  );
  assert.equal(items[0].starred, true);
});

test('unified results preserve per-type FTS rank and interleave result kinds', () => {
  const items = buildUnifiedSearchItems({
    sessions: [
      { sessionId: 's1', name: 'First metadata session' },
      { sessionId: 's2', name: 'Second metadata session' },
    ],
    plans: [{ filename: 'p1.md', title: 'Plan' }],
    memories: [{ filePath: '/memory.md', filename: 'memory.md' }],
    results: {
      session: [{ id: 's2' }, { id: 's1' }],
      plan: [{ id: 'p1.md' }],
      memory: [{ id: '/memory.md' }],
    },
  });

  assert.deepEqual(
    items.filter((item) => item.kind === 'session').map((item) => item.id),
    ['s2', 's1'],
  );
  assert.deepEqual(
    interleaveUnifiedSearchItems(items).map((item) => item.id),
    ['s2', 'p1.md', '/memory.md', 's1'],
  );
});

test('applyUnifiedSearchFilters composes kind and session smart filters', () => {
  const now = new Date('2026-07-27T12:00:00Z');
  const items = [
    {
      id: 's1',
      kind: 'session',
      statusKey: 'busy',
      starred: true,
      modified: '2026-07-27T08:00:00Z',
    },
    {
      id: 's2',
      kind: 'session',
      statusKey: 'needs-attention',
      starred: true,
      modified: '2026-07-27T09:00:00Z',
    },
    { id: 'p1', kind: 'plan' },
  ];

  assert.deepEqual(
    applyUnifiedSearchFilters(
      items,
      { kinds: ['session'], smart: ['starred', 'today'] },
      { now },
    ).map((item) => item.id),
    ['s1', 's2'],
  );
  assert.deepEqual(
    applyUnifiedSearchFilters(items, {
      kinds: ['session', 'plan'],
      smart: ['attention'],
    }).map((item) => item.id),
    ['s2'],
  );
});

test('search filter normalization rejects unknown values and restores kind defaults', () => {
  assert.deepEqual(normalizeSearchFilters({ kinds: ['wat', 'session'], smart: ['today', 'wat'] }), {
    kinds: ['session'],
    smart: ['today'],
  });
  assert.deepEqual(normalizeSearchFilters({ kinds: [], smart: [] }), {
    kinds: ['session', 'plan', 'memory'],
    smart: [],
  });
});

test('saved searches recover from malformed storage and update by stable id', () => {
  assert.deepEqual(deserializeSavedSearches('{oops'), []);
  const first = upsertSavedSearch([], {
    id: 'daily',
    label: 'Daily',
    query: 'checkout',
    filters: { kinds: ['session'], smart: ['today'] },
  });
  const updated = upsertSavedSearch(first, {
    id: 'daily',
    label: 'Daily attention',
    query: 'checkout',
    filters: { kinds: ['session'], smart: ['attention'] },
    titleOnly: true,
  });

  assert.equal(updated.length, 1);
  assert.equal(updated[0].label, 'Daily attention');
  assert.deepEqual(updated[0].filters.smart, ['attention']);
  assert.equal(updated[0].titleOnly, true);
});

test('session command descriptors include only supported deep actions', () => {
  const commands = getSessionCommandDescriptors(
    { sessionId: 's1' },
    { canFork: true, canHandoff: false, canTransfer: true, canQueue: true },
  );

  assert.deepEqual(
    commands.map((item) => item.command),
    ['open', 'timeline', 'messages', 'annotate', 'fork', 'transfer', 'queue'],
  );
  assert.ok(commands.every((item) => item.kind === 'session-action'));
});
