// Cmd/Ctrl+K unified discovery: search sessions, plans, and agent files through
// the existing FTS API, or run app/session commands from the keyboard. Pure
// shaping/filtering lives in command-palette-model.js and unified-search-model.js.

let paletteOverlayEl = null;
let paletteEntries = [];
let paletteSelected = 0;
let paletteSearchTimer = null;
let paletteRequestId = 0;
let paletteMetadataPromise = null;
let paletteMode = 'results';
let paletteParentEntry = null;

const PALETTE_FILTERS_KEY = 'unifiedSearchFilters';
const PALETTE_SAVED_KEY = 'unifiedSavedSearches';

function readPaletteStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

let paletteFilters = normalizeSearchFilters(readPaletteStorage(PALETTE_FILTERS_KEY, null));
let paletteSavedSearches = deserializeSavedSearches(
  (() => {
    try {
      return localStorage.getItem(PALETTE_SAVED_KEY);
    } catch {
      return null;
    }
  })(),
);

function savePalettePreferences() {
  try {
    localStorage.setItem(PALETTE_FILTERS_KEY, JSON.stringify(paletteFilters));
    localStorage.setItem(PALETTE_SAVED_KEY, JSON.stringify(paletteSavedSearches));
  } catch {
    // Search remains usable when storage is unavailable.
  }
}

function paletteActionRegistry() {
  return [
    {
      id: 'toggle-grid',
      title: 'Toggle session overview',
      keywords: ['grid', 'overview', 'cards'],
      run: () => toggleGridView(),
    },
    {
      id: 'focus-next',
      title: 'Focus next attention',
      keywords: ['attention', 'next', 'inbox', 'needs you'],
      run: () => focusNextAttention(),
    },
    {
      id: 'global-settings',
      title: 'Open global settings',
      keywords: ['settings', 'preferences', 'options'],
      run: () => openSettingsViewer('global'),
    },
    {
      id: 'keyboard-shortcuts',
      title: 'Show keyboard shortcuts',
      keywords: ['keyboard', 'help', 'hotkeys', 'reference'],
      run: () => showShortcutReference(),
    },
    {
      id: 'add-project',
      title: 'Add project',
      keywords: ['project', 'new', 'folder'],
      run: () => showAddProjectDialog(),
    },
    {
      id: 'spring-cleaning',
      title: 'Spring cleaning',
      keywords: ['cleanup', 'stale', 'clear'],
      run: () => document.getElementById('spring-cleaning-btn')?.click(),
    },
    {
      id: 'resort',
      title: 'Re-sort sessions',
      keywords: ['sort', 'order', 'recent'],
      run: () => document.getElementById('resort-btn')?.click(),
    },
    {
      id: 'collapse-all',
      title: 'Collapse / expand all sections',
      keywords: ['fold', 'collapse', 'expand'],
      run: () => document.getElementById('collapse-all-toggle')?.click(),
    },
  ];
}

