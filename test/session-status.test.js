const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getAgentTaskFromTitle,
  getCliBusySignalFromTitle,
  getAgentTaskFromTerminalData,
  shouldEndTaskFallbackActivity,
  shouldResumeCompletedSession,
  getSessionStatus,
  isStaleOpenSession,
  getAttentionInboxItems,
  getNextAttentionInboxItem,
  getStatusCounts,
  getFilteredSessionsByStatus,
  getGridAutoOpenSessionIds,
  getSessionsToLaunch,
} = require('../public/session-status');

function state(overrides = {}) {
  return {
    activePtyIds: new Set(),
    attentionSessions: new Set(),
    responseReadySessions: new Set(),
    sessionBusyState: new Map(),
    openSessions: new Map(),
    lastActivityTime: new Map(),
    inboxArrivalTime: new Map(),
    activeSessionId: null,
    ...overrides,
  };
}

test('extracts the active Claude task from a spinner title', () => {
  assert.equal(
    getAgentTaskFromTitle('⠸ Add CORS field to admin config ⟦esc⟧   '),
    'Add CORS field to admin config',
  );
  assert.equal(getAgentTaskFromTitle('⠹ Check test failures'), 'Check test failures');
});

test('does not expose non-Claude terminal titles as agent tasks', () => {
  assert.equal(getAgentTaskFromTitle('zsh — switchboard'), '');
  assert.equal(getAgentTaskFromTitle('✳ Ready for input'), '');
  assert.equal(getAgentTaskFromTitle(''), '');
});

test('CLI title signals clear a busy state when the spinner is replaced', () => {
  assert.equal(getCliBusySignalFromTitle('⠸ Add CORS field ⟦esc⟧', false), true);
  assert.equal(getCliBusySignalFromTitle('✳ Ready for input', true), false);
  assert.equal(getCliBusySignalFromTitle('Claude Code', true), false);
  assert.equal(getCliBusySignalFromTitle('', true), false);
  assert.equal(getCliBusySignalFromTitle('zsh — switchboard', false), null);
});

test('extracts an OMP task from terminal UI output', () => {
  const output = '\x1b[2K\r\x1b[38;5;245m⠸\x1b[0m Add CORS field to admin config \x1b[2m⟦esc⟧\x1b[0m';
  assert.equal(getAgentTaskFromTerminalData(output), 'Add CORS field to admin config');
});

test('ignores terminal output without an OMP task line', () => {
  assert.equal(getAgentTaskFromTerminalData('Compiling application…'), '');
  assert.equal(getAgentTaskFromTerminalData('\x1b]0;zsh\x07'), '');
});

test('task fallback only ends activity without an authoritative busy signal', () => {
  assert.equal(shouldEndTaskFallbackActivity(true), false);
  assert.equal(shouldEndTaskFallbackActivity(false), true);
  assert.equal(shouldEndTaskFallbackActivity(undefined), true);
});

test('completed sessions only resume automatically for a genuinely new task', () => {
  assert.equal(shouldResumeCompletedSession('Run tests', 'Run tests'), false);
  assert.equal(shouldResumeCompletedSession('', 'Run tests'), false);
  assert.equal(shouldResumeCompletedSession('Run tests', ''), false);
  assert.equal(shouldResumeCompletedSession('Run tests', 'Fix failures'), true);
});

test('session status prioritizes needs-attention over other states', () => {
  const session = { sessionId: 's1', modified: '2026-06-12T10:00:00.000Z' };
  const result = getSessionStatus(session, state({
    activePtyIds: new Set(['s1']),
    attentionSessions: new Set(['s1']),
    responseReadySessions: new Set(['s1']),
    sessionBusyState: new Map([['s1', true]]),
  }));

  assert.equal(result.key, 'needs-attention');
  assert.equal(result.label, 'Needs You');
  assert.equal(result.priority, 100);
  assert.equal(result.inInbox, true);
});

