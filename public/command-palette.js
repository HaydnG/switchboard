// Cmd/Ctrl+K command palette: fuzzy-jump to any session or project and run
// app-level actions from the keyboard. Matching/ranking is pure and tested
// (command-palette-model.js); this file owns the overlay, keyboard loop, and
// the action registry. Globals (sessionMap, cachedProjects, openSession, …)
// are owned by app.js/sidebar.js and read lazily at open time.

let paletteOverlayEl = null;
let paletteEntries = [];
let paletteSelected = 0;

function paletteActionRegistry() {
  return [
    { id: 'toggle-grid', title: 'Toggle session overview', keywords: ['grid', 'overview', 'cards'], run: () => toggleGridView() },
    { id: 'focus-next', title: 'Focus next attention', keywords: ['attention', 'next', 'inbox', 'needs you'], run: () => focusNextAttention() },
    { id: 'global-settings', title: 'Open global settings', keywords: ['settings', 'preferences', 'options'], run: () => openSettingsViewer('global') },
    { id: 'add-project', title: 'Add project', keywords: ['project', 'new', 'folder'], run: () => showAddProjectDialog() },
    { id: 'spring-cleaning', title: 'Spring cleaning', keywords: ['cleanup', 'stale', 'clear'], run: () => document.getElementById('spring-cleaning-btn')?.click() },
    { id: 'resort', title: 'Re-sort sessions', keywords: ['sort', 'order', 'recent'], run: () => document.getElementById('resort-btn')?.click() },
    { id: 'collapse-all', title: 'Collapse / expand all sections', keywords: ['fold', 'collapse', 'expand'], run: () => document.getElementById('collapse-all-toggle')?.click() },
  ];
}

// Sessions in recency order (palette default view = most recent first).
function paletteSessionEntries() {
  const runtimeState = { attentionSessions, responseReadySessions, sessionBusyState, activePtyIds, openSessions };
  const sessions = [...sessionMap.values()]
    .map(s => ({
      session: s,
      at: (lastActivityTime.get(s.sessionId) || new Date(s.modified || 0)).getTime() || 0,
    }))
    .sort((a, b) => b.at - a.at)
    .slice(0, 400);
  return sessions.map(({ session }) => {
    const group = typeof getGroupForSession === 'function' && typeof groupsState !== 'undefined'
      ? getGroupForSession(groupsState, session.sessionId)
      : null;
    const sessionStatus = getSessionStatus(session, runtimeState);
    return {
      sessionId: session.sessionId,
      name: cleanDisplayName(session.name || session.aiTitle || session.summary) || session.sessionId,
      projectPath: session.projectPath || '',
      status: sessionStatus.key,
      statusLabel: sessionStatus.key === 'exited' ? 'Closed' : sessionStatus.label,
      runtime: session.runtime || 'claude',
      groupName: group?.name || '',
      groupColor: group?.color || '',
      session,
    };
  });
}

function paletteGroupEntries() {
  if (typeof groupsState === 'undefined' || !Array.isArray(groupsState.groups)) return [];
  const counts = new Map();
  for (const groupId of Object.values(groupsState.assignments || {})) {
    counts.set(groupId, (counts.get(groupId) || 0) + 1);
  }
  return [...groupsState.groups]
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map(group => ({
      id: group.id,
      name: group.name,
      color: group.color,
      sessionCount: counts.get(group.id) || 0,
      group,
    }));
}

function buildPaletteEntryList(query) {
  const sessions = paletteSessionEntries();
  const groups = paletteGroupEntries();
  const projects = [...cachedProjects].map(p => ({ path: p.projectPath, name: (p.projectPath || '').split('/').filter(Boolean).slice(-1)[0] || p.projectPath, project: p }));
  const actions = paletteActionRegistry();

  const items = buildPaletteItems({
    sessions,
    groups,
    projects,
    actions: actions.map(a => ({ id: a.id, title: a.title, keywords: a.keywords })),
  });
  // Re-attach live handles the pure model stripped.
  const bySessionId = new Map(sessions.map(s => [s.sessionId, s.session]));
  const byGroupId = new Map(groups.map(g => [g.id, g.group]));
  const byProjectPath = new Map(projects.map(p => [p.path, p.project]));
  const byActionId = new Map(actions.map(a => [a.id, a]));
  for (const item of items) {
    if (item.kind === 'session') item.run = () => openSession(bySessionId.get(item.data.sessionId));
    else if (item.kind === 'group') item.run = () => revealGroupInSidebar(byGroupId.get(item.data.id));
    else if (item.kind === 'project') item.run = () => revealProjectInSidebar(byProjectPath.get(item.data.path));
    else if (item.kind === 'action') item.run = () => byActionId.get(item.data.id)?.run();
  }
  return rankPaletteItems(query, items, { limit: 12 });
}

