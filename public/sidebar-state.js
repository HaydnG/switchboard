(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    Object.assign(root, factory());
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  function shouldRenderProjectGroup({
    visibleCount = 0,
    projectMatchedOnly = false,
  } = {}) {
    return projectMatchedOnly || visibleCount > 0;
  }

  // Archive-only filter for group visibility — used when "running only" is on so
  // user-defined groups stay visible after all members are stopped.
  function filterSessionsForGroupVisibility(sessions, { showArchived = false, searchActive = false } = {}) {
    if (showArchived || searchActive) return sessions;
    return sessions.filter(s => !s.archived);
  }

  function projectHasAssignedUserGroups(groupsState, projectSessions, options = {}) {
    if (!groupsState || !Array.isArray(groupsState.groups) || groupsState.groups.length === 0) return false;
    const groupIds = new Set(groupsState.groups.map(g => g.id));
    const visible = filterSessionsForGroupVisibility(projectSessions, options);
    return visible.some(session => {
      const gid = groupsState.assignments?.[session.sessionId];
      return gid && groupIds.has(gid);
    });
  }

  // When "running only" is active, keep user-defined groups that still have
  // assigned members in this project even if none are running. Session rows
  // inside the group remain filtered to running members only.
  function expandUserGroupsForRunningFilter(groupsState, projectSessions, filteredGrouped, options = {}) {
    if (!groupsState || !Array.isArray(groupsState.groups)) {
      return { grouped: filteredGrouped || [], assignedSessionIds: new Set() };
    }

    const visible = filterSessionsForGroupVisibility(projectSessions, options);
    const assignedByGroup = new Map();
    for (const session of visible) {
      const gid = groupsState.assignments?.[session.sessionId];
      if (!gid) continue;
      if (!assignedByGroup.has(gid)) assignedByGroup.set(gid, []);
      assignedByGroup.get(gid).push(session);
    }

    const runningById = new Map((filteredGrouped || []).map(entry => [entry.group.id, entry.sessions]));
    const orderedGroups = [...groupsState.groups].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const grouped = [];
    const assignedSessionIds = new Set();

    for (const group of orderedGroups) {
      const assigned = assignedByGroup.get(group.id);
      if (!assigned || assigned.length === 0) continue;
      for (const session of assigned) assignedSessionIds.add(session.sessionId);
      grouped.push({
        group,
        sessions: runningById.get(group.id) || [],
      });
    }

    return { grouped, assignedSessionIds };
  }

  return {
    shouldRenderProjectGroup,
    filterSessionsForGroupVisibility,
    projectHasAssignedUserGroups,
    expandUserGroupsForRunningFilter,
  };
});
