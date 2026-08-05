(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    Object.assign(root, factory());
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const STALE_OPEN_THRESHOLD_MS = 2 * 24 * 60 * 60 * 1000;

  const STATUS = {
    needsAttention: {
      key: 'needs-attention',
      label: 'Needs You',
      className: 'status-needs-attention',
      priority: 100,
      inInbox: true,
    },
    responseReady: {
      key: 'response-ready',
      label: 'Ready',
      className: 'status-response-ready',
      priority: 90,
      inInbox: true,
    },
    busy: {
      key: 'busy',
      label: 'Working',
      className: 'status-busy',
      priority: 80,
      inInbox: true,
    },
    running: {
      key: 'running',
      label: 'Open',
      className: 'status-running',
      priority: 70,
      inInbox: true,
    },
    exited: {
      key: 'exited',
      label: 'Exited',
      className: 'status-exited',
      priority: 20,
      inInbox: false,
    },
    idle: {
      key: 'idle',
      label: 'Idle',
      className: 'status-idle',
      priority: 10,
      inInbox: false,
    },
  };

  function hasSetValue(setLike, value) {
    return !!setLike && typeof setLike.has === 'function' && setLike.has(value);
  }

  function getMapValue(mapLike, value) {
    return mapLike && typeof mapLike.get === 'function' ? mapLike.get(value) : undefined;
  }

  // Claude includes its current task in a busy window title, e.g.
  // "⠸ Add CORS field to admin config ⟦esc⟧". Only expose titles with the
  // braille spinner so ordinary shell/window titles are never shown as tasks.
  function getAgentTaskFromTitle(title) {
    if (typeof title !== 'string' || !/^[\u2800-\u28ff]/u.test(title)) return '';
    return title
      .replace(/^[\u2800-\u28ff]\s*/u, '')
      .replace(/\s*⟦esc⟧\s*$/iu, '')
      .trim();
  }

  function getCliBusySignalFromTitle(title, wasBusy = false) {
    if (typeof title !== 'string') return null;
    const firstChar = title.charAt(0);
    if (/^[\u2800-\u28ff]$/u.test(firstChar)) return true;
    if (firstChar === '\u2733' || wasBusy) return false;
    return null;
  }

  // OMP renders the current task inside its terminal UI rather than publishing
  // it as a window title. Strip the common terminal control sequences first,
  // then extract its spinner + Esc-hint status line.
  function getAgentTaskFromTerminalData(data) {
    if (typeof data !== 'string') return '';
    const text = data
      .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
      .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
    const match = /[\u2800-\u28ff]\s+(.+?)\s*⟦esc⟧/iu.exec(text);
    return match ? match[1].trim() : '';
  }

  function shouldEndTaskFallbackActivity(authoritativeBusy) {
    return authoritativeBusy !== true;
  }

  function getSessionStatus(session, runtime = {}) {
    const sessionId = session.sessionId;
    if (hasSetValue(runtime.attentionSessions, sessionId)) return STATUS.needsAttention;
    if (hasSetValue(runtime.responseReadySessions, sessionId)) return STATUS.responseReady;
    if (getMapValue(runtime.sessionBusyState, sessionId)) return STATUS.busy;
    if (hasSetValue(runtime.activePtyIds, sessionId)) return STATUS.running;

    const openEntry = getMapValue(runtime.openSessions, sessionId);
    if (openEntry && openEntry.closed) return STATUS.exited;

    return STATUS.idle;
  }

  function sessionActivityTime(session, runtime = {}) {
    const lastActivity = getMapValue(runtime.lastActivityTime, session.sessionId);
    const value = lastActivity || session.modified || session.created;
    const time = value ? new Date(value).getTime() : 0;
    return Number.isFinite(time) ? time : 0;
  }

  // Inbox order is established when a session enters an actionable state, not
  // whenever it emits terminal output. Agents can keep repainting after asking
  // for input, so activity time would otherwise make cards swap places.
  function inboxArrivalTime(session, runtime = {}) {
    const arrival = getMapValue(runtime.inboxArrivalTime, session.sessionId);
    const time = arrival instanceof Date ? arrival.getTime() : Number(arrival);
    return Number.isFinite(time) ? time : sessionActivityTime(session, runtime);
  }

  function isStaleOpenSession(session, runtime = {}, options = {}) {
    if (!hasSetValue(runtime.activePtyIds, session.sessionId)) return false;
    const activityTime = sessionActivityTime(session, runtime);
    if (activityTime <= 0) return false;
    const now = options.now === undefined ? Date.now() : Number(options.now);
    const thresholdMs = options.thresholdMs === undefined
      ? STALE_OPEN_THRESHOLD_MS
      : Number(options.thresholdMs);
    if (!Number.isFinite(now) || !Number.isFinite(thresholdMs) || thresholdMs < 0) return false;
    return now - activityTime > thresholdMs;
  }

  function getAttentionInboxItems(sessions, runtime = {}) {
    return sessions
      .map(session => ({ session, status: getSessionStatus(session, runtime) }))
      .filter(item => item.status.inInbox)
      .sort((a, b) => {
        if (a.status.priority !== b.status.priority) return b.status.priority - a.status.priority;
        const order = inboxArrivalTime(b.session, runtime) - inboxArrivalTime(a.session, runtime);
        return order || a.session.sessionId.localeCompare(b.session.sessionId);
      });
  }

  function getNextAttentionInboxItem(sessions, runtime = {}, currentSessionId = null) {
    const items = getAttentionInboxItems(sessions, runtime);
    if (items.length === 0) return null;
    if (!currentSessionId) return items[0];
    const currentIndex = items.findIndex(item => item.session.sessionId === currentSessionId);
    if (currentIndex === -1 || currentIndex === items.length - 1) return items[0];
    return items[currentIndex + 1];
  }

  function isActiveStatus(status) {
    return status.key === 'busy' || status.key === 'running';
  }

  function getStatusCounts(sessions, runtime = {}) {
    const counts = { all: sessions.length, attention: 0, ready: 0, active: 0, staleOpen: 0 };
    for (const session of sessions) {
      const status = getSessionStatus(session, runtime);
      if (status.key === 'needs-attention') counts.attention++;
      if (status.key === 'response-ready') counts.ready++;
      if (isActiveStatus(status)) counts.active++;
      if (isStaleOpenSession(session, runtime)) counts.staleOpen++;
    }
    return counts;
  }

  function getFilteredSessionsByStatus(sessions, runtime = {}, filter = 'all') {
    if (filter === 'all') return sessions;
    return sessions.filter(session => {
      const status = getSessionStatus(session, runtime);
      if (filter === 'attention') return status.key === 'needs-attention';
      if (filter === 'ready') return status.key === 'response-ready';
      if (filter === 'active') return isActiveStatus(status);
      if (filter === 'stale') return isStaleOpenSession(session, runtime);
      return true;
    });
  }

  // Which sessions should the grid auto-open? Every session with a live PTY
  // (activePtyIds) that isn't already mounted as an open terminal. These are
  // genuinely-running sessions, so surfacing them only reattaches to an existing
  // process — it never spawns a new `claude`. Sessions that are merely on disk
  // but not running are deliberately excluded (auto-starting them would be
  // costly and surprising). Already-open sessions (and closed entries pending
  // cleanup) are skipped so we never double-open.
  function getGridAutoOpenSessionIds(runtime = {}) {
    const active = runtime.activePtyIds;
    if (!active || typeof active[Symbol.iterator] !== 'function') return [];
    const ids = [];
    for (const sessionId of active) {
      const entry = getMapValue(runtime.openSessions, sessionId);
      if (!entry || entry.closed) ids.push(sessionId);
    }
    return ids;
  }

  // Of the given member session ids, which still need launching? A session needs
  // launching when it has no live terminal entry (or its entry is closed/exited).
  // Used by the group "Launch all" action to skip already-open sessions and never
  // double-open. Pure — order-preserving and de-duped. Unlike grid auto-open this
  // does NOT inspect activePtyIds: the caller launches running and stopped members
  // alike (attach vs resume), so the only thing to skip is what's already mounted.
  function getSessionsToLaunch(sessionIds, runtime = {}) {
    if (!sessionIds || typeof sessionIds[Symbol.iterator] !== 'function') return [];
    const seen = new Set();
    const result = [];
    for (const sessionId of sessionIds) {
      if (!sessionId || seen.has(sessionId)) continue;
      seen.add(sessionId);
      const entry = getMapValue(runtime.openSessions, sessionId);
      if (!entry || entry.closed) result.push(sessionId);
    }
    return result;
  }

  return {
    getAgentTaskFromTitle,
    getCliBusySignalFromTitle,
    getAgentTaskFromTerminalData,
    shouldEndTaskFallbackActivity,
    getSessionStatus,
    sessionActivityTime,
    isStaleOpenSession,
    getAttentionInboxItems,
    getNextAttentionInboxItem,
    getStatusCounts,
    getFilteredSessionsByStatus,
    getGridAutoOpenSessionIds,
    getSessionsToLaunch,
  };
});
