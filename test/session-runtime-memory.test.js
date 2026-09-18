const test = require('node:test');
const assert = require('node:assert/strict');

const {
  GRID_SCROLLBACK_LINES,
  SINGLE_SCROLLBACK_LINES,
  CLOSED_TERMINAL_GRACE_MS,
  terminalScrollbackLines,
  shouldReclaimClosedTerminal,
  collectLiveSessionIds,
  pruneSessionMap,
  forgetKeyedSessionState,
  pruneKeyedSessionStores,
  projectsExcludingArchivedSessions,
} = require('../public/session-runtime-memory');

test('terminalScrollbackLines uses a smaller cap in grid mode', () => {
  assert.equal(terminalScrollbackLines(true), GRID_SCROLLBACK_LINES);
  assert.equal(terminalScrollbackLines(false), SINGLE_SCROLLBACK_LINES);
  assert.ok(GRID_SCROLLBACK_LINES < 10000);
  assert.ok(GRID_SCROLLBACK_LINES <= SINGLE_SCROLLBACK_LINES);
});

test('shouldReclaimClosedTerminal keeps a focused or freshly visible banner', () => {
  const now = 100_000;
  assert.equal(shouldReclaimClosedTerminal({ closed: false, now }), false);
  assert.equal(shouldReclaimClosedTerminal({
    closed: true, focused: true, visible: true, exitedAt: now - 60_000, now,
  }), false);
  assert.equal(shouldReclaimClosedTerminal({
    closed: true, focused: false, visible: true, exitedAt: now - 1000, now,
    graceMs: CLOSED_TERMINAL_GRACE_MS,
  }), false);
  assert.equal(shouldReclaimClosedTerminal({
    closed: true, focused: false, visible: true, exitedAt: now - CLOSED_TERMINAL_GRACE_MS, now,
  }), true);
  assert.equal(shouldReclaimClosedTerminal({
    closed: true, focused: false, visible: false, exitedAt: now, now,
  }), true);
  assert.equal(shouldReclaimClosedTerminal({
    closed: true, focused: false, exitedAt: now, now,
  }), false);
});

test('pruneSessionMap drops ids that are no longer in the live set', () => {
  const sessionMap = new Map([
    ['keep', { sessionId: 'keep' }],
    ['gone', { sessionId: 'gone' }],
  ]);
  const live = collectLiveSessionIds([
    [{ sessions: [{ sessionId: 'keep' }] }],
  ], ['pending']);
  live.add('pending');
  assert.equal(pruneSessionMap(sessionMap, live), 1);
  assert.deepEqual([...sessionMap.keys()], ['keep']);
});

test('forgetKeyedSessionState and pruneKeyedSessionStores clear stale maps', () => {
  const timeline = new Map([['a', [1]], ['b', [2]]]);
  const activity = new Map([['a', 1], ['c', 3]]);
  forgetKeyedSessionState('a', [timeline, activity]);
  assert.equal(timeline.has('a'), false);
  assert.equal(activity.has('a'), false);
  assert.equal(pruneKeyedSessionStores(new Set(['b']), [timeline, activity]), 1);
  assert.deepEqual([...timeline.keys()], ['b']);
  assert.equal(activity.size, 0);
});

test('projectsExcludingArchivedSessions keeps unarchived rows without mutating the source', () => {
  const source = [{
    projectPath: '/app',
    sessions: [
      { sessionId: 'live', archived: 0 },
      { sessionId: 'old', archived: 1 },
    ],
  }];
  const filtered = projectsExcludingArchivedSessions(source);
  assert.deepEqual(filtered[0].sessions.map((s) => s.sessionId), ['live']);
  assert.equal(source[0].sessions.length, 2);
});
