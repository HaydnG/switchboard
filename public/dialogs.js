// --- Dialogs & session launch helpers ---

async function resolveDefaultSessionOptions(project) {
  return resolveLaunchOptions('claude', project);
}

async function forkSession(session, project) {
  const options = await resolveLaunchOptions(session.runtime || 'claude', project);
  options.runtime = session.runtime || 'claude';
  options.forkFrom = session.sessionId;
  launchNewSession(project, options);
}

function findProjectForSession(session) {
  const project = [...cachedAllProjects, ...cachedProjects].find(p =>
    p.sessions && p.sessions.some(s => s.sessionId === session.sessionId)
  );
  return project || (session.projectPath ? { projectPath: session.projectPath } : null);
}

async function showHandoffPrompt(session) {
  const health = getSessionHealth(session);
  const canAskRunningSession = activePtyIds.has(session.sessionId) && session.type !== 'terminal';
  const project = findProjectForSession(session);
  const evidence = health.reasons.length
    ? health.reasons.map(reason => reason.label).join(', ')
    : 'This session is still within healthy bounds.';
  const tone = health.tier === 'strong' || health.tier === 'warning' ? 'warning' : 'default';
  const details = {
    Session: cleanDisplayName(session.name || session.aiTitle || session.summary) || session.sessionId,
    Project: session.projectPath ? session.projectPath.split('/').filter(Boolean).slice(-2).join('/') : '',
    Recommendation: health.label,
    Running: canAskRunningSession ? 'Yes' : '',
  };

  // The guided handoff needs a live agent to summarize and a project to launch
  // into. When the session isn't running, fall back to the copy-only packet.
  if (canAskRunningSession && project) {
    const action = await showControlDialog({
      title: 'Hand Off Session',
      message: `This session is becoming expensive: ${evidence}. The guided handoff asks the running agent for a summary (spends tokens), then starts a fresh, lean session in the same project seeded with it. You'll review the packet before anything new is started. Or copy a local starter packet instead.`,
      confirmLabel: 'Hand off (guided)',
      secondaryLabel: 'Copy Packet',
      cancelLabel: 'Close',
      tone,
      details,
    });
    if (action === true) {
      await runHandoff(session, project);
    } else if (action === 'secondary') {
      await window.api.writeClipboard(buildHandoffTemplate(session));
      showControlToast({ message: 'Handoff copied to clipboard.' });
    }
    return;
  }

  const action = await showControlDialog({
    title: 'Create Handoff',
    message: `This session is becoming expensive: ${evidence}. Copy a short handoff packet and start fresh when you reach a natural breakpoint.`,
    confirmLabel: 'Copy Handoff',
    cancelLabel: 'Close',
    tone,
    details,
  });
  if (!action) return;
  await window.api.writeClipboard(buildHandoffTemplate(session));
  showControlToast({ message: 'Handoff copied to clipboard.' });
}

async function readLatestHandoffPacket(session) {
  try {
    const result = await window.api.readSessionJsonl(session.sessionId);
    if (result && Array.isArray(result.entries)) {
      const text = extractLatestAssistantText(result.entries);
      if (text) return text;
    }
  } catch {}
  return '';
}

