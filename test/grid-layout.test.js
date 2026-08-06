const test = require('node:test');
const assert = require('node:assert/strict');

const {
  HIDDEN_TERMINAL_BUFFER_CHARS,
  HIDDEN_TERMINAL_FLUSH_MS,
  MAX_ACTIVE_WEBGL_RENDERERS,
  MAX_GRID_ROWS,
  calculateGridColumnCount,
  normalizeSpan,
  applyLayout,
  rekeyLayoutEntry,
  reorder,
  selectTerminalRendererIds,
  terminalFlushDelay,
} = require('../public/grid-layout');

test('calculateGridColumnCount still derives sane column counts', () => {
  assert.equal(calculateGridColumnCount({ width: 1400, cardCount: 6 }), 2);
  assert.equal(calculateGridColumnCount({ width: 900, cardCount: 6 }), 1);
  assert.equal(calculateGridColumnCount({ width: 1920, cardCount: 6 }), 3);
  assert.equal(calculateGridColumnCount({ width: 1920, cardCount: 2 }), 2);
});

test('normalizeSpan clamps cols to [1, maxCols]', () => {
  assert.deepEqual(normalizeSpan({ cols: 3, rows: 1 }, 2), { cols: 2, rows: 1 });
  assert.deepEqual(normalizeSpan({ cols: 0, rows: 1 }, 4), { cols: 1, rows: 1 });
  assert.deepEqual(normalizeSpan({ cols: -5, rows: 1 }, 4), { cols: 1, rows: 1 });
  assert.deepEqual(normalizeSpan({ cols: 2, rows: 1 }, 4), { cols: 2, rows: 1 });
});

test('normalizeSpan clamps rows to [1, MAX_GRID_ROWS]', () => {
  assert.equal(normalizeSpan({ cols: 1, rows: MAX_GRID_ROWS + 5 }, 4).rows, MAX_GRID_ROWS);
  assert.equal(normalizeSpan({ cols: 1, rows: 0 }, 4).rows, 1);
});

test('normalizeSpan defaults missing/garbage values to 1', () => {
  assert.deepEqual(normalizeSpan(undefined, 4), { cols: 1, rows: 1 });
  assert.deepEqual(normalizeSpan({}, 4), { cols: 1, rows: 1 });
  assert.deepEqual(normalizeSpan({ cols: 'x', rows: null }, 4), { cols: 1, rows: 1 });
});

test('applyLayout returns 1x1 spans and input order when no layout stored', () => {
  const result = applyLayout(['a', 'b', 'c'], {}, 3);
  assert.deepEqual(result, [
    { sessionId: 'a', order: 0, colSpan: 1, rowSpan: 1 },
    { sessionId: 'b', order: 1, colSpan: 1, rowSpan: 1 },
    { sessionId: 'c', order: 2, colSpan: 1, rowSpan: 1 },
  ]);
});

test('applyLayout clamps persisted spans against fewer available columns', () => {
  const layout = {
    a: { order: 0, colSpan: 3, rowSpan: 2 },
    b: { order: 1, colSpan: 2, rowSpan: 1 },
  };
  const result = applyLayout(['a', 'b'], layout, 2);
  assert.equal(result[0].colSpan, 2); // clamped from 3 to maxCols=2
  assert.equal(result[0].rowSpan, 2);
  assert.equal(result[1].colSpan, 2);
});

test('rekeyLayoutEntry preserves a session layout across an ID handover', () => {
  const layout = {
    temporary: { order: 4, colSpan: 2, rowSpan: 3 },
    other: { order: 1, colSpan: 1, rowSpan: 1 },
  };

  assert.equal(rekeyLayoutEntry(layout, 'temporary', 'real'), true);
  assert.equal(layout.temporary, undefined);
  assert.deepEqual(layout.real, { order: 4, colSpan: 2, rowSpan: 3 });
  assert.deepEqual(
    applyLayout(['real', 'other'], layout, 2).map((entry) => entry.sessionId),
    ['other', 'real'],
  );
});

