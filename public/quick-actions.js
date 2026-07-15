(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    Object.assign(root, factory());
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  // Permission-menu key bindings, per runtime. Claude Code, omp, and pi all
  // currently accept the same number-key + Esc shortcuts for their approval
  // prompts, so there is one shared table — but callers ask by runtime name
  // so a future divergence (a runtime that binds 'y'/'n' instead) only
  // touches this table, not getQuickActionsForSession's policy.
  const APPROVAL_KEYS = {
    default: { approve: '1', deny: '\u001b' },
  };

  function approvalKeysFor(runtime) {
    return APPROVAL_KEYS[runtime] || APPROVAL_KEYS.default;
  }

  const REPLY_ACTION = {
    id: 'reply',
    label: 'Reply…',
    send: null,
    tone: 'neutral',
    title: 'Type a reply',
  };

  /**
   * Which quick actions should render for a session right now?
   * @param {{status: string, hasLivePty: boolean, runtime?: string, attentionReason?: string}} params
   * @returns {Array<{id: string, label: string, send: string|null, tone: string, title: string}>}
   */
  function getQuickActionsForSession({ status, hasLivePty, runtime } = {}) {
    if (!hasLivePty) return [];

    if (status === 'needs-attention') {
      const keys = approvalKeysFor(runtime);
      return [
        { id: 'approve', label: 'Approve', send: keys.approve, tone: 'safe', title: 'Choose option 1 (Yes)' },
        { id: 'deny', label: 'Deny', send: keys.deny, tone: 'danger', title: 'Send Escape (dismiss prompt)' },
        REPLY_ACTION,
      ];
    }

    if (status === 'response-ready' || status === 'idle' || status === 'busy' || status === 'running') {
      // 'running' = live PTY, agent at rest (a focused session never flips to
      // response-ready) — the resting state of a live agent, so reply applies.
      return [REPLY_ACTION];
    }

    // 'exited' (and anything unrecognized) gets no quick actions.
    return [];
  }

  /**
   * Build the PTY write payload for a quick reply. Returns null for blank
   * input so callers can skip writing / disable the send button.
   * @param {string} text
   * @returns {string|null}
   */
  function buildQuickReplyPayload(text) {
    if (typeof text !== 'string') return null;
    const trimmed = text.replace(/[\r\n]+$/, '');
    if (trimmed.trim() === '') return null;
    return trimmed + '\r';
  }

  /**
   * Re-check an action at click time — session state may have moved on
   * since the action list was rendered (e.g. the prompt was already
   * answered elsewhere).
   * @param {{id: string}} action
   * @param {{status: string, hasLivePty: boolean}} params
   * @returns {boolean}
   */
  function isQuickActionAllowed(action, { status, hasLivePty } = {}) {
    if (!hasLivePty || !action) return false;

    if (action.id === 'approve' || action.id === 'deny') {
      return status === 'needs-attention';
    }

    if (action.id === 'reply') {
      return true;
    }

    return false;
  }

  return {
    getQuickActionsForSession,
    buildQuickReplyPayload,
    isQuickActionAllowed,
  };
});