async function showContextTransferDialog(session) {
  const project = findProjectForSession(session);
  const latest = await readLatestHandoffPacket(session);
  const packet = buildContextTransferPacket(
    session,
    latest || buildHandoffTemplate(session),
  );
  const targets = getTransferTargets(
    Array.from(sessionMap.values()).map(candidate => ({
      ...candidate,
      isRunning: activePtyIds.has(candidate.sessionId),
    })),
    session.sessionId,
  );

  const overlay = document.createElement('div');
  overlay.className = 'new-session-overlay';
  overlay.setAttribute('role', 'presentation');

  const dialog = document.createElement('div');
  dialog.className = 'new-session-dialog context-transfer-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'context-transfer-title');
  dialog.innerHTML = `
    <h3 id="context-transfer-title">Send Context</h3>
    <div class="add-project-hint">Review the packet before sending it. Starting or prompting a session can spend tokens; the source session remains unchanged.</div>
    <label class="settings-field settings-field-wide">
      <span class="settings-field-info">
        <span class="settings-label">Destination</span>
        <span class="settings-description">Create a clean session or prompt an active one.</span>
      </span>
      <span class="settings-field-control">
        <select id="context-transfer-target" class="settings-input">
          <option value="__new__">New clean session in this project</option>
          ${targets
            .map(
              target =>
                `<option value="${escapeHtml(target.id)}">${escapeHtml(target.label)} — ${escapeHtml(target.project)} (${escapeHtml(target.runtime)})</option>`,
            )
            .join('')}
        </select>
      </span>
    </label>
    <label class="settings-field settings-field-wide context-transfer-packet">
      <span class="settings-label">Context packet</span>
      <textarea id="context-transfer-text" class="settings-input" spellcheck="false"></textarea>
    </label>
    <div class="new-session-actions">
      <button type="button" class="new-session-cancel-btn">Cancel</button>
      <button type="button" class="new-session-start-btn">Send context</button>
    </div>
  `;

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  const select = dialog.querySelector('#context-transfer-target');
  const textarea = dialog.querySelector('#context-transfer-text');
  const submit = dialog.querySelector('.new-session-start-btn');
  textarea.value = packet;
  textarea.focus();
  textarea.setSelectionRange(0, 0);

  function close() {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  }

  async function send() {
    const content = textarea.value.trim();
    if (!content) {
      showControlToast({ message: 'Add some context before sending.' });
      textarea.focus();
      return;
    }

    submit.disabled = true;
    const targetId = select.value;
    try {
      if (targetId === '__new__') {
        if (!project) {
          showControlToast({ message: 'The source project is unavailable.' });
          submit.disabled = false;
          return;
        }
        const runtime = session.runtime || 'claude';
        const options = await resolveLaunchOptions(runtime, project);
        await launchNewSession(project, options, content);
      } else {
        // Bracketed paste keeps newlines and shell metacharacters as terminal
        // input instead of letting the active TUI interpret partial chunks.
        window.api.sendInput(targetId, `\x1b[200~${content}\x1b[201~\r`);
        showControlToast({ message: 'Context sent to the active session.' });
      }
      close();
    } catch (error) {
      console.error('Context transfer failed:', error);
      showControlToast({ message: 'Context transfer failed. Nothing was changed.' });
      submit.disabled = false;
    }
  }

  function onKey(event) {
    if (event.key === 'Escape') close();
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') send();
  }

  dialog.querySelector('.new-session-cancel-btn').onclick = close;
  submit.onclick = send;
  overlay.addEventListener('click', event => {
    if (event.target === overlay) close();
  });
  document.addEventListener('keydown', onKey);
}

async function showSessionAnnotationsDialog(session) {
  const current = await window.api.getSessionAnnotations(session.sessionId);
  const overlay = document.createElement('div');
  overlay.className = 'new-session-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'new-session-dialog session-annotations-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'session-annotations-title');
  dialog.innerHTML = `
    <h3 id="session-annotations-title">Notes &amp; Tags</h3>
    <div class="add-project-hint">Private, local metadata for ${escapeHtml(
      cleanDisplayName(session.name || session.aiTitle || session.summary) || session.sessionId,
    )}. It is never written into the agent transcript.</div>
    <label class="settings-field settings-field-wide session-annotations-note">
      <span class="settings-label">Notes</span>
      <textarea id="session-annotations-note" class="settings-input" rows="8" placeholder="Decisions, follow-ups, or review notes…"></textarea>
    </label>
    <label class="settings-field settings-field-wide">
      <span class="settings-field-info">
        <span class="settings-label">Tags</span>
        <span class="settings-description">Comma-separated labels used for local organization.</span>
      </span>
      <span class="settings-field-control">
        <input id="session-annotations-tags" class="settings-input" type="text" placeholder="checkout, review, urgent">
      </span>
    </label>
    <div class="new-session-actions">
      <button type="button" class="new-session-cancel-btn">Cancel</button>
      <button type="button" class="new-session-start-btn">Save</button>
    </div>
  `;
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  const noteInput = dialog.querySelector('#session-annotations-note');
  const tagsInput = dialog.querySelector('#session-annotations-tags');
  const saveButton = dialog.querySelector('.new-session-start-btn');
  noteInput.value = current?.note || '';
  tagsInput.value = Array.isArray(current?.tags) ? current.tags.join(', ') : '';
  noteInput.focus();

  function close() {
    document.removeEventListener('keydown', onKey);
    overlay.remove();
  }

  async function save() {
    saveButton.disabled = true;
    const result = await window.api.setSessionAnnotations(session.sessionId, {
      note: noteInput.value,
      tags: tagsInput.value
        .split(',')
        .map(tag => tag.trim())
        .filter(Boolean),
    });
    if (!result?.ok) {
      saveButton.disabled = false;
      showControlToast({ message: result?.error || 'Could not save session notes.' });
      return;
    }
    session.tags = result.tags;
    close();
    showControlToast({ message: 'Session notes and tags saved locally.' });
  }

  function onKey(event) {
    if (event.key === 'Escape') close();
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') save();
  }

  dialog.querySelector('.new-session-cancel-btn').onclick = close;
  saveButton.onclick = save;
  overlay.addEventListener('click', event => {
    if (event.target === overlay) close();
  });
  document.addEventListener('keydown', onKey);
}