test('session status reports unread ready output before running and idle', () => {
  const session = { sessionId: 's1', modified: '2026-06-12T10:00:00.000Z' };
  const result = getSessionStatus(session, state({
    activePtyIds: new Set(['s1']),
    responseReadySessions: new Set(['s1']),
  }));

  assert.equal(result.key, 'response-ready');
  assert.equal(result.label, 'Ready');
  assert.equal(result.priority, 90);
  assert.equal(result.inInbox, true);
});

test('session status distinguishes busy, running, exited, and idle', () => {
  const busy = { sessionId: 'busy', modified: '2026-06-12T10:00:00.000Z' };
  const running = { sessionId: 'running', modified: '2026-06-12T10:00:00.000Z' };
  const exited = { sessionId: 'exited', modified: '2026-06-12T10:00:00.000Z' };
  const idle = { sessionId: 'idle', modified: '2026-06-12T10:00:00.000Z' };
  const runtime = state({
    activePtyIds: new Set(['busy', 'running']),
    sessionBusyState: new Map([['busy', true]]),
    openSessions: new Map([['exited', { closed: true }]]),
  });

  assert.equal(getSessionStatus(busy, runtime).key, 'busy');
  assert.equal(getSessionStatus(running, runtime).key, 'running');
  assert.equal(getSessionStatus(busy, runtime).label, 'Working');
  assert.equal(getSessionStatus(running, runtime).label, 'Open');
  assert.equal(getSessionStatus(exited, runtime).key, 'exited');
  assert.equal(getSessionStatus(idle, runtime).key, 'idle');
});

test('stale-open detection requires an open session inactive for over two days', () => {
  const now = Date.parse('2026-08-05T12:00:00.000Z');
  const openRuntime = state({ activePtyIds: new Set(['open']) });

  assert.equal(isStaleOpenSession(
    { sessionId: 'open', modified: '2026-08-02T11:59:59.000Z' },
    openRuntime,
    { now },
  ), true);
  assert.equal(isStaleOpenSession(
    { sessionId: 'open', modified: '2026-08-03T12:00:00.000Z' },
    openRuntime,
    { now },
  ), false);
  assert.equal(isStaleOpenSession(
    { sessionId: 'open', modified: '2026-08-04T12:00:00.000Z' },
    openRuntime,
    { now },
  ), false);
});

test('stale-open detection includes stuck working sessions and excludes stopped sessions', () => {
  const now = Date.parse('2026-08-05T12:00:00.000Z');
  const session = { sessionId: 'session', modified: '2026-08-01T12:00:00.000Z' };

  assert.equal(isStaleOpenSession(session, state({
    activePtyIds: new Set(['session']),
    sessionBusyState: new Map([['session', true]]),
  }), { now }), true);
  assert.equal(isStaleOpenSession(session, state(), { now }), false);
});

test('recent runtime activity prevents an open session being marked stale', () => {
  const now = Date.parse('2026-08-05T12:00:00.000Z');
  const session = { sessionId: 'open', modified: '2026-07-01T12:00:00.000Z' };
  const runtime = state({
    activePtyIds: new Set(['open']),
    lastActivityTime: new Map([['open', new Date('2026-08-05T11:00:00.000Z')]]),
  });

  assert.equal(isStaleOpenSession(session, runtime, { now }), false);
});

test('attention inbox puts actionable sessions first and orders each lane by activity', () => {
  const sessions = [
    { sessionId: 'running-old', modified: '2026-06-12T09:00:00.000Z', summary: 'old run' },
    { sessionId: 'ready', modified: '2026-06-12T10:00:00.000Z', summary: 'ready' },
    { sessionId: 'attention', modified: '2026-06-12T08:00:00.000Z', summary: 'blocked' },
    { sessionId: 'idle', modified: '2026-06-12T11:00:00.000Z', summary: 'idle' },
  ];
  const result = getAttentionInboxItems(sessions, state({
    activePtyIds: new Set(['running-old']),
    responseReadySessions: new Set(['ready']),
    attentionSessions: new Set(['attention']),
  }));

  assert.deepEqual(result.map(item => item.session.sessionId), ['ready', 'attention', 'running-old']);
});

