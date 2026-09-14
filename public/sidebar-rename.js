(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    Object.assign(root, factory());
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  // Persist a typed name only when it differs from the auto title (AI / JSONL /
  // first-prompt fallback). Empty or unchanged values clear the manual override
  // so JSONL titles can surface again.
  function sessionNameToPersist(inputValue, fallback) {
    const newName = String(inputValue || '').trim();
    const autoTitle = String(fallback || '').trim();
    if (!newName || newName === autoTitle) return null;
    return newName;
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
    isRenameUiEvent,
    isRenameInputActive,
  };
});