// Follow-up dialog that lets the human review/edit the captured handoff packet
// before a fresh session is started. Resolves with the edited text, or null on
// cancel. Prefilled by reading the latest assistant turn from the session JSONL
// (no brittle terminal scraping); falls back to the local starter template.
async function showHandoffReviewDialog(session) {
  const overlay = document.createElement('div');
  overlay.className = 'new-session-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'new-session-dialog';
  dialog.innerHTML = `
    <h3>Review Handoff Packet</h3>
    <div class="add-project-hint">This text seeds a brand-new, lean session in the same project. Review and edit it, then start the fresh session. Starting the session spends tokens; the old session is left untouched. If the agent is still writing, use “Refresh from session”.</div>
    <textarea id="handoff-packet-text" class="settings-input" spellcheck="false" style="width:100%;min-height:260px;font-family:monospace;font-size:12px;line-height:1.5;resize:vertical;box-sizing:border-box;"></textarea>
    <div class="new-session-actions">
      <button type="button" class="new-session-cancel-btn">Cancel</button>
      <button type="button" class="handoff-refresh-btn">Refresh from session</button>
      <button type="button" class="new-session-start-btn">Start fresh session</button>
    </div>
  `;

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  const textarea = dialog.querySelector('#handoff-packet-text');
  const captured = await readLatestHandoffPacket(session);
  textarea.value = captured || buildHandoffTemplate(session);
  textarea.focus();

  return new Promise(resolve => {
    function close(result) {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      resolve(result);
    }

    dialog.querySelector('.new-session-cancel-btn').onclick = () => close(null);
    dialog.querySelector('.handoff-refresh-btn').onclick = async () => {
      const latest = await readLatestHandoffPacket(session);
      if (latest) textarea.value = latest;
    };
    dialog.querySelector('.new-session-start-btn').onclick = () => {
      const value = textarea.value.trim();
      if (value) close(value);
    };
    overlay.addEventListener('click', e => { if (e.target === overlay) close(null); });

    function onKey(e) {
      if (e.key === 'Escape') close(null);
    }
    document.addEventListener('keydown', onKey);
  });
}

// Guided one-click handoff: request packet → review → fresh lean session seeded
// with it → switch. Driven by the pure state machine in handoff-flow.js. Every
// token-spending step is gated behind an explicit user confirmation; cancelling
// at any point leaves both the old and (not-yet-created) new session untouched.
async function runHandoff(session, project) {
  let state = createHandoffState();
  let packet = '';

  while (!isHandoffTerminal(state)) {
    const { action } = nextHandoffStep(state);

    if (action === 'request-packet') {
      // Token step #1 — authorized by the "Hand off (guided)" button. The prompt
      // instructs the agent to return only a markdown handoff and not continue.
      const requestPrompt = buildHandoffRequestPrompt(session);
      window.api.sendInput(session.sessionId, `\x1b[200~${requestPrompt}\x1b[201~\r`);
      showControlToast({ message: 'Asked the agent for a handoff packet — review it once it finishes.' });
      state = advanceHandoff(state);
    } else if (action === 'capture-packet') {
      const reviewed = await showHandoffReviewDialog(session);
      if (reviewed === null) { state = cancelHandoff(state); break; }
      packet = reviewed;
      state = advanceHandoff(state);
    } else if (action === 'launch-session') {
      // No tokens yet; the launch + seed happens together in the next step.
      state = advanceHandoff(state);
    } else if (action === 'seed-session') {
      // Token step #2 — authorized by the "Start fresh session" button. Start a
      // FRESH session (not a fork): forking via --resume --fork-session inherits
      // the bloated context we are trying to escape. resolveDefaultSessionOptions
      // never sets forkFrom, so this is a clean --session-id session.
      const options = await resolveDefaultSessionOptions(project);
      const newId = await launchNewSession(project, options, packet);
      if (!newId) { state = cancelHandoff(state); break; }
      state = advanceHandoff(state);
    } else if (action === 'finish') {
      // launchNewSession already focused the new session via showSession().
      showControlToast({ message: 'Handed off → fresh lean session seeded with the packet.' });
      state = advanceHandoff(state);
    } else {
      break;
    }
  }
}

async function launchScheduleCreator(project) {
  const options = await resolveDefaultSessionOptions(project);
  // Pre-create a JSONL session with the schedule creation prompt, then resume into it
  const result = await window.api.createScheduleSession(project.projectPath);
  if (!result || !result.sessionId) return;

  const session = {
    sessionId: result.sessionId,
    summary: 'Create scheduled task',
    firstPrompt: '',
    projectPath: project.projectPath,
    name: null,
    starred: 0,
    archived: 0,
    messageCount: 1,
    modified: new Date().toISOString(),
    created: new Date().toISOString(),
  };

  // Inject into sidebar
  const folder = encodeProjectPath(project.projectPath);
  pendingSessions.set(result.sessionId, { session, projectPath: project.projectPath, folder });
  sessionMap.set(result.sessionId, session);
  for (const projList of [cachedProjects, cachedAllProjects]) {
    let proj = projList.find(p => p.projectPath === project.projectPath);
    if (!proj) {
      proj = { folder, projectPath: project.projectPath, sessions: [] };
      projList.unshift(proj);
    }
    proj.sessions.unshift(session);
  }
  refreshSidebar();

  const entry = createTerminalEntry(session);
  // Resume the pre-seeded session
  options.appendSystemPrompt = result.systemPrompt;
  const openResult = await window.api.openTerminal(result.sessionId, project.projectPath, false, options);
  if (!openResult.ok) {
    entry.terminal.write(`\r\nError: ${openResult.error}\r\n`);
    entry.closed = true;
    return;
  }
  if (typeof setSessionMcpActive === 'function') setSessionMcpActive(result.sessionId, !!openResult.mcpActive);
  showSession(result.sessionId);
  pollActiveSessions();
}