test('attention inbox keeps actionable sessions ordered by arrival, not terminal activity', () => {
  const sessions = [
    { sessionId: 'first', modified: '2026-06-12T09:00:00.000Z' },
    { sessionId: 'second', modified: '2026-06-12T10:00:00.000Z' },
  ];
  const result = getAttentionInboxItems(sessions, state({
    attentionSessions: new Set(['first', 'second']),
    // `first` emitted more output later, but it should not displace the newer
    // actionable card that arrived after it.
    lastActivityTime: new Map([
      ['first', new Date('2026-06-12T12:00:00.000Z')],
      ['second', new Date('2026-06-12T11:00:00.000Z')],
    ]),
    inboxArrivalTime: new Map([
      ['first', Date.parse('2026-06-12T10:30:00.000Z')],
      ['second', Date.parse('2026-06-12T11:30:00.000Z')],
    ]),
  }));

  assert.deepEqual(result.map(item => item.session.sessionId), ['second', 'first']);
});

test('working and open status changes do not reshuffle the active lane', () => {
  const sessions = [
    { sessionId: 'older', modified: '2026-06-12T09:00:00.000Z' },
    { sessionId: 'newer', modified: '2026-06-12T10:00:00.000Z' },
  ];
  const runtime = state({
    activePtyIds: new Set(['older', 'newer']),
    sessionBusyState: new Map([['older', true]]),
    inboxArrivalTime: new Map([
      ['older', Date.parse('2026-06-12T10:00:00.000Z')],
      ['newer', Date.parse('2026-06-12T11:00:00.000Z')],
    ]),
  });

  assert.deepEqual(
    getAttentionInboxItems(sessions, runtime).map(item => item.session.sessionId),
    ['newer', 'older'],
  );
  runtime.sessionBusyState = new Map([['newer', true]]);
  assert.deepEqual(
    getAttentionInboxItems(sessions, runtime).map(item => item.session.sessionId),
    ['newer', 'older'],
  );
});

test('next attention inbox item cycles after the current session', () => {
  const sessions = [
    { sessionId: 'running-old', modified: '2026-06-12T09:00:00.000Z', summary: 'old run' },
    { sessionId: 'ready', modified: '2026-06-12T10:00:00.000Z', summary: 'ready' },
    { sessionId: 'attention', modified: '2026-06-12T08:00:00.000Z', summary: 'blocked' },
  ];
  const runtime = state({
    activePtyIds: new Set(['running-old']),
    responseReadySessions: new Set(['ready']),
    attentionSessions: new Set(['attention']),
  });

  assert.equal(getNextAttentionInboxItem(sessions, runtime, null).session.sessionId, 'ready');
  assert.equal(getNextAttentionInboxItem(sessions, runtime, 'ready').session.sessionId, 'attention');
  assert.equal(getNextAttentionInboxItem(sessions, runtime, 'running-old').session.sessionId, 'ready');
});

test('next attention inbox item returns null when inbox is empty', () => {
  const sessions = [
    { sessionId: 'idle', modified: '2026-06-12T09:00:00.000Z', summary: 'idle' },
  ];

  assert.equal(getNextAttentionInboxItem(sessions, state(), 'idle'), null);
});

test('status counts group busy and running sessions under active', () => {
  const sessions = [
    { sessionId: 'attention', modified: '2026-06-12T08:00:00.000Z' },
    { sessionId: 'ready', modified: '2026-06-12T09:00:00.000Z' },
    { sessionId: 'busy', modified: '2026-06-12T10:00:00.000Z' },
    { sessionId: 'running', modified: '2026-06-12T11:00:00.000Z' },
    { sessionId: 'idle', modified: '2026-06-12T12:00:00.000Z' },
  ];
  const counts = getStatusCounts(sessions, state({
    attentionSessions: new Set(['attention']),
    responseReadySessions: new Set(['ready']),
    activePtyIds: new Set(['busy', 'running']),
    sessionBusyState: new Map([['busy', true]]),
    lastActivityTime: new Map([
      ['busy', new Date()],
      ['running', new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)],
    ]),
  }));

  assert.deepEqual(counts, {
    all: 5,
    attention: 1,
    ready: 1,
    active: 2,
    staleOpen: 1,
  });
});

