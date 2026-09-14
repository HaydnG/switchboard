const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { readNewSessionSignals } = require('../session-transitions');

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