function showNewSessionPopover(project, anchorEl, { groupId = null } = {}) {
  document.querySelectorAll('.new-session-popover').forEach(el => el.remove());

  const popover = document.createElement('div');
  popover.className = 'new-session-popover';

  for (const runtime of getLaunchableAgentRuntimes()) {
    const quickBtn = document.createElement('button');
    quickBtn.className = 'popover-option';
    quickBtn.innerHTML = `${popoverIconHtml(runtime)} ${escapeHtml(runtime.label)}`;
    quickBtn.onclick = async () => {
      popover.remove();
      launchNewSession(project, await resolveLaunchOptions(runtime.id, project), undefined, groupId);
    };
    popover.appendChild(quickBtn);

    if (runtime.hasConfigureDialog) {
      const cfgBtn = document.createElement('button');
      cfgBtn.className = 'popover-option';
      cfgBtn.innerHTML = `${popoverIconHtml(runtime)} ${escapeHtml(runtime.configureLabel)}`;
      cfgBtn.onclick = () => {
        popover.remove();
        showConfigureDialogForRuntime(runtime.id, project, groupId);
      };
      popover.appendChild(cfgBtn);
    }
  }

  const termBtn = document.createElement('button');
  termBtn.className = 'popover-option popover-option-terminal';
  termBtn.innerHTML = '<svg class="popover-option-icon terminal-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg> Terminal';
  termBtn.onclick = () => { popover.remove(); launchTerminalSession(project, groupId); };
  popover.appendChild(termBtn);

  document.body.appendChild(popover);
  const rect = anchorEl.getBoundingClientRect();
  const popoverHeight = popover.offsetHeight;
  if (rect.bottom + 4 + popoverHeight > window.innerHeight) {
    popover.style.top = (rect.top - popoverHeight - 4) + 'px';
  } else {
    popover.style.top = (rect.bottom + 4) + 'px';
  }
  popover.style.left = rect.left + 'px';

  // Close on click outside
  function onClickOutside(e) {
    if (!popover.contains(e.target) && e.target !== anchorEl) {
      popover.remove();
      document.removeEventListener('mousedown', onClickOutside);
    }
  }
  setTimeout(() => document.addEventListener('mousedown', onClickOutside), 0);
}

async function launchTerminalSession(project, groupId) {
  const sessionId = crypto.randomUUID();
  const projectPath = project.projectPath;
  const session = {
    sessionId,
    summary: 'Terminal',
    firstPrompt: '',
    projectPath,
    name: null,
    starred: 0,
    archived: 0,
    messageCount: 0,
    modified: new Date().toISOString(),
    created: new Date().toISOString(),
    type: 'terminal',
  };

  // Track as pending
  const folder = encodeProjectPath(projectPath);
  pendingSessions.set(sessionId, { session, projectPath, folder });

  // Inject into cached project data
  sessionMap.set(sessionId, session);
  for (const projList of [cachedProjects, cachedAllProjects]) {
    let proj = projList.find(p => p.projectPath === projectPath);
    if (!proj) {
      proj = { folder, projectPath, sessions: [] };
      projList.unshift(proj);
    }
    proj.sessions.unshift(session);
  }
  if (groupId && typeof assignSessionToGroup === 'function') {
    assignSessionToGroup(sessionId, groupId);
  } else {
    refreshSidebar();
  }

  const entry = createTerminalEntry(session);

  const result = await window.api.openTerminal(sessionId, projectPath, true, { type: 'terminal' });
  if (!result.ok) {
    entry.terminal.write(`\r\nError: ${result.error}\r\n`);
    entry.closed = true;
    return;
  }

  showSession(sessionId);
  pollActiveSessions();
}

