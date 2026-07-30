(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    Object.assign(root, factory());
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const ONBOARDING_KEY = 'switchboardProductivityOnboardingV1';
  const SHORTCUTS = [
    { keys: ['Mod', 'K'], label: 'Search sessions, plans, files, and commands' },
    { keys: ['Mod', 'Shift', 'A'], label: 'Focus the next session needing attention' },
    { keys: ['Mod', 'Shift', 'G'], label: 'Toggle the session overview' },
    { keys: ['Mod', 'F'], label: 'Find in the current terminal or file' },
    { keys: ['Mod', 'Shift', '[ / ]'], label: 'Move between open sessions' },
    { keys: ['?'], label: 'Open this shortcut reference' },
  ];

  function shortcutLabel(keys, platform = '') {
    const modifier = platform === 'darwin' ? '⌘' : 'Ctrl';
    return keys
      .map(key => {
        if (key === 'Mod') return modifier;
        if (key === 'Shift') return platform === 'darwin' ? '⇧' : 'Shift';
        return key;
      })
      .join(platform === 'darwin' ? '' : '+');
  }

  function getShortcutReference(platform) {
    return SHORTCUTS.map(shortcut => ({
      ...shortcut,
      display: shortcutLabel(shortcut.keys, platform),
    }));
  }

  function shouldShowProductivityOnboarding(value, sessionCount) {
    return value !== 'done' && Number(sessionCount || 0) <= 1;
  }

  function createHelpOverlay(title) {
    const overlay = document.createElement('div');
    overlay.className = 'new-session-overlay productivity-help-overlay';
    const dialog = document.createElement('div');
    dialog.className = 'new-session-dialog productivity-help-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'productivity-help-title');
    dialog.innerHTML = `
      <div class="productivity-help-header">
        <div>
          <span class="productivity-help-kicker">Switchboard</span>
          <h3 id="productivity-help-title">${title}</h3>
        </div>
        <button type="button" class="productivity-help-close" aria-label="Close">×</button>
      </div>
      <div class="productivity-help-content"></div>
    `;
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    const close = () => {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
    };
    const onKey = event => {
      if (event.key === 'Escape') close();
    };
    dialog.querySelector('.productivity-help-close').onclick = close;
    overlay.addEventListener('click', event => {
      if (event.target === overlay) close();
    });
    document.addEventListener('keydown', onKey);
    return { overlay, dialog, content: dialog.querySelector('.productivity-help-content'), close };
  }

  function showShortcutReference(platform = window.api?.platform) {
    const { content } = createHelpOverlay('Keyboard shortcuts');
    const list = document.createElement('div');
    list.className = 'shortcut-reference-list';
    for (const shortcut of getShortcutReference(platform)) {
      const row = document.createElement('div');
      row.className = 'shortcut-reference-row';
      const keys = document.createElement('kbd');
      keys.textContent = shortcut.display;
      const label = document.createElement('span');
      label.textContent = shortcut.label;
      row.append(keys, label);
      list.appendChild(row);
    }
    content.appendChild(list);
  }

  function showProductivityOnboarding() {
    const { content, close } = createHelpOverlay('Your local agent command center');
    content.innerHTML = `
      <p class="productivity-help-lede">Switchboard keeps every session local while helping you find, supervise, and continue work quickly.</p>
      <div class="productivity-onboarding-grid">
        <section><strong>Find anything</strong><span>Press Cmd/Ctrl+K to search transcript context, plans, files, and actions.</span></section>
        <section><strong>Work the queue</strong><span>Attention status, native notifications, and Focus next keep agents from waiting.</span></section>
        <section><strong>Move clean context</strong><span>Review a handoff or context packet before starting or prompting another session.</span></section>
      </div>
      <div class="new-session-actions">
        <button type="button" class="new-session-cancel-btn onboarding-shortcuts">View shortcuts</button>
        <button type="button" class="new-session-start-btn onboarding-done">Start using Switchboard</button>
      </div>
    `;
    content.querySelector('.onboarding-shortcuts').onclick = () => {
      close();
      showShortcutReference();
    };
    content.querySelector('.onboarding-done').onclick = () => {
      try {
        localStorage.setItem(ONBOARDING_KEY, 'done');
      } catch {}
      close();
      document.getElementById('search-input')?.focus();
    };
  }

  function maybeShowProductivityOnboarding(sessionCount) {
    let value = null;
    try {
      value = localStorage.getItem(ONBOARDING_KEY);
    } catch {}
    if (shouldShowProductivityOnboarding(value, sessionCount)) {
      setTimeout(showProductivityOnboarding, 250);
      return true;
    }
    return false;
  }

  return {
    ONBOARDING_KEY,
    SHORTCUTS,
    getShortcutReference,
    maybeShowProductivityOnboarding,
    shortcutLabel,
    shouldShowProductivityOnboarding,
    showProductivityOnboarding,
    showShortcutReference,
  };
});
