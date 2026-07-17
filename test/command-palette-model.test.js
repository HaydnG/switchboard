const test = require('node:test');
const assert = require('node:assert/strict');

const {
  fuzzyScore,
  buildPaletteItems,
  rankPaletteItems,
} = require('../public/command-palette-model');

test('fuzzyScore matches an in-order subsequence and rejects out-of-order/missing chars', () => {
  assert.ok(fuzzyScore('abc', 'aXbXc') > 0);
  assert.equal(fuzzyScore('xyz', 'abc'), 0);
  assert.equal(fuzzyScore('cba', 'abc'), 0);
  assert.equal(fuzzyScore('', 'abc'), 0);
  assert.equal(fuzzyScore('abc', ''), 0);
});

test('fuzzyScore is case-insensitive', () => {
  assert.equal(fuzzyScore('GRID', 'toggle grid view'), fuzzyScore('grid', 'Toggle Grid View'));
});

test('fuzzyScore rewards consecutive runs and word-start matches over scattered ones', () => {
  const consecutiveWordStart = fuzzyScore('grid', 'Toggle grid view');
  const scattered = fuzzyScore('grid', 'Great riddle');
  assert.ok(consecutiveWordStart > scattered);
});

test('fuzzyScore ranks an exact substring above an equally-long scattered match', () => {
  const substring = fuzzyScore('cat', 'Categories');
  const scattered = fuzzyScore('cat', 'Close all tabs');
  assert.ok(substring > scattered);
});

test('fuzzyScore prefers shorter text on an otherwise equal match', () => {
  const short = fuzzyScore('session', 'Session');
  const long = fuzzyScore('session', 'Session Two');
  assert.ok(short > long);
});

test('buildPaletteItems shapes session items with a truncated subtitle path and keywords', () => {
  const items = buildPaletteItems({
    sessions: [
      {
        sessionId: 's1',
        name: 'Fix flaky test',
        projectPath: '/Users/dev/code/switchboard/apps/web',
        status: 'running',
        runtime: 'claude',
      },
    ],
  });

  assert.equal(items.length, 1);
  assert.deepEqual(items[0], {
    id: 's1',
    kind: 'session',
    title: 'Fix flaky test',
    subtitle: 'apps/web',
    groupColor: '',
    statusLabel: '',
    statusKey: 'running',
    keywords: ['running', 'claude', 'apps', 'web'],
    data: {
      sessionId: 's1',
      name: 'Fix flaky test',
      projectPath: '/Users/dev/code/switchboard/apps/web',
      status: 'running',
      runtime: 'claude',
    },
  });
});

test('buildPaletteItems includes group name in session subtitle and keywords', () => {
  const items = buildPaletteItems({
    sessions: [
      {
        sessionId: 's1',
        name: 'Fix flaky test',
        projectPath: '/Users/dev/code/switchboard/apps/web',
        status: 'running',
        runtime: 'claude',
        groupName: 'Checkout',
        groupColor: '#3ecf5a',
      },
    ],
  });

  assert.equal(items[0].subtitle, 'Checkout · apps/web');
  assert.equal(items[0].groupColor, '#3ecf5a');
  assert.equal(items[0].statusKey, 'running');
  assert.deepEqual(items[0].keywords, ['running', 'claude', 'Checkout', 'apps', 'web']);
});

test('buildPaletteItems preserves a supplied session status label', () => {
  const [item] = buildPaletteItems({
    sessions: [{
      sessionId: 's1',
      name: 'Run tests',
      projectPath: '/repo',
      status: 'running',
      statusLabel: 'Running',
    }],
  });

  assert.equal(item.statusKey, 'running');
  assert.equal(item.statusLabel, 'Running');
});

test('buildPaletteItems keeps every segment when projectPath has fewer than two', () => {
  const items = buildPaletteItems({
    sessions: [
      { sessionId: 's2', name: 'Solo', projectPath: '/repo', status: 'idle', runtime: undefined },
    ],
  });

  assert.equal(items[0].subtitle, 'repo');
  assert.deepEqual(items[0].keywords, ['idle', 'repo']);
});

test('buildPaletteItems shapes group items', () => {
  const items = buildPaletteItems({
    groups: [{ id: 'g1', name: 'Checkout', color: '#3ecf5a', sessionCount: 3 }],
  });

  assert.deepEqual(items, [
    {
      id: 'g1',
      kind: 'group',
      title: 'Checkout',
      subtitle: '3 sessions',
      groupColor: '#3ecf5a',
      keywords: ['Checkout'],
      data: { id: 'g1', name: 'Checkout', color: '#3ecf5a', sessionCount: 3 },
    },
  ]);
});