async function showNewSessionDialog(project, groupId) {
  const effective = await window.api.getEffectiveSettings(project.projectPath);

  const overlay = document.createElement('div');
  overlay.className = 'new-session-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'new-session-dialog';

  let selectedMode = effective.permissionMode || null;
  let dangerousSkip = effective.dangerouslySkipPermissions || false;

  const modes = [
    { value: null, label: 'Default', desc: 'Prompt for all actions' },
    { value: 'acceptEdits', label: 'Accept Edits', desc: 'Auto-accept file edits, prompt for others' },
    { value: 'plan', label: 'Plan Mode', desc: 'Read-only exploration, no writes' },
    { value: 'dontAsk', label: "Don't Ask", desc: 'Auto-deny tools not explicitly allowed' },
    { value: 'bypassPermissions', label: 'Bypass', desc: 'Auto-accept all tool calls' },
  ];

  function renderModeGrid() {
    return modes.map(m => {
      const isSelected = !dangerousSkip && selectedMode === m.value;
      return `<button class="permission-option${isSelected ? ' selected' : ''}" data-mode="${m.value}"><span class="perm-name">${m.label}</span><span class="perm-desc">${m.desc}</span></button>`;
    }).join('') +
    `<button class="permission-option dangerous${dangerousSkip ? ' selected' : ''}" data-mode="dangerous-skip"><span class="perm-name">Dangerous Skip</span><span class="perm-desc">Skip all safety prompts (use with caution)</span></button>`;
  }

  dialog.innerHTML = `
    <h3>New Session — ${escapeHtml(project.projectPath.split('/').filter(Boolean).slice(-2).join('/'))}</h3>
    <div class="settings-field">
      <div class="settings-label">Permission Mode</div>
      <div class="permission-grid" id="nsd-mode-grid">${renderModeGrid()}</div>
    </div>
    <div class="settings-field">
      <div class="settings-field-info">
        <span class="settings-label">Worktree</span>
        <div class="settings-description">Run session in an isolated git worktree</div>
      </div>
      <div class="settings-field-control">
        <input type="text" class="settings-input" id="nsd-worktree-name" placeholder="name (optional)" value="${escapeHtml(effective.worktreeName || '')}" style="width:140px">
        <label class="settings-toggle"><input type="checkbox" id="nsd-worktree" ${effective.worktree ? 'checked' : ''}><span class="settings-toggle-slider"></span></label>
      </div>
    </div>
    <div class="settings-field">
      <div class="settings-field-info">
        <span class="settings-label">Chrome</span>
        <div class="settings-description">Enable Chrome browser automation</div>
      </div>
      <div class="settings-field-control">
        <label class="settings-toggle"><input type="checkbox" id="nsd-chrome" ${effective.chrome ? 'checked' : ''}><span class="settings-toggle-slider"></span></label>
      </div>
    </div>
    <div class="settings-field settings-field-wide">
      <div class="settings-field-info">
        <span class="settings-label">Pre-launch Command</span>
        <div class="settings-description">Prepended to the claude command</div>
      </div>
      <div class="settings-field-control">
        <input type="text" class="settings-input" id="nsd-pre-launch" placeholder="e.g. aws-vault exec profile --" value="${escapeHtml(effective.preLaunchCmd || '')}">
      </div>
    </div>
    <div class="settings-field settings-field-wide">
      <div class="settings-field-info">
        <span class="settings-label">Additional Directories</span>
        <div class="settings-description">Extra directories to include (comma-separated)</div>
      </div>
      <div class="settings-field-control">
        <input type="text" class="settings-input" id="nsd-add-dirs" placeholder="/path/to/dir1, /path/to/dir2" value="${escapeHtml(effective.addDirs || '')}">
      </div>
    </div>
    <div class="new-session-actions">
      <button class="new-session-cancel-btn">Cancel</button>
      <button class="new-session-start-btn">Start</button>
    </div>
  `;

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  // Bind mode grid clicks
  const modeGrid = dialog.querySelector('#nsd-mode-grid');
  modeGrid.addEventListener('click', (e) => {
    const btn = e.target.closest('.permission-option');
    if (!btn) return;
    const mode = btn.dataset.mode;
    if (mode === 'dangerous-skip') {
      dangerousSkip = !dangerousSkip;
      if (dangerousSkip) selectedMode = null;
    } else {
      dangerousSkip = false;
      selectedMode = mode === 'null' ? null : mode;
    }
    modeGrid.innerHTML = renderModeGrid();
  });

  function close() {
    overlay.remove();
  }

  function start() {
    const options = { runtime: 'claude' };
    if (dangerousSkip) {
      options.dangerouslySkipPermissions = true;
    } else if (selectedMode) {
      options.permissionMode = selectedMode;
    }
    if (dialog.querySelector('#nsd-worktree').checked) {
      options.worktree = true;
      options.worktreeName = dialog.querySelector('#nsd-worktree-name').value.trim();
    }
    if (dialog.querySelector('#nsd-chrome').checked) {
      options.chrome = true;
    }
    const preLaunch = dialog.querySelector('#nsd-pre-launch').value.trim();
    if (preLaunch) options.preLaunchCmd = preLaunch;
    options.addDirs = dialog.querySelector('#nsd-add-dirs').value.trim();
    if (effective.mcpEmulation === false) options.mcpEmulation = false;
    close();
    launchNewSession(project, options, undefined, groupId);
  }

  dialog.querySelector('.new-session-cancel-btn').onclick = close;
  dialog.querySelector('.new-session-start-btn').onclick = start;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  // Keyboard support
  function onKey(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); }
    if (e.key === 'Enter' && !e.shiftKey && e.target.tagName !== 'TEXTAREA') { start(); document.removeEventListener('keydown', onKey); }
  }
  document.addEventListener('keydown', onKey);
}

