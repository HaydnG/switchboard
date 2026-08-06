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

  // Running-only views must not render empty groups. Preserve only assignments
  // represented by visible sessions so callers can hide empty group containers.
  function expandUserGroupsForRunningFilter(groupsState, projectSessions, filteredGrouped, options = {}) {
    if (!groupsState || !Array.isArray(groupsState.groups)) {
      return { grouped: filteredGrouped || [], assignedSessionIds: new Set() };
    }

    const assignedSessionIds = new Set();
    for (const entry of filteredGrouped || []) {
      for (const session of entry.sessions || []) {
        assignedSessionIds.add(session.sessionId);
      }
    }
    return { grouped: filteredGrouped || [], assignedSessionIds };
  }

  return {
    shouldRenderProjectGroup,
    filterSessionsForGroupVisibility,
    projectHasAssignedUserGroups,
    expandUserGroupsForRunningFilter,
  };
});
