(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    Object.assign(root, factory());
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const SEARCH_KINDS = ['session', 'plan', 'memory'];
  const SMART_FILTERS = ['running', 'attention', 'starred', 'today'];
  const SAVED_SEARCH_LIMIT = 8;

  function uniqueAllowed(values, allowed, fallback) {
    const source = Array.isArray(values) ? values : [];
    const result = [...new Set(source.filter((value) => allowed.includes(value)))];
    return result.length > 0 ? result : [...fallback];
  }

  function normalizeSearchFilters(filters) {
    return {
      kinds: uniqueAllowed(filters?.kinds, SEARCH_KINDS, SEARCH_KINDS),
      smart: uniqueAllowed(filters?.smart, SMART_FILTERS, []),
    };
  }

  function normalizeSnippet(snippet) {
    if (typeof snippet !== 'string') return '';
    return snippet
      .replace(/\s+/g, ' ')
      .replace(/^\s+|\s+$/g, '')
      .slice(0, 500);
  }

  // Return text/mark segments so callers can render FTS highlights without
  // trusting snippet HTML. SQLite only emits the two marker tags requested by
  // db.js; every other character remains plain text.
  function parseFtsSnippet(snippet) {
    const normalized = normalizeSnippet(snippet);
    if (!normalized) return [];
    const parts = normalized.split(/(<mark>|<\/mark>)/i);
    const segments = [];
    let highlighted = false;
    for (const part of parts) {
      if (!part) continue;
      if (/^<mark>$/i.test(part)) {
        highlighted = true;
      } else if (/^<\/mark>$/i.test(part)) {
        highlighted = false;
      } else {
        const previous = segments[segments.length - 1];
        if (previous && previous.highlighted === highlighted) previous.text += part;
        else segments.push({ text: part, highlighted });
      }
    }
    return segments;
  }

  function buildUnifiedSearchItems({
    sessions = [],
    plans = [],
    memories = [],
    results = {},
  } = {}) {
    const hasResults = Object.keys(results).length > 0;
    const sessionById = new Map(sessions.map((session) => [session.sessionId, session]));
    const planById = new Map(plans.map((plan) => [plan.filename, plan]));
    const memoryById = new Map(memories.map((memory) => [memory.filePath, memory]));
    const matchedSessions = hasResults
      ? (results.session || [])
          .map((match) => ({ match, value: sessionById.get(match.id) }))
          .filter((entry) => entry.value)
      : sessions.map((value) => ({ match: null, value }));
    const matchedPlans = hasResults
      ? (results.plan || [])
          .map((match) => ({ match, value: planById.get(match.id) }))
          .filter((entry) => entry.value)
      : plans.map((value) => ({ match: null, value }));
    const matchedMemories = hasResults
      ? (results.memory || [])
          .map((match) => ({ match, value: memoryById.get(match.id) }))
          .filter((entry) => entry.value)
      : memories.map((value) => ({ match: null, value }));
    const items = [];

    for (const { match, value: session } of matchedSessions) {
      items.push({
        id: session.sessionId,
        kind: 'session',
        title: session.name || session.sessionId,
        subtitle: session.subtitle || '',
        snippet: normalizeSnippet(match?.snippet),
        statusKey: session.status || '',
        statusLabel: session.statusLabel || '',
        modified: session.modified || '',
        starred: !!session.starred,
        data: session,
      });
    }

    for (const { match, value: plan } of matchedPlans) {
      items.push({
        id: plan.filename,
        kind: 'plan',
        title: plan.title || plan.filename,
        subtitle: plan.filename || '',
        snippet: normalizeSnippet(match?.snippet),
        modified: plan.modified || '',
        data: plan,
      });
    }

    for (const { match, value: memory } of matchedMemories) {
      items.push({
        id: memory.filePath,
        kind: 'memory',
        title: memory.filename || memory.filePath,
        subtitle: memory.displayPath || '',
        snippet: normalizeSnippet(match?.snippet),
        modified: memory.modified || '',
        data: memory,
      });
    }

    return items;
  }

  // FTS ranks are only comparable within a type because each type is queried
  // separately. Round-robin the already-ranked streams so one prolific source
  // cannot hide relevant results from the other selected sources.
  function interleaveUnifiedSearchItems(items, kinds = SEARCH_KINDS) {
    const queues = new Map(kinds.map((kind) => [kind, []]));
    const remainder = [];
    for (const item of Array.isArray(items) ? items : []) {
      const queue = queues.get(item.kind);
      if (queue) queue.push(item);
      else remainder.push(item);
    }
    const output = [];
    let index = 0;
    let added = true;
    while (added) {
      added = false;
      for (const kind of kinds) {
        const item = queues.get(kind)?.[index];
        if (!item) continue;
        output.push(item);
        added = true;
      }
      index += 1;
    }
    return [...output, ...remainder];
  }

  function isToday(value, now) {
    if (!value) return false;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return false;
    return (
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth() &&
      date.getDate() === now.getDate()
    );
  }

  function applyUnifiedSearchFilters(items, filters, { now = new Date() } = {}) {
    const normalized = normalizeSearchFilters(filters);
    return (Array.isArray(items) ? items : []).filter((item) => {
      if (!normalized.kinds.includes(item.kind)) return false;
      if (item.kind !== 'session') return normalized.smart.length === 0;
      for (const filter of normalized.smart) {
        if (filter === 'running' && !['running', 'busy'].includes(item.statusKey)) return false;
        if (
          filter === 'attention' &&
          !['needs-attention', 'response-ready'].includes(item.statusKey)
        ) {
          return false;
        }
        if (filter === 'starred' && !item.starred) return false;
        if (filter === 'today' && !isToday(item.modified, now)) return false;
      }
      return true;
    });
  }

  function normalizeSavedSearch(value) {
    if (!value || typeof value !== 'object') return null;
    const query = typeof value.query === 'string' ? value.query.trim().slice(0, 200) : '';
    if (!query) return null;
    const filters = normalizeSearchFilters(value.filters);
    return {
      id:
        typeof value.id === 'string' && value.id
          ? value.id.slice(0, 100)
          : `${query.toLowerCase()}-${filters.kinds.join('-')}-${filters.smart.join('-')}`,
      label:
        typeof value.label === 'string' && value.label.trim()
          ? value.label.trim().slice(0, 40)
          : query.slice(0, 40),
      query,
      filters,
      titleOnly: !!value.titleOnly,
    };
  }

  function deserializeSavedSearches(raw) {
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!Array.isArray(parsed)) return [];
      const saved = [];
      const seen = new Set();
      for (const value of parsed) {
        const item = normalizeSavedSearch(value);
        if (!item || seen.has(item.id)) continue;
        seen.add(item.id);
        saved.push(item);
        if (saved.length === SAVED_SEARCH_LIMIT) break;
      }
      return saved;
    } catch {
      return [];
    }
  }

  function upsertSavedSearch(savedSearches, value) {
    const item = normalizeSavedSearch(value);
    if (!item) return deserializeSavedSearches(savedSearches);
    const existing = deserializeSavedSearches(savedSearches).filter(
      (saved) => saved.id !== item.id,
    );
    return [item, ...existing].slice(0, SAVED_SEARCH_LIMIT);
  }

  function getSessionCommandDescriptors(session, capabilities = {}) {
    if (!session?.sessionId) return [];
    const descriptors = [
      { id: 'open', title: 'Open session', keywords: ['resume', 'terminal'] },
      { id: 'timeline', title: 'View timeline', keywords: ['events', 'activity'] },
      { id: 'messages', title: 'View messages', keywords: ['history', 'jsonl'] },
      { id: 'annotate', title: 'Edit notes and tags', keywords: ['note', 'tag', 'organize'] },
    ];
    if (capabilities.canFork) {
      descriptors.push({ id: 'fork', title: 'Fork session', keywords: ['branch', 'copy'] });
    }
    if (capabilities.canHandoff) {
      descriptors.push({
        id: 'handoff',
        title: 'Create handoff',
        keywords: ['fresh', 'context'],
      });
    }
    if (capabilities.canTransfer) {
      descriptors.push({
        id: 'transfer',
        title: 'Send context to another session',
        keywords: ['context', 'transfer', 'delegate', 'session'],
      });
    }
    if (capabilities.canQueue) {
      descriptors.push({
        id: 'queue',
        title: 'Queue instruction',
        keywords: ['prompt', 'later'],
      });
    }
    return descriptors.map((descriptor) => ({
      ...descriptor,
      id: `${session.sessionId}:${descriptor.id}`,
      command: descriptor.id,
      kind: 'session-action',
      sessionId: session.sessionId,
    }));
  }

  return {
    SEARCH_KINDS,
    SMART_FILTERS,
    normalizeSearchFilters,
    normalizeSnippet,
    parseFtsSnippet,
    buildUnifiedSearchItems,
    interleaveUnifiedSearchItems,
    applyUnifiedSearchFilters,
    deserializeSavedSearches,
    upsertSavedSearch,
    getSessionCommandDescriptors,
  };
});