async function showNewPiSessionDialog(project, groupId) {
  const effective = await window.api.getEffectiveSettings(project.projectPath);

  const overlay = document.createElement('div');
  overlay.className = 'new-session-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'new-session-dialog';

  dialog.innerHTML = `
    <h3>New Pi Session — ${escapeHtml(project.projectPath.split('/').filter(Boolean).slice(-2).join('/'))}</h3>
    <div class="settings-field settings-field-wide">
      <div class="settings-field-info">
        <span class="settings-label">Session Name</span>
        <div class="settings-description">Optional display name (<code>pi --name</code>)</div>
      </div>
      <div class="settings-field-control">
        <input type="text" class="settings-input" id="nsd-pi-name" placeholder="e.g. Refactor auth module">
      </div>
    </div>
    <div class="settings-field settings-field-wide">
      <div class="settings-field-info">
        <span class="settings-label">Provider</span>
        <div class="settings-description">Leave blank to use Pi defaults</div>
      </div>
      <div class="settings-field-control">
        <input type="text" class="settings-input" id="nsd-pi-provider" placeholder="e.g. anthropic, google, openai" value="${escapeHtml(effective.piProvider || '')}">
      </div>
    </div>
    <div class="settings-field settings-field-wide">
      <div class="settings-field-info">
        <span class="settings-label">Model</span>
        <div class="settings-description">Model pattern or ID</div>
      </div>
      <div class="settings-field-control">
        <input type="text" class="settings-input" id="nsd-pi-model" placeholder="e.g. claude-sonnet-4-6" value="${escapeHtml(effective.piModel || '')}">
      </div>
    </div>
    <div class="settings-field settings-field-wide">
      <div class="settings-field-info">
        <span class="settings-label">Thinking</span>
        <div class="settings-description">off, minimal, low, medium, high, xhigh</div>
      </div>
      <div class="settings-field-control">
        <input type="text" class="settings-input" id="nsd-pi-thinking" placeholder="medium" value="${escapeHtml(effective.piThinking || '')}">
      </div>
    </div>
    <div class="settings-field settings-field-wide">
      <div class="settings-field-info">
        <span class="settings-label">Pre-launch Command</span>
        <div class="settings-description">Prepended to the <code>pi</code> command</div>
      </div>
      <div class="settings-field-control">
        <input type="text" class="settings-input" id="nsd-pi-pre-launch" placeholder="e.g. aws-vault exec profile --" value="${escapeHtml(effective.preLaunchCmd || '')}">
      </div>
    </div>
    <div class="new-session-actions">
      <button class="new-session-cancel-btn">Cancel</button>
      <button class="new-session-start-btn">Start</button>
    </div>
  `;

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  function close() {
    overlay.remove();
  }

  function start() {
    const options = { runtime: 'pi' };
    const name = dialog.querySelector('#nsd-pi-name').value.trim();
    const provider = dialog.querySelector('#nsd-pi-provider').value.trim();
    const model = dialog.querySelector('#nsd-pi-model').value.trim();
    const thinking = dialog.querySelector('#nsd-pi-thinking').value.trim();
    const preLaunch = dialog.querySelector('#nsd-pi-pre-launch').value.trim();
    if (name) options.name = name;
    if (provider) options.provider = provider;
    if (model) options.model = model;
    if (thinking) options.thinking = thinking;
    if (preLaunch) options.preLaunchCmd = preLaunch;
    close();
    launchNewSession(project, options, undefined, groupId);
  }

  dialog.querySelector('.new-session-cancel-btn').onclick = close;
  dialog.querySelector('.new-session-start-btn').onclick = start;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  function onKey(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); }
    if (e.key === 'Enter' && !e.shiftKey && e.target.tagName !== 'TEXTAREA') { start(); document.removeEventListener('keydown', onKey); }
  }
  document.addEventListener('keydown', onKey);
}