// Sessions in recency order (palette default view = most recent first). FTS
// search asks for the complete set so old matching sessions are not dropped.
function paletteSessionEntries({ limit = 400 } = {}) {
  const runtimeState = {
    attentionSessions,
    responseReadySessions,
    sessionBusyState,
    activePtyIds,
    openSessions,
  };
  const sessions = [...sessionMap.values()]
    .map((s) => ({
      session: s,
      at: (lastActivityTime.get(s.sessionId) || new Date(s.modified || 0)).getTime() || 0,
    }))
    .sort((a, b) => b.at - a.at);
  const visibleSessions = Number.isFinite(limit) ? sessions.slice(0, limit) : sessions;
  return visibleSessions.map(({ session }) => {
    const group =
      typeof getGroupForSession === 'function' && typeof groupsState !== 'undefined'
        ? getGroupForSession(groupsState, session.sessionId)
        : null;
    const sessionStatus = getSessionStatus(session, runtimeState);
    const projectSegments = (session.projectPath || '').split('/').filter(Boolean).slice(-2);
    const pathLabel = projectSegments.join('/');
    return {
      sessionId: session.sessionId,
      name:
        cleanDisplayName(session.name || session.aiTitle || session.summary) || session.sessionId,
      projectPath: session.projectPath || '',
      subtitle: group?.name ? `${group.name} · ${pathLabel}` : pathLabel,
      status: sessionStatus.key,
      statusLabel: sessionStatus.key === 'exited' ? 'Closed' : sessionStatus.label,
      runtime: session.runtime || 'claude',
      groupName: group?.name || '',
      groupColor: group?.color || '',
      modified: session.modified || session.created || '',
      starred: !!session.starred,
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
    .map((group) => ({
      id: group.id,
      name: group.name,
      color: group.color,
      sessionCount: counts.get(group.id) || 0,
      group,
    }));
}

function paletteMemoryEntries() {
  if (typeof cachedMemoryData === 'undefined' || !cachedMemoryData) return [];
  return [
    ...(cachedMemoryData.global?.files || []),
    ...(cachedMemoryData.projects || []).flatMap((project) => project.files || []),
  ];
}

function buildPaletteUtilityItems(query) {
  const sessions = paletteSessionEntries();
  const groups = paletteGroupEntries();
  const projects = [...cachedProjects].map((project) => ({
    path: project.projectPath,
    name:
      (project.projectPath || '').split('/').filter(Boolean).slice(-1)[0] || project.projectPath,
    project,
  }));
  const actions = paletteActionRegistry();
  const items = buildPaletteItems({
    sessions,
    groups,
    projects,
    actions: actions.map((action) => ({
      id: action.id,
      title: action.title,
      keywords: action.keywords,
    })),
  });

  const bySessionId = new Map(sessions.map((session) => [session.sessionId, session.session]));
  const byGroupId = new Map(groups.map((group) => [group.id, group.group]));
  const byProjectPath = new Map(projects.map((project) => [project.path, project.project]));
  const byActionId = new Map(actions.map((action) => [action.id, action]));
  for (const item of items) {
    if (item.kind === 'session') {
      item.run = () => openSession(bySessionId.get(item.data.sessionId));
      item.session = bySessionId.get(item.data.sessionId);
    } else if (item.kind === 'group') {
      item.run = () => revealGroupInSidebar(byGroupId.get(item.data.id));
    } else if (item.kind === 'project') {
      item.run = () => revealProjectInSidebar(byProjectPath.get(item.data.path));
    } else if (item.kind === 'action') {
      item.run = () => byActionId.get(item.data.id)?.run();
    }
  }
  return rankPaletteItems(query, items, { limit: 12 });
}

async function ensurePaletteMetadata() {
  if (paletteMetadataPromise) return paletteMetadataPromise;
  paletteMetadataPromise = Promise.all([window.api.getPlans(), window.api.getMemories()])
    .then(([plans, memories]) => {
      cachedPlans = Array.isArray(plans) ? plans : [];
      cachedMemoryData = memories || { global: { files: [] }, projects: [] };
    })
    .catch((error) => {
      paletteMetadataPromise = null;
      throw error;
    });
  return paletteMetadataPromise;
}

function attachUnifiedSearchActions(items) {
  for (const item of items) {
    if (item.kind === 'session') {
      item.session = item.data.session;
      item.run = () => openSession(item.session);
    } else if (item.kind === 'plan') {
      item.run = () => openPlan(item.data);
    } else if (item.kind === 'memory') {
      item.run = () => openMemory(item.data);
    }
  }
  return items;
}

async function searchPalette(query) {
  const requestId = ++paletteRequestId;
  renderPaletteState('loading', 'Searching sessions, plans, and agent files…');
  try {
    await ensurePaletteMetadata();
    const selectedKinds = paletteFilters.kinds;
    const resultPairs = await Promise.all(
      selectedKinds.map(async (kind) => [
        kind,
        await window.api.search(kind, query, searchTitlesOnly),
      ]),
    );
    if (!paletteOverlayEl || requestId !== paletteRequestId) return;

    const results = Object.fromEntries(resultPairs);
    let items = buildUnifiedSearchItems({
      sessions: paletteSessionEntries({ limit: Infinity }),
      plans: cachedPlans,
      memories: paletteMemoryEntries(),
      results,
    });
    items = applyUnifiedSearchFilters(items, paletteFilters);
    items = interleaveUnifiedSearchItems(items, selectedKinds);
    attachUnifiedSearchActions(items);

    // Keep the legacy command/group/project discovery behavior. Smart filters
    // intentionally narrow the surface to sessions only.
    if (paletteFilters.smart.length === 0) {
      const utilities = buildPaletteUtilityItems(query).filter(
        (item) => item.kind !== 'session' || !items.some((result) => result.id === item.id),
      );
      items = [...items.slice(0, 42), ...utilities.slice(0, 8)];
    }
    renderPaletteEntries(items.slice(0, 50), query);
  } catch (error) {
    if (!paletteOverlayEl || requestId !== paletteRequestId) return;
    console.error('Unified search failed:', error);
    renderPaletteState('error', 'Search failed. Check the app logs and try again.');
  }
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

const PALETTE_KIND_BADGE = {
  session: 'Session',
  plan: 'Plan',
  memory: 'Agent file',
  group: 'Group',
  project: 'Project',
  action: 'Action',
  'session-action': 'Session',
};

const PALETTE_KIND_LABELS = {
  session: 'Sessions',
  plan: 'Plans',
  memory: 'Agent files',
};

const PALETTE_SMART_LABELS = {
  running: 'Running',
  attention: 'Needs attention',
  starred: 'Pinned',
  today: 'Today',
};

function renderFtsSnippet(snippet, target) {
  const segments = parseFtsSnippet(snippet);
  for (const segment of segments) {
    const node = segment.highlighted ? document.createElement('mark') : document.createTextNode('');
    node.textContent = segment.text;
    target.appendChild(node);
  }
}

function renderPaletteState(state, message) {
  if (!paletteOverlayEl) return;
  paletteEntries = [];
  paletteSelected = 0;
  const list = paletteOverlayEl.querySelector('.command-palette-list');
  const input = paletteOverlayEl.querySelector('.command-palette-input');
  list.innerHTML = '';
  list.setAttribute('role', 'status');
  list.setAttribute('aria-live', 'polite');
  input?.removeAttribute('aria-activedescendant');
  input?.setAttribute('aria-busy', state === 'loading' ? 'true' : 'false');

  const content = document.createElement('div');
  content.className = `command-palette-empty command-palette-state-${state}`;
  if (state === 'loading') {
    const spinner = document.createElement('span');
    spinner.className = 'command-palette-spinner';
    spinner.setAttribute('aria-hidden', 'true');
    content.appendChild(spinner);
  }
  const text = document.createElement('span');
  text.textContent = message;
  content.appendChild(text);
  if (state === 'error') {
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'btn command-palette-retry';
    retry.textContent = 'Retry';
    retry.addEventListener('click', () => {
      const query = paletteOverlayEl?.querySelector('.command-palette-input')?.value.trim();
      if (query) searchPalette(query);
    });
    content.appendChild(retry);
  }
  list.appendChild(content);
}

function renderPaletteEntries(entries, query) {
  if (!paletteOverlayEl) return;
  paletteEntries = entries;
  paletteSelected = Math.min(paletteSelected, Math.max(0, paletteEntries.length - 1));
  const list = paletteOverlayEl.querySelector('.command-palette-list');
  const input = paletteOverlayEl.querySelector('.command-palette-input');
  list.innerHTML = '';
  list.setAttribute('role', 'listbox');
  list.removeAttribute('aria-live');
  input?.setAttribute('aria-busy', 'false');
  if (paletteEntries.length === 0) {
    renderPaletteState(
      'empty',
      query
        ? 'No results across sessions, plans, or agent files.'
        : 'No items match the selected filters.',
    );
    return;
  }

  paletteEntries.forEach((entry, index) => {
    const row = document.createElement('div');
    row.id = `command-palette-option-${index}`;
    row.className = `command-palette-item kind-${entry.kind}${
      index === paletteSelected ? ' selected' : ''
    }`;
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', index === paletteSelected ? 'true' : 'false');
    const spokenSnippet = parseFtsSnippet(entry.snippet)
      .map((segment) => segment.text)
      .join('');
    row.setAttribute(
      'aria-label',
      [entry.title, entry.statusLabel, entry.subtitle, spokenSnippet].filter(Boolean).join(', '),
    );

    const badge = document.createElement('span');
    badge.className = `command-palette-badge kind-${entry.kind}`;
    badge.textContent = PALETTE_KIND_BADGE[entry.kind] || entry.kind;
    row.appendChild(badge);

    const content = document.createElement('span');
    content.className = 'command-palette-item-content';
    const heading = document.createElement('span');
    heading.className = 'command-palette-item-heading';
    const title = document.createElement('span');
    title.className = 'command-palette-title';
    title.textContent = entry.title;
    heading.appendChild(title);
    if (entry.statusLabel) {
      const status = document.createElement('span');
      status.className = `command-palette-status status-${entry.statusKey}`;
      status.textContent = entry.statusLabel;
      heading.appendChild(status);
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
      heading.appendChild(sub);
    }
    content.appendChild(heading);
    if (entry.snippet) {
      const snippet = document.createElement('span');
      snippet.className = 'command-palette-snippet';
      renderFtsSnippet(entry.snippet, snippet);
      content.appendChild(snippet);
    }
    row.appendChild(content);

    if (entry.kind === 'session' && paletteMode === 'results') {
      const actionHint = document.createElement('span');
      actionHint.className = 'command-palette-action-hint';
      actionHint.textContent = 'Actions →';
      actionHint.setAttribute('aria-hidden', 'true');
      actionHint.addEventListener('click', (event) => {
        event.stopPropagation();
        showPaletteSessionActions(entry);
      });
      row.appendChild(actionHint);
    }
    row.addEventListener('mousedown', (event) => event.preventDefault());
    row.addEventListener('click', () => executePaletteEntry(entry));
    row.addEventListener('mousemove', () => {
      if (paletteSelected !== index) {
        paletteSelected = index;
        updatePaletteSelection();
      }
    });
    list.appendChild(row);
  });
  updatePaletteSelection();
}

function updatePaletteSelection() {
  if (!paletteOverlayEl) return;
  const rows = paletteOverlayEl.querySelectorAll('.command-palette-item');
  const input = paletteOverlayEl.querySelector('.command-palette-input');
  rows.forEach((row, index) => {
    row.classList.toggle('selected', index === paletteSelected);
    row.setAttribute('aria-selected', index === paletteSelected ? 'true' : 'false');
    if (index === paletteSelected) {
      input?.setAttribute('aria-activedescendant', row.id);
      row.scrollIntoView({ block: 'nearest' });
    }
  });
}

function currentPaletteQuery() {
  return paletteOverlayEl?.querySelector('.command-palette-input')?.value || '';
}

function isDefaultPaletteFilter() {
  return (
    paletteFilters.smart.length === 0 &&
    SEARCH_KINDS.every((kind) => paletteFilters.kinds.includes(kind))
  );
}

function renderPaletteResults(query) {
  if (!paletteOverlayEl) return;
  paletteMode = 'results';
  paletteParentEntry = null;
  paletteOverlayEl.querySelector('.command-palette-context').hidden = true;
  paletteOverlayEl.querySelector('.command-palette-toolbar').hidden = false;
  paletteOverlayEl.querySelector('.command-palette-footer').textContent =
    '↑↓ navigate · Enter open · → session actions · Esc close';
  renderPaletteControls();

  const trimmed = query.trim();
  if (paletteSearchTimer) {
    clearTimeout(paletteSearchTimer);
    paletteSearchTimer = null;
  }
  if (!trimmed) {
    paletteRequestId += 1;
    if (isDefaultPaletteFilter()) {
      renderPaletteEntries(buildPaletteUtilityItems(''), '');
      return;
    }
    let items = buildUnifiedSearchItems({
      sessions: paletteSessionEntries(),
      plans: typeof cachedPlans === 'undefined' ? [] : cachedPlans,
      memories: paletteMemoryEntries(),
    });
    items = applyUnifiedSearchFilters(items, paletteFilters);
    attachUnifiedSearchActions(items);
    renderPaletteEntries(items.slice(0, 50), '');
    return;
  }
  renderPaletteState('loading', 'Searching sessions, plans, and agent files…');
  paletteSearchTimer = setTimeout(() => {
    paletteSearchTimer = null;
    searchPalette(trimmed);
  }, 140);
}

function togglePaletteKind(kind) {
  const nextKinds = paletteFilters.kinds.includes(kind)
    ? paletteFilters.kinds.filter((value) => value !== kind)
    : [...paletteFilters.kinds, kind];
  paletteFilters = normalizeSearchFilters({
    ...paletteFilters,
    kinds: nextKinds.length > 0 ? nextKinds : SEARCH_KINDS,
  });
  savePalettePreferences();
  paletteSelected = 0;
  renderPaletteResults(currentPaletteQuery());
}

function togglePaletteSmartFilter(filter) {
  const nextSmart = paletteFilters.smart.includes(filter)
    ? paletteFilters.smart.filter((value) => value !== filter)
    : [...paletteFilters.smart, filter];
  paletteFilters = normalizeSearchFilters({ ...paletteFilters, smart: nextSmart });
  savePalettePreferences();
  paletteSelected = 0;
  renderPaletteResults(currentPaletteQuery());
}

function applySavedPaletteSearch(saved) {
  const input = paletteOverlayEl?.querySelector('.command-palette-input');
  if (!input) return;
  paletteFilters = normalizeSearchFilters(saved.filters);
  searchTitlesOnly = !!saved.titleOnly;
  searchTitlesToggle?.classList.toggle('active', searchTitlesOnly);
  savePalettePreferences();
  input.value = saved.query;
  paletteSelected = 0;
  renderPaletteResults(saved.query);
  input.focus();
}

function saveCurrentPaletteSearch() {
  const query = currentPaletteQuery().trim();
  if (!query) return;
  paletteSavedSearches = upsertSavedSearch(paletteSavedSearches, {
    query,
    label: query,
    filters: paletteFilters,
    titleOnly: searchTitlesOnly,
  });
  savePalettePreferences();
  renderPaletteControls();
}

function renderPaletteControls() {
  if (!paletteOverlayEl || paletteMode !== 'results') return;
  const toolbar = paletteOverlayEl.querySelector('.command-palette-toolbar');
  toolbar.innerHTML = '';

  const kinds = document.createElement('div');
  kinds.className = 'command-palette-filter-group';
  kinds.setAttribute('role', 'group');
  kinds.setAttribute('aria-label', 'Result types');
  for (const kind of SEARCH_KINDS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'command-palette-filter';
    button.textContent = PALETTE_KIND_LABELS[kind];
    button.setAttribute('aria-pressed', paletteFilters.kinds.includes(kind) ? 'true' : 'false');
    button.addEventListener('click', () => togglePaletteKind(kind));
    kinds.appendChild(button);
  }
  toolbar.appendChild(kinds);

  const smart = document.createElement('div');
  smart.className = 'command-palette-filter-group command-palette-smart-filters';
  smart.setAttribute('role', 'group');
  smart.setAttribute('aria-label', 'Smart session filters');
  for (const filter of SMART_FILTERS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'command-palette-filter';
    button.textContent = PALETTE_SMART_LABELS[filter];
    button.setAttribute('aria-pressed', paletteFilters.smart.includes(filter) ? 'true' : 'false');
    button.addEventListener('click', () => togglePaletteSmartFilter(filter));
    smart.appendChild(button);
  }
  toolbar.appendChild(smart);

  const query = currentPaletteQuery().trim();
  if (query) {
    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'command-palette-filter command-palette-save';
    save.textContent = 'Save search';
    save.addEventListener('click', saveCurrentPaletteSearch);
    toolbar.appendChild(save);
  }

  if (paletteSavedSearches.length > 0) {
    const savedGroup = document.createElement('div');
    savedGroup.className = 'command-palette-saved';
    savedGroup.setAttribute('aria-label', 'Saved searches');
    for (const saved of paletteSavedSearches) {
      const wrapper = document.createElement('span');
      wrapper.className = 'command-palette-saved-item';
      const apply = document.createElement('button');
      apply.type = 'button';
      apply.className = 'command-palette-saved-apply';
      apply.textContent = saved.label;
      apply.title = `Search for ${saved.query}`;
      apply.addEventListener('click', () => applySavedPaletteSearch(saved));
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'command-palette-saved-remove';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `Delete saved search ${saved.label}`);
      remove.addEventListener('click', () => {
        paletteSavedSearches = paletteSavedSearches.filter((item) => item.id !== saved.id);
        savePalettePreferences();
        renderPaletteControls();
      });
      wrapper.appendChild(apply);
      wrapper.appendChild(remove);
      savedGroup.appendChild(wrapper);
    }
    toolbar.appendChild(savedGroup);
  }
}

function sessionActionRunner(command, session, project) {
  if (command === 'open') return () => openSession(session);
  if (command === 'timeline') return () => showTimelineViewer(session);
  if (command === 'messages') return () => showJsonlViewer(session);
  if (command === 'annotate') return () => showSessionAnnotationsDialog(session);
  if (command === 'fork') return () => forkSession(session, project);
  if (command === 'handoff') return () => showHandoffPrompt(session);
  if (command === 'transfer') return () => showContextTransferDialog(session);
  if (command === 'queue') return () => openPaletteQueueDialog(session);
  return () => {};
}

function showPaletteSessionActions(entry) {
  const session = entry?.session || entry?.data?.session;
  if (!session) return;
  const project =
    typeof findProjectForSession === 'function' ? findProjectForSession(session) : null;
  const commands = getSessionCommandDescriptors(session, {
    canFork: !!project && session.type !== 'terminal',
    canHandoff: session.type !== 'terminal',
    canTransfer: session.type !== 'terminal',
    canQueue: activePtyIds.has(session.sessionId) && typeof queuePromptForSession === 'function',
  });
  for (const command of commands) {
    command.subtitle = entry.title;
    command.run = sessionActionRunner(command.command, session, project);
  }
  paletteMode = 'session-actions';
  paletteParentEntry = entry;
  paletteSelected = 0;
  paletteOverlayEl.querySelector('.command-palette-toolbar').hidden = true;
  const context = paletteOverlayEl.querySelector('.command-palette-context');
  context.hidden = false;
  context.querySelector('.command-palette-context-title').textContent = entry.title;
  paletteOverlayEl.querySelector('.command-palette-footer').textContent =
    '← back · ↑↓ navigate · Enter run · Esc close';
  renderPaletteEntries(commands, '');
}

function leavePaletteSessionActions() {
  if (paletteMode !== 'session-actions') return;
  const query = currentPaletteQuery();
  paletteMode = 'results';
  paletteParentEntry = null;
  paletteSelected = 0;
  renderPaletteResults(query);
}

function openPaletteQueueDialog(session) {
  if (typeof queuePromptForSession !== 'function') return;
  const overlay = document.createElement('div');
  overlay.className = 'new-session-overlay palette-queue-overlay';
  const dialog = document.createElement('div');
  dialog.className = 'new-session-dialog palette-queue-dialog';
  const heading = document.createElement('h3');
  heading.textContent = 'Queue instruction';
  const hint = document.createElement('div');
  hint.className = 'add-project-hint';
  hint.textContent = `Deliver to ${
    cleanDisplayName(session.name || session.aiTitle || session.summary) || session.sessionId
  } when it can accept the next prompt.`;
  const textarea = document.createElement('textarea');
  textarea.className = 'settings-input';
  textarea.rows = 5;
  textarea.placeholder = 'Instruction for the next turn…';
  textarea.setAttribute('aria-label', 'Queued instruction');
  const actions = document.createElement('div');
  actions.className = 'new-session-actions';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'new-session-cancel-btn';
  cancel.textContent = 'Cancel';
  const submit = document.createElement('button');
  submit.type = 'button';
  submit.className = 'new-session-start-btn';
  submit.textContent = 'Queue';
  actions.appendChild(cancel);
  actions.appendChild(submit);
  dialog.appendChild(heading);
  dialog.appendChild(hint);
  dialog.appendChild(textarea);
  dialog.appendChild(actions);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  const close = () => {
    document.removeEventListener('keydown', onKey);
    overlay.remove();
  };
  const queue = () => {
    const text = textarea.value.trim();
    if (!text) return;
    queuePromptForSession(session.sessionId, text);
    close();
    showControlToast({ message: 'Instruction queued for the session.' });
  };
  const onKey = (event) => {
    if (event.key === 'Escape') close();
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) queue();
  };
  cancel.addEventListener('click', close);
  submit.addEventListener('click', queue);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });
  document.addEventListener('keydown', onKey);
  textarea.focus();
}