test('buildPaletteItems shapes project items', () => {
  const items = buildPaletteItems({
    projects: [{ path: '/Users/dev/code/switchboard', name: 'switchboard' }],
  });

  assert.deepEqual(items, [
    {
      id: '/Users/dev/code/switchboard',
      kind: 'project',
      title: 'switchboard',
      subtitle: '/Users/dev/code/switchboard',
      keywords: ['/Users/dev/code/switchboard'],
      data: { path: '/Users/dev/code/switchboard', name: 'switchboard' },
    },
  ]);
});

test('buildPaletteItems shapes action items with caller-supplied keywords and no subtitle', () => {
  const items = buildPaletteItems({
    actions: [
      { id: 'toggle-overview', title: 'Toggle session overview', keywords: ['grid', 'view'] },
    ],
  });

  assert.deepEqual(items, [
    {
      id: 'toggle-overview',
      kind: 'action',
      title: 'Toggle session overview',
      subtitle: '',
      keywords: ['grid', 'view'],
      data: { id: 'toggle-overview', title: 'Toggle session overview', keywords: ['grid', 'view'] },
    },
  ]);
});

test('buildPaletteItems concatenates all four kinds in order and tolerates missing lists', () => {
  const items = buildPaletteItems({
    sessions: [{ sessionId: 's1', name: 'S', projectPath: '/a/b', status: 'idle' }],
    groups: [{ id: 'g1', name: 'G', color: '#8088ff', sessionCount: 1 }],
    actions: [{ id: 'a1', title: 'A', keywords: [] }],
  });

  assert.deepEqual(items.map((item) => item.kind), ['session', 'group', 'action']);
  assert.deepEqual(buildPaletteItems({}), []);
});

test('rankPaletteItems on an empty/whitespace query passes through the first `limit` items unscored', () => {
  const items = [
    { id: '1', kind: 'session', title: 'Recent A', keywords: [] },
    { id: '2', kind: 'session', title: 'Recent B', keywords: [] },
    { id: '3', kind: 'session', title: 'Recent C', keywords: [] },
  ];

  assert.deepEqual(rankPaletteItems('', items, { limit: 2 }), items.slice(0, 2));
  assert.deepEqual(rankPaletteItems('   ', items), items);
});

test('rankPaletteItems scores title matches above keyword-only matches for the same text', () => {
  const items = [
    { id: 'keyword-hit', kind: 'action', title: 'Other action', keywords: ['pipeline'] },
    { id: 'title-hit', kind: 'action', title: 'pipeline', keywords: [] },
  ];

  const ranked = rankPaletteItems('pipeline', items);

  assert.deepEqual(ranked.map((item) => item.id), ['title-hit', 'keyword-hit']);
});

test('rankPaletteItems also matches against subtitle at the keyword weight', () => {
  const items = [
    { id: 'subtitle-hit', kind: 'session', title: 'Unrelated', subtitle: 'switchboard', keywords: [] },
  ];

  assert.equal(rankPaletteItems('switchboard', items).length, 1);
});

test('rankPaletteItems drops items with no match at all', () => {
  const items = [
    { id: '1', kind: 'action', title: 'Deploy', keywords: [] },
    { id: '2', kind: 'action', title: 'Rollback', keywords: ['zzz'] },
  ];

  assert.deepEqual(rankPaletteItems('deploy', items).map((item) => item.id), ['1']);
});

test('rankPaletteItems keeps input order for tied scores (stable sort)', () => {
  const items = [
    { id: 'a', kind: 'action', title: 'Widget', keywords: [] },
    { id: 'b', kind: 'action', title: 'Widget', keywords: [] },
    { id: 'c', kind: 'action', title: 'Widget', keywords: [] },
  ];

  assert.deepEqual(rankPaletteItems('widget', items).map((item) => item.id), ['a', 'b', 'c']);
});

test('rankPaletteItems matches group names from keywords', () => {
  const items = [
    { id: 'g1', kind: 'group', title: 'Checkout', subtitle: '2 sessions', keywords: ['Checkout'] },
    { id: 's1', kind: 'session', title: 'Unrelated', subtitle: 'apps/web', keywords: [] },
  ];

  assert.deepEqual(rankPaletteItems('checkout', items).map((item) => item.id), ['g1']);
});

test('rankPaletteItems respects the limit option', () => {
  const items = [
    { id: '1', kind: 'action', title: 'grid one', keywords: [] },
    { id: '2', kind: 'action', title: 'grid two', keywords: [] },
    { id: '3', kind: 'action', title: 'grid three', keywords: [] },
  ];

  assert.equal(rankPaletteItems('grid', items, { limit: 2 }).length, 2);
});