async function showNewOmpSessionDialog(project, groupId) {
  const effective = await window.api.getEffectiveSettings(project.projectPath);

  const overlay = document.createElement('div');
  overlay.className = 'new-session-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'new-session-dialog';

  dialog.innerHTML = `
    <h3>New omp Session — ${escapeHtml(project.projectPath.split('/').filter(Boolean).slice(-2).join('/'))}</h3>
    <div class="settings-field settings-field-wide">
      <div class="settings-field-info">
        <span class="settings-label">Provider</span>
        <div class="settings-description">Leave blank to use omp defaults</div>
      </div>
      <div class="settings-field-control">
        <input type="text" class="settings-input" id="nsd-omp-provider" placeholder="e.g. anthropic, google, openai" value="${escapeHtml(effective.ompProvider || '')}">
      </div>
    </div>
    <div class="settings-field settings-field-wide">
      <div class="settings-field-info">
        <span class="settings-label">Model</span>
        <div class="settings-description">Model pattern or ID</div>
      </div>
      <div class="settings-field-control">
        <input type="text" class="settings-input" id="nsd-omp-model" placeholder="e.g. claude-sonnet-4-6" value="${escapeHtml(effective.ompModel || '')}">
      </div>
    </div>
    <div class="settings-field settings-field-wide">
      <div class="settings-field-info">
        <span class="settings-label">Thinking</span>
        <div class="settings-description">off, minimal, low, medium, high, xhigh</div>
      </div>
      <div class="settings-field-control">
        <input type="text" class="settings-input" id="nsd-omp-thinking" placeholder="medium" value="${escapeHtml(effective.ompThinking || '')}">
      </div>
    </div>
    <div class="settings-field settings-field-wide">
      <div class="settings-field-info">
        <span class="settings-label">Pre-launch Command</span>
        <div class="settings-description">Prepended to the <code>omp</code> command</div>
      </div>
      <div class="settings-field-control">
        <input type="text" class="settings-input" id="nsd-omp-pre-launch" placeholder="e.g. aws-vault exec profile --" value="${escapeHtml(effective.preLaunchCmd || '')}">
      </div>
    </div>
    <div class="new-session-actions">
      <button class="new-session-cancel-btn">Cancel</button>
      <button class="new-session-start-btn">Start</button>
    </div>
  `;

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  function close() {
    overlay.remove();
  }

  function start() {
    const options = { runtime: 'omp' };
    const provider = dialog.querySelector('#nsd-omp-provider').value.trim();
    const model = dialog.querySelector('#nsd-omp-model').value.trim();
    const thinking = dialog.querySelector('#nsd-omp-thinking').value.trim();
    const preLaunch = dialog.querySelector('#nsd-omp-pre-launch').value.trim();
    if (provider) options.provider = provider;
    if (model) options.model = model;
    if (thinking) options.thinking = thinking;
    if (preLaunch) options.preLaunchCmd = preLaunch;
    close();
    launchNewSession(project, options, undefined, groupId);
  }

  dialog.querySelector('.new-session-cancel-btn').onclick = close;
  dialog.querySelector('.new-session-start-btn').onclick = start;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  function onKey(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); }
    if (e.key === 'Enter' && !e.shiftKey && e.target.tagName !== 'TEXTAREA') { start(); document.removeEventListener('keydown', onKey); }
  }
  document.addEventListener('keydown', onKey);
}

