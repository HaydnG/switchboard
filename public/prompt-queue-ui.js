// Prompt queue UI + delivery engine. Compose instructions for a busy agent and
// they deliver automatically when it goes idle/ready — one prompt per idle
// transition, so each queued instruction gets its own turn. Store logic is pure
// and tested (prompt-queue.js); queues persist across restarts via localStorage.

const promptQueueStore = deserializeQueues(
  (() => { try { return localStorage.getItem('promptQueues'); } catch { return null; } })()
);
let promptQueueTimer = null;
let promptQueuePopoverEl = null;

function savePromptQueues() {
  try { localStorage.setItem('promptQueues', serializeQueues(promptQueueStore)); } catch { /* storage unavailable */ }
}

function queuePromptForSession(sessionId, text) {
  const item = enqueuePrompt(promptQueueStore, sessionId, text);
  if (!item) return null;
  savePromptQueues();
  recordTimelineEvent(sessionId, 'queued-prompt', 'Prompt queued', item.text.slice(0, 120));
  refreshSessionStatusViews();
  if (typeof updateGridCardStatuses === 'function') updateGridCardStatuses();
  // Agent already deliverable? Flush immediately rather than waiting for a tick.
  deliverQueuedPrompts(sessionId);
  return item;
}

// Deliver the front-of-queue prompt when the session can take input.
// `justWentIdle` widens the gate to the 'running' status: a live PTY whose
// agent just stopped being busy is at its input prompt even when the session
// is focused (focused sessions never enter 'response-ready').
function deliverQueuedPrompts(sessionId, { justWentIdle = false } = {}) {
  const queueLength = queuedCount(promptQueueStore, sessionId);
  if (queueLength === 0) return;
  const status = quickActionsStatusKey(sessionId);
  const hasLivePty = activePtyIds.has(sessionId);
  const deliverable = shouldDeliverPrompt({ status, hasLivePty, queueLength })
    || (justWentIdle && hasLivePty && status === 'running');
  if (!deliverable) return;
  const item = takeNextPrompt(promptQueueStore, sessionId);
  if (!item) return;
  savePromptQueues();
  window.api.sendInput(sessionId, `\x1b[200~${item.text}\x1b[201~\r`);
  recordTimelineEvent(sessionId, 'queued-prompt', 'Queued prompt delivered', item.text.slice(0, 120));
  refreshSessionStatusViews();
  if (typeof updateGridCardStatuses === 'function') updateGridCardStatuses();
}

// Safety net for transitions the setActivity hook misses (e.g. a prompt queued
// against a session that only later gets a PTY reattached).
function startPromptQueueEngine() {
  if (promptQueueTimer) return;
  promptQueueTimer = setInterval(() => {
    for (const sessionId of Object.keys(promptQueueStore.queues)) {
      deliverQueuedPrompts(sessionId);
    }
  }, 10000);
}

function closePromptQueuePopover() {
  if (!promptQueuePopoverEl) return;
  document.removeEventListener('mousedown', onPromptQueueOutside, true);
  promptQueuePopoverEl.remove();
  promptQueuePopoverEl = null;
}

function onPromptQueueOutside(e) {
  if (promptQueuePopoverEl && !promptQueuePopoverEl.contains(e.target)) closePromptQueuePopover();
}

// Anchored manager: lists queued prompts with per-item remove and clear-all.
function openPromptQueuePopover(sessionId, anchor) {
  closePromptQueuePopover();
  const pop = document.createElement('div');
  pop.className = 'popover prompt-queue-popover';
  document.body.appendChild(pop);
  promptQueuePopoverEl = pop;

  const render = () => {
    const queue = getQueue(promptQueueStore, sessionId);
    if (queue.length === 0) { closePromptQueuePopover(); return; }
    pop.innerHTML = `
      <div class="prompt-queue-title">Queued prompts <span>${queue.length}</span></div>
      <div class="prompt-queue-list"></div>
      <div class="prompt-queue-actions">
        <span class="prompt-queue-hint">Delivers one per idle turn</span>
        <button type="button" class="btn btn-danger prompt-queue-clear">Clear all</button>
      </div>
    `;
    const list = pop.querySelector('.prompt-queue-list');
    for (const item of queue) {
      const row = document.createElement('div');
      row.className = 'prompt-queue-item';
      const text = document.createElement('span');
      text.className = 'prompt-queue-item-text';
      text.textContent = item.text;
      text.title = item.text;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'prompt-queue-item-remove';
      remove.textContent = '×';
      remove.title = 'Remove from queue';
      remove.addEventListener('click', () => {
        removePrompt(promptQueueStore, sessionId, item.id);
        savePromptQueues();
        refreshSessionStatusViews();
        if (typeof updateGridCardStatuses === 'function') updateGridCardStatuses();
        render();
      });
      row.appendChild(text);
      row.appendChild(remove);
      list.appendChild(row);
    }
    pop.querySelector('.prompt-queue-clear').addEventListener('click', () => {
      clearQueue(promptQueueStore, sessionId);
      savePromptQueues();
      refreshSessionStatusViews();
      if (typeof updateGridCardStatuses === 'function') updateGridCardStatuses();
      closePromptQueuePopover();
    });
  };
  render();
  if (!promptQueuePopoverEl) return; // empty queue closed it

  positionPopoverNear(pop, anchor);
  document.addEventListener('mousedown', onPromptQueueOutside, true);
}

// Paint (or remove) the "N queued" badge on a grid card footer. Called from
// updateGridCardStatuses each tick — reads the store only.
function updatePromptQueueBadge(sessionId, card) {
  const count = queuedCount(promptQueueStore, sessionId);
  let badge = card.querySelector('.prompt-queue-badge');
  if (count === 0) {
    if (badge) badge.remove();
    return;
  }
  if (!badge) {
    badge = document.createElement('button');
    badge.type = 'button';
    badge.className = 'chip prompt-queue-badge';
    badge.title = 'Show queued prompts';
    badge.addEventListener('click', (e) => {
      e.stopPropagation();
      openPromptQueuePopover(sessionId, badge);
    });
    badge.addEventListener('mousedown', (e) => e.stopPropagation());
    badge.addEventListener('pointerdown', (e) => e.stopPropagation());
    const footer = card.querySelector('.grid-card-footer');
    if (footer) footer.insertBefore(badge, footer.lastElementChild);
  }
  const label = `${count} queued`;
  if (badge.textContent !== label) badge.textContent = label;
}