test('rekeyLayoutEntry ignores missing or unchanged IDs', () => {
  const layout = { existing: { order: 0, colSpan: 1, rowSpan: 1 } };
  assert.equal(rekeyLayoutEntry(layout, 'missing', 'real'), false);
  assert.equal(rekeyLayoutEntry(layout, 'existing', 'existing'), false);
  assert.deepEqual(layout, { existing: { order: 0, colSpan: 1, rowSpan: 1 } });
});

test('applyLayout sorts by persisted order and preserves it', () => {
  const layout = {
    a: { order: 2 },
    b: { order: 0 },
    c: { order: 1 },
  };
  const result = applyLayout(['a', 'b', 'c'], layout, 3);
  assert.deepEqual(
    result.map((r) => r.sessionId),
    ['b', 'c', 'a'],
  );
  assert.deepEqual(
    result.map((r) => r.order),
    [0, 1, 2],
  );
});

test('applyLayout falls back to input order for sessions without persisted order', () => {
  const layout = { c: { order: 5 } };
  const result = applyLayout(['a', 'b', 'c'], layout, 3);
  // a/b use their input index (0/1); c's persisted order (5) sorts it last.
  assert.deepEqual(
    result.map((r) => r.sessionId),
    ['a', 'b', 'c'],
  );

  // A small persisted order pulls a session ahead of unpinned ones.
  const layout2 = { c: { order: -1 } };
  const result2 = applyLayout(['a', 'b', 'c'], layout2, 3);
  assert.deepEqual(
    result2.map((r) => r.sessionId),
    ['c', 'a', 'b'],
  );
});

test('reorder moves an id before its target', () => {
  assert.deepEqual(reorder(['a', 'b', 'c', 'd'], 'd', 'b'), ['a', 'd', 'b', 'c']);
  assert.deepEqual(reorder(['a', 'b', 'c'], 'a', 'c'), ['b', 'a', 'c']);
});

test('reorder is a no-op for unknown ids or identical ids', () => {
  assert.deepEqual(reorder(['a', 'b', 'c'], 'x', 'b'), ['a', 'b', 'c']);
  assert.deepEqual(reorder(['a', 'b', 'c'], 'a', 'z'), ['a', 'b', 'c']);
  assert.deepEqual(reorder(['a', 'b', 'c'], 'b', 'b'), ['a', 'b', 'c']);
});

test('reorder does not mutate the input array', () => {
  const input = ['a', 'b', 'c'];
  const out = reorder(input, 'c', 'a');
  assert.deepEqual(input, ['a', 'b', 'c']);
  assert.deepEqual(out, ['c', 'a', 'b']);
});

test('selectTerminalRendererIds enforces the WebGL budget and visibility', () => {
  const candidates = Array.from({ length: 8 }, (_, index) => ({
    id: `session-${index}`,
    visible: index < 6,
    focused: index === 5,
    lastVisibleAt: index,
  }));

  const selected = selectTerminalRendererIds(candidates);
  assert.equal(MAX_ACTIVE_WEBGL_RENDERERS, 4);
  assert.equal(selected.length, MAX_ACTIVE_WEBGL_RENDERERS);
  assert.equal(selected[0], 'session-5', 'focused terminal should get the first renderer');
  assert.ok(!selected.includes('session-6'), 'offscreen terminals should not consume WebGL');
  assert.ok(!selected.includes('session-7'), 'offscreen terminals should not consume WebGL');
});

test('selectTerminalRendererIds is deterministic when recency ties', () => {
  const candidates = [
    { id: 'first', visible: true },
    { id: 'second', visible: true },
    { id: 'third', visible: true },
  ];
  assert.deepEqual(selectTerminalRendererIds(candidates, 2), ['first', 'second']);
});

test('terminalFlushDelay batches offscreen writes within bounded budgets', () => {
  assert.equal(HIDDEN_TERMINAL_FLUSH_MS, 50);
  assert.equal(terminalFlushDelay({ visible: false, pendingChars: 20 }), 50);
  assert.equal(terminalFlushDelay({ visible: true, pendingChars: 20 }), 0);
  assert.equal(terminalFlushDelay({ focused: true, pendingChars: 20 }), 0);
  assert.equal(
    terminalFlushDelay({
      visible: false,
      pendingChars: HIDDEN_TERMINAL_BUFFER_CHARS,
    }),
    0,
    'large hidden buffers should flush promptly',
  );
});
