const test = require('node:test');
const assert = require('node:assert/strict');

const { captureTerminalScroll, restoreTerminalScroll } = require('../public/terminal-scroll');

function makeTerminal({ viewportY, baseY }) {
  return {
    buffer: { active: { viewportY, baseY } },
    scrollToBottomCalls: 0,
    scrollLinesArgs: [],
    scrollToBottom() {
      this.scrollToBottomCalls += 1;
      this.buffer.active.viewportY = this.buffer.active.baseY;
    },
    scrollLines(delta) {
      this.scrollLinesArgs.push(delta);
      this.buffer.active.viewportY += delta;
    },
  };
}

test('captureTerminalScroll records whether the viewport is pinned to the bottom', () => {
  assert.deepEqual(
    captureTerminalScroll(makeTerminal({ viewportY: 40, baseY: 40 })),
    { wasAtBottom: true, viewportY: 40 },
  );
  assert.deepEqual(
    captureTerminalScroll(makeTerminal({ viewportY: 12, baseY: 40 })),
    { wasAtBottom: false, viewportY: 12 },
  );
});

test('restoreTerminalScroll pins the viewport to the bottom after a resize', () => {
  const terminal = makeTerminal({ viewportY: 40, baseY: 40 });
  const snapshot = captureTerminalScroll(terminal);
  terminal.buffer.active.viewportY = 0;
  restoreTerminalScroll(terminal, snapshot);
  assert.equal(terminal.scrollToBottomCalls, 1);
  assert.equal(terminal.buffer.active.viewportY, 40);
  assert.deepEqual(terminal.scrollLinesArgs, []);
});

test('restoreTerminalScroll keeps a mid-history viewport after a resize reset', () => {
  const terminal = makeTerminal({ viewportY: 12, baseY: 40 });
  const snapshot = captureTerminalScroll(terminal);
  terminal.buffer.active.viewportY = 0;
  restoreTerminalScroll(terminal, snapshot);
  assert.equal(terminal.scrollToBottomCalls, 0);
  assert.deepEqual(terminal.scrollLinesArgs, [12]);
  assert.equal(terminal.buffer.active.viewportY, 12);
});
