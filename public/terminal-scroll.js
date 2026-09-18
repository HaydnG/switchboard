(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    Object.assign(root, factory());
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  function captureTerminalScroll(terminal) {
    const buf = terminal && terminal.buffer && terminal.buffer.active;
    if (!buf) return { wasAtBottom: true, viewportY: 0 };
    return {
      wasAtBottom: buf.viewportY >= buf.baseY,
      viewportY: buf.viewportY,
    };
  }

  function restoreTerminalScroll(terminal, snapshot) {
    if (!terminal || !snapshot) return;
    if (snapshot.wasAtBottom) {
      if (typeof terminal.scrollToBottom === 'function') terminal.scrollToBottom();
      return;
    }
    const buf = terminal.buffer && terminal.buffer.active;
    if (!buf || typeof terminal.scrollLines !== 'function') return;
    terminal.scrollLines(snapshot.viewportY - buf.viewportY);
  }

  return {
    captureTerminalScroll,
    restoreTerminalScroll,
  };
});
