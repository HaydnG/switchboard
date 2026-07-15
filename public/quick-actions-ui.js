// Quick-action UI: approve/deny/reply controls on grid cards and attention-inbox
// rows, plus the inline reply composer. Decision logic lives in quick-actions.js
// (pure, tested); this file binds it to live app state (owned by app.js) and the
// PTY input bridge. All globals are read lazily at render/click time, so script
// load order only requires the pure modules to precede this file.

let quickReplyPopoverEl = null;

function quickActionsRuntimeState() {
  return { attentionSessions, responseReadySessions, sessionBusyState, activePtyIds, openSessions };
}

function quickActionsStatusKey(sessionId) {
  const session = sessionMap.get(sessionId) || openSessions.get(sessionId)?.session || { sessionId };
  return getSessionStatus(session, quickActionsRuntimeState()).key;
}

// Render a quick-actions bar for a session, or null when nothing applies.
// The signature (joined action ids) is stamped on the element so callers can
// skip re-rendering when the action set hasn't changed across a status tick.
function buildQuickActionsBar(sessionId) {
  const status = quickActionsStatusKey(sessionId);
  const runtime = sessionMap.get(sessionId)?.runtime || 'claude';
  const actions = getQuickActionsForSession({ status, hasLivePty: activePtyIds.has(sessionId), runtime });
  if (actions.length === 0) return null;

  const bar = document.createElement('span');
  bar.className = 'quick-actions-bar';
  bar.dataset.signature = actions.map(a => a.id).join(',');
  for (const action of actions) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `btn quick-action-btn quick-action-${action.tone}`;
    btn.textContent = action.label;
    btn.title = action.title;
    btn.setAttribute('aria-label', `${action.label} — ${action.title}`);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      performQuickAction(sessionId, action, btn);
    });
    // Keep card drag / row focus gestures from hijacking the press.
    btn.addEventListener('mousedown', (e) => e.stopPropagation());
    btn.addEventListener('pointerdown', (e) => e.stopPropagation());
    bar.appendChild(btn);
  }
  return bar;
}

function performQuickAction(sessionId, action, anchor) {
  const status = quickActionsStatusKey(sessionId);
  if (!isQuickActionAllowed(action, { status, hasLivePty: activePtyIds.has(sessionId) })) {
    if (typeof showControlToast === 'function') {
      showControlToast({ message: 'Session state changed — action skipped.', timeoutMs: 2500 });
    }
    refreshSessionStatusViews();
    return;
  }
  if (action.id === 'reply') {
    openQuickReplyComposer(sessionId, anchor);
    return;
  }
  window.api.sendInput(sessionId, action.send);
  recordTimelineEvent(
    sessionId,
    'quick-action',
    action.id === 'approve' ? 'Approved without focusing' : 'Denied without focusing',
    `Sent the ${action.id} key from a quick action.`
  );
  // Optimistic: the prompt was answered. If the agent is still blocked, the
  // hook/OSC attention source re-flags the session on its next signal.
  attentionSessions.delete(sessionId);
  attentionReason.delete(sessionId);
  const item = document.querySelector(`.session-item[data-session-id="${sessionId}"]`);
  if (item) item.classList.remove('needs-attention');
  refreshSessionStatusViews();
}

function closeQuickReplyComposer() {
  if (!quickReplyPopoverEl) return;
  document.removeEventListener('mousedown', onQuickReplyOutside, true);
  quickReplyPopoverEl.remove();
  quickReplyPopoverEl = null;
}

function onQuickReplyOutside(e) {
  if (quickReplyPopoverEl && !quickReplyPopoverEl.contains(e.target)) closeQuickReplyComposer();
}

// Small anchored composer: Enter sends (bracketed paste + CR, same write path
// as the handoff flow), Shift+Enter inserts a newline, Esc/click-away closes.
function openQuickReplyComposer(sessionId, anchor) {
  closeQuickReplyComposer();
  const session = sessionMap.get(sessionId) || openSessions.get(sessionId)?.session;
  const displayName = cleanDisplayName(session?.name || session?.aiTitle || session?.summary) || sessionId;
  // A busy agent shouldn't get text interleaved into its in-flight turn: queue
  // instead, delivered by prompt-queue-ui when the agent next goes idle.
  const busy = quickActionsStatusKey(sessionId) === 'busy'
    && typeof queuePromptForSession === 'function';

  const pop = document.createElement('div');
  pop.className = 'popover quick-reply-popover';
  pop.innerHTML = `
    <div class="quick-reply-title">${busy ? 'Queue for' : 'Reply to'} ${escapeHtml(displayName)}</div>
    <textarea rows="3" placeholder="${busy ? 'Instruction for when the agent finishes…' : 'Message the agent…'}" spellcheck="false"></textarea>
    <div class="quick-reply-actions">
      <span class="quick-reply-hint">${busy ? 'Agent is working — delivers when idle' : 'Enter sends · Shift+Enter newline'}</span>
      <button type="button" class="btn quick-reply-cancel">Cancel</button>
      <button type="button" class="btn quick-reply-send">${busy ? 'Queue' : 'Send'}</button>
    </div>
  `;
  document.body.appendChild(pop);
  quickReplyPopoverEl = pop;

  positionPopoverNear(pop, anchor);

  const textarea = pop.querySelector('textarea');
  const send = () => {
    const payload = buildQuickReplyPayload(textarea.value);
    if (!payload) return;
    const text = payload.slice(0, -1); // strip the CR; bracketed paste re-adds it
    if (busy) {
      queuePromptForSession(sessionId, text);
    } else {
      window.api.sendInput(sessionId, `\x1b[200~${text}\x1b[201~\r`);
      recordTimelineEvent(sessionId, 'quick-action', 'Quick reply sent', 'Replied without focusing the terminal.');
      clearUnread(sessionId);
    }
    closeQuickReplyComposer();
  };
  pop.querySelector('.quick-reply-send').addEventListener('click', send);
  pop.querySelector('.quick-reply-cancel').addEventListener('click', closeQuickReplyComposer);
  textarea.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') closeQuickReplyComposer();
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });
  document.addEventListener('mousedown', onQuickReplyOutside, true);
  textarea.focus();
}