function executePaletteEntry(entry) {
  if (!entry) return;
  closeCommandPalette();
  entry.run?.();
}

function closeCommandPalette() {
  if (!paletteOverlayEl) return;
  if (paletteSearchTimer) clearTimeout(paletteSearchTimer);
  paletteSearchTimer = null;
  paletteRequestId += 1;
  paletteOverlayEl.remove();
  paletteOverlayEl = null;
  paletteEntries = [];
  paletteSelected = 0;
  paletteMode = 'results';
  paletteParentEntry = null;
}

function openCommandPalette() {
  if (paletteOverlayEl) return;
  const overlay = document.createElement('div');
  overlay.className = 'command-palette-overlay';
  overlay.innerHTML = `
    <div class="command-palette" role="dialog" aria-modal="true" aria-label="Unified search and commands">
      <input type="search" class="command-palette-input" placeholder="Search sessions, plans, agent files, or commands…" autocomplete="off" spellcheck="false" role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="command-palette-results">
      <div class="command-palette-toolbar" aria-label="Search filters"></div>
      <div class="command-palette-context" hidden>
        <button type="button" class="command-palette-back" aria-label="Back to search results">←</button>
        <span>Actions for <strong class="command-palette-context-title"></strong></span>
      </div>
      <div id="command-palette-results" class="command-palette-list" role="listbox"></div>
      <div class="command-palette-footer"></div>
    </div>
  `;
  document.body.appendChild(overlay);
  paletteOverlayEl = overlay;

  const input = overlay.querySelector('.command-palette-input');
  input.addEventListener('input', () => {
    paletteSelected = 0;
    renderPaletteResults(input.value);
  });
  input.addEventListener('keydown', (event) => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      closeCommandPalette();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (paletteEntries.length) {
        paletteSelected = (paletteSelected + 1) % paletteEntries.length;
        updatePaletteSelection();
      }
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (paletteEntries.length) {
        paletteSelected = (paletteSelected - 1 + paletteEntries.length) % paletteEntries.length;
        updatePaletteSelection();
      }
    } else if (event.key === 'ArrowRight') {
      const entry = paletteEntries[paletteSelected];
      if (paletteMode === 'results' && entry?.kind === 'session') {
        event.preventDefault();
        showPaletteSessionActions(entry);
      }
    } else if (event.key === 'ArrowLeft' && paletteMode === 'session-actions') {
      event.preventDefault();
      leavePaletteSessionActions();
    } else if (
      event.key === 'Backspace' &&
      paletteMode === 'session-actions' &&
      input.value.length === 0
    ) {
      event.preventDefault();
      leavePaletteSessionActions();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      executePaletteEntry(paletteEntries[paletteSelected]);
    }
  });
  overlay.querySelector('.command-palette-back').addEventListener('click', () => {
    leavePaletteSessionActions();
    input.focus();
  });
  overlay.addEventListener('mousedown', (event) => {
    if (event.target === overlay) closeCommandPalette();
  });

  renderPaletteResults('');
  input.focus();
}

function toggleCommandPalette() {
  if (paletteOverlayEl) closeCommandPalette();
  else openCommandPalette();
}