async function showResumeSessionDialog(session) {
  const runtimeId = session.runtime || 'claude';
  const runtimeUi = getAgentRuntimeUi(runtimeId);
  if (runtimeUi.id !== 'claude') {
    const options = await resolveLaunchOptions(runtimeUi.id, { projectPath: session.projectPath });
    openSession(session, options);
    return;
  }

  const effective = await window.api.getEffectiveSettings(session.projectPath);

  const overlay = document.createElement('div');
  overlay.className = 'new-session-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'new-session-dialog';

  let selectedMode = effective.permissionMode || null;
  let dangerousSkip = effective.dangerouslySkipPermissions || false;

  const modes = [
    { value: null, label: 'Default', desc: 'Prompt for all actions' },
    { value: 'acceptEdits', label: 'Accept Edits', desc: 'Auto-accept file edits, prompt for others' },
    { value: 'plan', label: 'Plan Mode', desc: 'Read-only exploration, no writes' },
    { value: 'dontAsk', label: "Don't Ask", desc: 'Auto-deny tools not explicitly allowed' },
    { value: 'bypassPermissions', label: 'Bypass', desc: 'Auto-accept all tool calls' },
  ];

  function renderModeGrid() {
    return modes.map(m => {
      const isSelected = !dangerousSkip && selectedMode === m.value;
      return `<button class="permission-option${isSelected ? ' selected' : ''}" data-mode="${m.value}"><span class="perm-name">${m.label}</span><span class="perm-desc">${m.desc}</span></button>`;
    }).join('') +
    `<button class="permission-option dangerous${dangerousSkip ? ' selected' : ''}" data-mode="dangerous-skip"><span class="perm-name">Dangerous Skip</span><span class="perm-desc">Skip all safety prompts (use with caution)</span></button>`;
  }

  const sessionName = session.name || session.aiTitle || session.summary || session.sessionId.slice(0, 8);

  dialog.innerHTML = `
    <h3>Resume Session — ${escapeHtml(sessionName)}</h3>
    <div class="settings-field">
      <div class="settings-label">Permission Mode</div>
      <div class="permission-grid" id="rsd-mode-grid">${renderModeGrid()}</div>
    </div>
    <div class="settings-field">
      <div class="settings-field-info">
        <span class="settings-label">Chrome</span>
        <div class="settings-description">Enable Chrome browser automation</div>
      </div>
      <div class="settings-field-control">
        <label class="settings-toggle"><input type="checkbox" id="rsd-chrome" ${effective.chrome ? 'checked' : ''}><span class="settings-toggle-slider"></span></label>
      </div>
    </div>
    <div class="settings-field settings-field-wide">
      <div class="settings-field-info">
        <span class="settings-label">Pre-launch Command</span>
        <div class="settings-description">Prepended to the claude command</div>
      </div>
      <div class="settings-field-control">
        <input type="text" class="settings-input" id="rsd-pre-launch" placeholder="e.g. aws-vault exec profile --" value="${escapeHtml(effective.preLaunchCmd || '')}">
      </div>
    </div>
    <div class="settings-field settings-field-wide">
      <div class="settings-field-info">
        <span class="settings-label">Additional Directories</span>
        <div class="settings-description">Extra directories to include (comma-separated)</div>
      </div>
      <div class="settings-field-control">
        <input type="text" class="settings-input" id="rsd-add-dirs" placeholder="/path/to/dir1, /path/to/dir2" value="${escapeHtml(effective.addDirs || '')}">
      </div>
    </div>
    <div class="new-session-actions">
      <button class="new-session-cancel-btn">Cancel</button>
      <button class="new-session-start-btn">Resume</button>
    </div>
  `;

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  // Bind mode grid clicks
  const modeGrid = dialog.querySelector('#rsd-mode-grid');
  modeGrid.addEventListener('click', (e) => {
    const btn = e.target.closest('.permission-option');
    if (!btn) return;
    const mode = btn.dataset.mode;
    if (mode === 'dangerous-skip') {
      dangerousSkip = !dangerousSkip;
      if (dangerousSkip) selectedMode = null;
    } else {
      dangerousSkip = false;
      selectedMode = mode === 'null' ? null : mode;
    }
    modeGrid.innerHTML = renderModeGrid();
  });

  function close() {
    overlay.remove();
  }

  function resume() {
    const options = { runtime: 'claude' };
    if (dangerousSkip) {
      options.dangerouslySkipPermissions = true;
    } else if (selectedMode) {
      options.permissionMode = selectedMode;
    }
    if (dialog.querySelector('#rsd-chrome').checked) {
      options.chrome = true;
    }
    const preLaunch = dialog.querySelector('#rsd-pre-launch').value.trim();
    if (preLaunch) options.preLaunchCmd = preLaunch;
    options.addDirs = dialog.querySelector('#rsd-add-dirs').value.trim();
    if (effective.mcpEmulation === false) options.mcpEmulation = false;
    close();
    openSession(session, options);
  }

  dialog.querySelector('.new-session-cancel-btn').onclick = close;
  dialog.querySelector('.new-session-start-btn').onclick = resume;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  function onKey(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); }
    if (e.key === 'Enter' && !e.target.matches('input')) { resume(); document.removeEventListener('keydown', onKey); }
  }
  document.addEventListener('keydown', onKey);
}

// Settings viewer is in settings-panel.js (openSettingsViewer / closeSettingsViewer)
// Global settings button & add project button bindings are in app.js (need DOM refs)

function showAddProjectDialog() {
  const overlay = document.createElement('div');
  overlay.className = 'add-project-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'add-project-dialog';

  dialog.innerHTML = `
    <h3>Add Project</h3>
    <div class="add-project-hint">Select a folder to create a new project. To start a session in an existing project, use the + on its project header.</div>
    <div class="folder-input-row">
      <input type="text" id="add-project-path" placeholder="/path/to/project" autocomplete="off" spellcheck="false">
      <button class="add-project-browse-btn">Browse</button>
    </div>
    <div class="add-project-error" id="add-project-error"></div>
    <div class="add-project-actions">
      <button class="add-project-cancel-btn">Cancel</button>
      <button class="add-project-add-btn">Add</button>
    </div>
  `;

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  const pathInput = dialog.querySelector('#add-project-path');
  const errorEl = dialog.querySelector('#add-project-error');
  pathInput.focus();

  function close() {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  }

  async function addProject() {
    const projectPath = pathInput.value.trim();
    if (!projectPath) {
      errorEl.textContent = 'Please enter a folder path.';
      errorEl.style.display = 'block';
      return;
    }
    errorEl.style.display = 'none';
    const result = await window.api.addProject(projectPath);
    if (result.error) {
      errorEl.textContent = result.error;
      errorEl.style.display = 'block';
      return;
    }
    close();

    await loadProjects();
  }

  dialog.querySelector('.add-project-browse-btn').onclick = async () => {
    const folder = await window.api.browseFolder();
    if (folder) pathInput.value = folder;
  };

  dialog.querySelector('.add-project-cancel-btn').onclick = close;
  dialog.querySelector('.add-project-add-btn').onclick = addProject;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  function onKey(e) {
    if (e.key === 'Escape') close();
    if (e.key === 'Enter') addProject();
  }
  document.addEventListener('keydown', onKey);
}