test('status filters return sessions matching the requested grid mode', () => {
  const sessions = [
    { sessionId: 'attention', modified: '2026-06-12T08:00:00.000Z' },
    { sessionId: 'ready', modified: '2026-06-12T09:00:00.000Z' },
    { sessionId: 'busy', modified: '2026-06-12T10:00:00.000Z' },
    { sessionId: 'running', modified: '2026-06-12T11:00:00.000Z' },
    { sessionId: 'idle', modified: '2026-06-12T12:00:00.000Z' },
  ];
  const runtime = state({
    attentionSessions: new Set(['attention']),
    responseReadySessions: new Set(['ready']),
    activePtyIds: new Set(['busy', 'running']),
    sessionBusyState: new Map([['busy', true]]),
    lastActivityTime: new Map([
      ['busy', new Date()],
      ['running', new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)],
    ]),
  });

  assert.deepEqual(getFilteredSessionsByStatus(sessions, runtime, 'all').map(s => s.sessionId), ['attention', 'ready', 'busy', 'running', 'idle']);
  assert.deepEqual(getFilteredSessionsByStatus(sessions, runtime, 'attention').map(s => s.sessionId), ['attention']);
  assert.deepEqual(getFilteredSessionsByStatus(sessions, runtime, 'ready').map(s => s.sessionId), ['ready']);
  assert.deepEqual(getFilteredSessionsByStatus(sessions, runtime, 'active').map(s => s.sessionId), ['busy', 'running']);
  assert.deepEqual(getFilteredSessionsByStatus(sessions, runtime, 'stale').map(s => s.sessionId), ['running']);
});

test('grid auto-open targets every live PTY that is not already open', () => {
  const runtime = state({
    activePtyIds: new Set(['a', 'b', 'c']),
    openSessions: new Map([
      ['a', { closed: false }],   // already open → skip
      ['c', { closed: true }],    // closed entry → re-open
    ]),
  });

  assert.deepEqual(getGridAutoOpenSessionIds(runtime), ['b', 'c']);
});

test('grid auto-open never surfaces idle/stopped sessions (no live PTY = nothing to open)', () => {
  const runtime = state({
    activePtyIds: new Set(),
    openSessions: new Map([['idle', { closed: false }]]),
  });

  assert.deepEqual(getGridAutoOpenSessionIds(runtime), []);
});

test('grid auto-open opens all running sessions when none are mounted yet', () => {
  const runtime = state({ activePtyIds: new Set(['x', 'y']) });
  assert.deepEqual(getGridAutoOpenSessionIds(runtime), ['x', 'y']);
});

test('grid auto-open tolerates a missing runtime', () => {
  assert.deepEqual(getGridAutoOpenSessionIds(), []);
  assert.deepEqual(getGridAutoOpenSessionIds({}), []);
});

test('group launch targets every member that is not already mounted', () => {
  const runtime = state({
    openSessions: new Map([
      ['m1', { closed: false }], // open → skip
      ['m3', { closed: true }],  // closed entry → relaunch
    ]),
  });

  // Both running (m2) and stopped (m4) members are launched — only the open one
  // is skipped. The selector deliberately ignores activePtyIds.
  assert.deepEqual(
    getSessionsToLaunch(['m1', 'm2', 'm3', 'm4'], runtime),
    ['m2', 'm3', 'm4'],
  );
});

test('group launch de-dupes member ids and ignores falsy entries', () => {
  assert.deepEqual(
    getSessionsToLaunch(['a', 'a', null, 'b', undefined, 'b'], state()),
    ['a', 'b'],
  );
});

test('group launch returns nothing when every member is already open', () => {
  const runtime = state({
    openSessions: new Map([['a', { closed: false }], ['b', { closed: false }]]),
  });
  assert.deepEqual(getSessionsToLaunch(['a', 'b'], runtime), []);
});

test('group launch tolerates empty or missing member lists', () => {
  assert.deepEqual(getSessionsToLaunch([], state()), []);
  assert.deepEqual(getSessionsToLaunch(undefined, state()), []);
  assert.deepEqual(getSessionsToLaunch(['a']), ['a']);
});
