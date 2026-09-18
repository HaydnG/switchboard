(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    Object.assign(root, factory());
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  // Persist whatever the user typed. Empty input is the only way to revert to
  // the auto title (AI / JSONL / first-prompt). Matching that auto title is a
  // valid manual name — clearing it would let later JSONL title changes win.
  function sessionNameToPersist(inputValue) {
    const newName = String(inputValue || '').trim();
    return newName || null;
  }

  // Keep an in-memory manual name when a project snapshot still has name: null
  // (rename IPC race, or a forked session id that has not copied session_meta).
  function preserveManualSessionName(existingName, incomingName) {
    const incoming = incomingName == null ? '' : String(incomingName).trim();
    if (incoming) return incoming;
    const existing = existingName == null ? '' : String(existingName).trim();
    return existing || null;
  }

  function isRenameUiEvent(target) {
    return !!(
      target &&
      typeof target.closest === 'function' &&
      target.closest('.session-summary, .session-rename-input, .group-rename-input')
    );
  }

  function isRenameInputActive(root) {
    const doc = root || (typeof document !== 'undefined' ? document : null);
    if (!doc || typeof doc.querySelector !== 'function') return false;
    return !!doc.querySelector('.session-rename-input, .group-rename-input');
  }

  return {
    sessionNameToPersist,
    preserveManualSessionName,
    isRenameUiEvent,
    isRenameInputActive,
  };
});
