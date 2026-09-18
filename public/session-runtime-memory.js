(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    Object.assign(root, factory());
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  // Grid is the common layout and keeps many xterms alive. Use a smaller
  // scrollback there; single-session view can afford a bit more history.
  const GRID_SCROLLBACK_LINES = 3000;
  const SINGLE_SCROLLBACK_LINES = 5000;
  const CLOSED_TERMINAL_GRACE_MS = 20000;

  function terminalScrollbackLines(gridViewActive) {
    return gridViewActive ? GRID_SCROLLBACK_LINES : SINGLE_SCROLLBACK_LINES;
  }

  // Closed agent terminals used to stay mounted until the same row was
  // re-clicked. Reclaim once the card is no longer focused, and once an
  // on-screen banner has had a short grace period.
  function shouldReclaimClosedTerminal({
    closed = false,
    focused = false,
    // Unknown visibility (observer has not fired) is treated as on-screen so a
    // just-exited card is not disposed before the user can read the banner.
    visible = true,
    now = Date.now(),
    exitedAt = 0,
    graceMs = CLOSED_TERMINAL_GRACE_MS,
  } = {}) {
    if (!closed) return false;
    if (focused) return false;
    const elapsed = exitedAt ? Math.max(0, now - exitedAt) : graceMs;
    if (visible && elapsed < graceMs) return false;
    return true;
  }

  function collectLiveSessionIds(projectLists, extraIds) {
    const ids = new Set();
    for (const projects of projectLists || []) {
      for (const project of projects || []) {
        for (const session of project.sessions || []) {
          if (session && session.sessionId) ids.add(session.sessionId);
        }
      }
    }
    for (const id of extraIds || []) {
      if (id) ids.add(id);
    }
    return ids;
  }

  function pruneSessionMap(sessionMap, liveIds) {
    if (!sessionMap || typeof sessionMap.keys !== 'function') return 0;
    let removed = 0;
    for (const id of [...sessionMap.keys()]) {
      if (!liveIds || !liveIds.has(id)) {
        sessionMap.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  function forgetKeyedSessionState(sessionId, stores) {
    if (!sessionId) return 0;
    let cleared = 0;
    for (const store of stores || []) {
      if (!store || typeof store.delete !== 'function') continue;
      store.delete(sessionId);
      cleared += 1;
    }
    return cleared;
  }

  function pruneKeyedSessionStores(liveIds, stores) {
    let removed = 0;
    for (const store of stores || []) {
      if (!store || typeof store.keys !== 'function' || typeof store.delete !== 'function') continue;
      for (const id of [...store.keys()]) {
        if (!liveIds || !liveIds.has(id)) {
          store.delete(id);
          removed += 1;
        }
      }
    }
    return removed;
  }

  function projectsExcludingArchivedSessions(projects) {
    return (projects || []).map((project) => ({
      ...project,
      sessions: (project.sessions || []).filter((session) => !session.archived),
    }));
  }

  return {
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
  };
});
