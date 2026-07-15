(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    Object.assign(root, factory());
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  // Statuses safe to deliver a queued prompt into. Never 'needs-attention'
  // (typed text would select a permission-prompt menu option instead of
  // reaching the agent), never 'busy' (would interleave with an in-flight
  // turn), never 'exited' (no process to receive it).
  const DELIVERABLE_STATUSES = new Set(['response-ready', 'idle']);

  /**
   * @returns {{ queues: Object.<string, Array> }} fresh, empty store.
   */
  function createPromptQueueStore() {
    return { queues: {} };
  }

  // Next id's counter is derived from the store's own contents (not hidden
  // state) so the store stays a plain serializable object. Scans every
  // session's queue for ids sharing this timestamp's prefix.
  function nextQueueItemId(store, now) {
    const prefix = `q-${now}-`;
    let maxCounter = -1;
    for (const items of Object.values(store.queues)) {
      for (const item of items) {
        if (typeof item.id === 'string' && item.id.startsWith(prefix)) {
          const suffix = Number(item.id.slice(prefix.length));
          if (Number.isFinite(suffix) && suffix > maxCounter) maxCounter = suffix;
        }
      }
    }
    return `${prefix}${maxCounter + 1}`;
  }

  /**
   * @param {string} sessionId
   * @param {string} text - trimmed before storing; whitespace-only rejected.
   * @param {number} [now]
   * @returns {{id: string, text: string, createdAt: number} | null}
   */
  function enqueuePrompt(store, sessionId, text, now = Date.now()) {
    const trimmed = typeof text === 'string' ? text.trim() : '';
    if (!trimmed) return null;

    const item = { id: nextQueueItemId(store, now), text: trimmed, createdAt: now };
    if (!store.queues[sessionId]) store.queues[sessionId] = [];
    store.queues[sessionId].push(item);
    return item;
  }

  /**
   * @returns {boolean} whether an item was found and removed.
   */
  function removePrompt(store, sessionId, itemId) {
    const items = store.queues[sessionId];
    if (!items) return false;

    const index = items.findIndex((item) => item.id === itemId);
    if (index === -1) return false;

    items.splice(index, 1);
    if (items.length === 0) delete store.queues[sessionId];
    return true;
  }

  /**
   * @returns {number} count of items removed.
   */
  function clearQueue(store, sessionId) {
    const items = store.queues[sessionId];
    const count = items ? items.length : 0;
    if (items) delete store.queues[sessionId];
    return count;
  }

  /**
   * @returns {Array} shallow copy of the session's queue; safe to mutate.
   */
  function getQueue(store, sessionId) {
    const items = store.queues[sessionId];
    return items ? items.map((item) => ({ ...item })) : [];
  }

  function queuedCount(store, sessionId) {
    const items = store.queues[sessionId];
    return items ? items.length : 0;
  }

  /**
   * @param {{status: string, hasLivePty: boolean, queueLength: number}} args
   * @returns {boolean}
   */
  function shouldDeliverPrompt({ status, hasLivePty, queueLength } = {}) {
    return queueLength > 0 && !!hasLivePty && DELIVERABLE_STATUSES.has(status);
  }

  /**
   * Dequeues and returns the oldest item (FIFO) or null when empty.
   */
  function takeNextPrompt(store, sessionId) {
    const items = store.queues[sessionId];
    if (!items || items.length === 0) return null;

    const [next] = items.splice(0, 1);
    if (items.length === 0) delete store.queues[sessionId];
    return next;
  }

  function serializeQueues(store) {
    return JSON.stringify(store && store.queues ? store.queues : {});
  }

  function isValidQueueItem(item) {
    return (
      !!item &&
      typeof item === 'object' &&
      typeof item.id === 'string' &&
      typeof item.text === 'string' &&
      item.text.trim().length > 0 &&
      typeof item.createdAt === 'number' &&
      Number.isFinite(item.createdAt)
    );
  }

  /**
   * Tolerant of null/garbage input (returns a fresh store) and drops
   * malformed entries within otherwise-valid JSON.
   */
  function deserializeQueues(json) {
    const store = createPromptQueueStore();

    let parsed;
    try {
      parsed = JSON.parse(json);
    } catch (err) {
      return store;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return store;

    for (const [sessionId, items] of Object.entries(parsed)) {
      if (!Array.isArray(items)) continue;
      const validItems = items
        .filter(isValidQueueItem)
        .map((item) => ({ id: item.id, text: item.text.trim(), createdAt: item.createdAt }));
      if (validItems.length > 0) store.queues[sessionId] = validItems;
    }
    return store;
  }

  return {
    createPromptQueueStore,
    enqueuePrompt,
    removePrompt,
    clearQueue,
    getQueue,
    queuedCount,
    shouldDeliverPrompt,
    takeNextPrompt,
    serializeQueues,
    deserializeQueues,
  };
});