// Scroll the sidebar to a project header and flash it.
function revealProjectInSidebar(project) {
  if (!project) return;
  const header = document.getElementById('ph-' + folderId(project.projectPath));
  if (!header) return;
  header.scrollIntoView({ block: 'center' });
  header.classList.add('palette-reveal-flash');
  setTimeout(() => header.classList.remove('palette-reveal-flash'), 1200);
}

// Scroll the sidebar to a user-defined group and flash it.
function revealGroupInSidebar(group) {
  if (!group) return;
  const el = document.getElementById(groupDomId(group.id));
  if (!el) return;
  if (el.classList.contains('collapsed')) {
    el.classList.remove('collapsed');
    saveCollapsedGroups();
  }
  el.scrollIntoView({ block: 'center' });
  el.classList.add('palette-reveal-flash');
  setTimeout(() => el.classList.remove('palette-reveal-flash'), 1200);
}

const PALETTE_KIND_BADGE = { session: 'Session', group: 'Group', project: 'Project', action: 'Action' };

function renderPaletteResults(query) {
  paletteEntries = buildPaletteEntryList(query);
  paletteSelected = Math.min(paletteSelected, Math.max(0, paletteEntries.length - 1));
  const list = paletteOverlayEl.querySelector('.command-palette-list');
  list.innerHTML = '';
  if (paletteEntries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'command-palette-empty';
    empty.textContent = 'No matches';
    list.appendChild(empty);
    return;
  }
  paletteEntries.forEach((entry, i) => {
    const row = document.createElement('div');
    row.className = 'command-palette-item' + (i === paletteSelected ? ' selected' : '');
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', i === paletteSelected ? 'true' : 'false');
    const badge = document.createElement('span');
    badge.className = `command-palette-badge kind-${entry.kind}`;
    badge.textContent = PALETTE_KIND_BADGE[entry.kind] || entry.kind;
    const title = document.createElement('span');
    title.className = 'command-palette-title';
    title.textContent = entry.title;
    row.appendChild(badge);
    row.appendChild(title);
    if (entry.statusLabel) {
      const status = document.createElement('span');
      status.className = `command-palette-status status-${entry.statusKey}`;
      status.textContent = entry.statusLabel;
      row.appendChild(status);
    }
    if (entry.subtitle || entry.groupColor) {
      const sub = document.createElement('span');
      sub.className = 'command-palette-subtitle';
      if (entry.groupColor) {
        const dot = document.createElement('span');
        dot.className = 'command-palette-group-dot';
        dot.style.background = entry.groupColor;
        sub.appendChild(dot);
      }
      if (entry.subtitle) {
        const text = document.createElement('span');
        text.textContent = entry.subtitle;
        sub.appendChild(text);
      }
      row.appendChild(sub);
    }
    row.addEventListener('mousedown', (e) => e.preventDefault()); // keep input focus
    row.addEventListener('click', () => executePaletteEntry(entry));
    row.addEventListener('mousemove', () => {
      if (paletteSelected !== i) {
        paletteSelected = i;
        updatePaletteSelection();
      }
    });
    list.appendChild(row);
  });
}

function updatePaletteSelection() {
  const rows = paletteOverlayEl.querySelectorAll('.command-palette-item');
  rows.forEach((row, i) => {
    row.classList.toggle('selected', i === paletteSelected);
    row.setAttribute('aria-selected', i === paletteSelected ? 'true' : 'false');
    if (i === paletteSelected) row.scrollIntoView({ block: 'nearest' });
  });
}

function executePaletteEntry(entry) {
  closeCommandPalette();
  entry?.run?.();
}

function closeCommandPalette() {
  if (!paletteOverlayEl) return;
  paletteOverlayEl.remove();
  paletteOverlayEl = null;
  paletteEntries = [];
  paletteSelected = 0;
}

function openCommandPalette() {
  if (paletteOverlayEl) return;
  const overlay = document.createElement('div');
  overlay.className = 'command-palette-overlay';
  overlay.innerHTML = `
    <div class="command-palette" role="dialog" aria-label="Command palette">
      <input type="text" class="command-palette-input" placeholder="Jump to a session, group, project, or action…" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="true">
      <div class="command-palette-list" role="listbox"></div>
    </div>
  `;
  document.body.appendChild(overlay);
  paletteOverlayEl = overlay;

  const input = overlay.querySelector('.command-palette-input');
  input.addEventListener('input', () => {
    paletteSelected = 0;
    renderPaletteResults(input.value);
  });
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); closeCommandPalette(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); if (paletteEntries.length) { paletteSelected = (paletteSelected + 1) % paletteEntries.length; updatePaletteSelection(); } }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (paletteEntries.length) { paletteSelected = (paletteSelected - 1 + paletteEntries.length) % paletteEntries.length; updatePaletteSelection(); } }
    else if (e.key === 'Enter') { e.preventDefault(); executePaletteEntry(paletteEntries[paletteSelected]); }
  });
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) closeCommandPalette();
  });

  renderPaletteResults('');
  input.focus();
}

function toggleCommandPalette() {
  if (paletteOverlayEl) closeCommandPalette();
  else openCommandPalette();
}
