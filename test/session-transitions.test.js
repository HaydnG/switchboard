const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { readNewSessionSignals, init, emitSessionForked } = require('../session-transitions');

test('readNewSessionSignals skips malformed JSONL lines instead of aborting', (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-transitions-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
  const filePath = path.join(tmpDir, 'session.jsonl');
  fs.writeFileSync(
    filePath,
    [
      '{not-json',
      JSON.stringify({ type: 'file-history-snapshot' }),
      JSON.stringify({ forkedFrom: { sessionId: 'parent-1' }, slug: 'handoff' }),
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' } }),
    ].join('\n') + '\n',
  );

  assert.deepEqual(readNewSessionSignals(filePath), {
    forkedFrom: 'parent-1',
    planContent: false,
    slug: 'handoff',
    parentSessionId: null,
    hasSnapshots: true,
  });
});

test('emitSessionForked copies session meta before notifying the renderer', () => {
  const copied = [];
  const sent = [];
  init({
    activeSessions: new Map(),
    getMainWindow: () => ({
      isDestroyed: () => false,
      webContents: { send(...args) { sent.push(args); } },
    }),
    log: console,
    rekeyMcpServer() {},
    copySessionMeta(fromId, toId) { copied.push([fromId, toId]); },
  });

  emitSessionForked('old-id', 'new-id');

  assert.deepEqual(copied, [['old-id', 'new-id']]);
  assert.deepEqual(sent, [['session-forked', 'old-id', 'new-id']]);
});
