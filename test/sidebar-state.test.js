const test = require('node:test');
const assert = require('node:assert/strict');

const {
  shouldRenderProjectGroup,
  filterSessionsForGroupVisibility,
  projectHasAssignedUserGroups,
  expandUserGroupsForRunningFilter,
} = require('../public/sidebar-state');

test('default sidebar hides project groups when all sessions are truncated away', () => {
  assert.equal(shouldRenderProjectGroup({
    filteredCount: 3,
    visibleCount: 0,
    olderCount: 3,
    projectMatchedOnly: false,
  }), false);
});

test('sidebar still renders explicit project matches and visible session groups', () => {
  assert.equal(shouldRenderProjectGroup({
    filteredCount: 0,
    visibleCount: 0,
    olderCount: 0,
    projectMatchedOnly: true,
  }), true);

  assert.equal(shouldRenderProjectGroup({
    filteredCount: 1,
    visibleCount: 1,
    olderCount: 0,
    projectMatchedOnly: false,
  }), true);
});

test('filterSessionsForGroupVisibility hides archived sessions by default', () => {
  const sessions = [
    { sessionId: 'a', archived: false },
    { sessionId: 'b', archived: true },
  ];
  assert.deepEqual(
    filterSessionsForGroupVisibility(sessions),
    [{ sessionId: 'a', archived: false }],
  );
});

test('projectHasAssignedUserGroups detects assigned members even when stopped', () => {
  const groupsState = {
    groups: [{ id: 'g1', name: 'Backend', color: '#8088ff', order: 0 }],
    assignments: { s1: 'g1' },
  };
  const projectSessions = [{ sessionId: 's1', archived: false, modified: '2026-01-01T00:00:00Z' }];
  assert.equal(projectHasAssignedUserGroups(groupsState, projectSessions), true);
});

test('expandUserGroupsForRunningFilter excludes groups with no visible sessions', () => {
  const groupsState = {
    groups: [{ id: 'g1', name: 'Backend', color: '#8088ff', order: 0 }],
    assignments: { s1: 'g1', s2: 'g1' },
  };
  const projectSessions = [
    { sessionId: 's1', archived: false, modified: '2026-01-02T00:00:00Z' },
    { sessionId: 's2', archived: false, modified: '2026-01-01T00:00:00Z' },
  ];
  const runningOnly = [{ sessionId: 's1', archived: false, modified: '2026-01-02T00:00:00Z' }];
  const filteredGrouped = [{ group: groupsState.groups[0], sessions: runningOnly }];

  const expanded = expandUserGroupsForRunningFilter(groupsState, projectSessions, []);

  assert.equal(expanded.grouped.length, 0);
  assert.deepEqual([...expanded.assignedSessionIds], []);
});
