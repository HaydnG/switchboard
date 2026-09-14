const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { getFolderIndexMtimeMs } = require('../folder-index-state');

test('folder index timestamp advances when an existing session file is appended', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-folder-index-'));

  try {
    const sessionPath = path.join(tmpDir, 'session.jsonl');
    fs.writeFileSync(sessionPath, '{"type":"user","message":"first"}\n', 'utf8');
    const beforeDate = new Date('2024-01-01T00:00:00Z');
    const afterDate = new Date('2024-01-02T00:00:00Z');
    fs.utimesSync(tmpDir, beforeDate, beforeDate);
    fs.utimesSync(sessionPath, beforeDate, beforeDate);

    const before = getFolderIndexMtimeMs(tmpDir);

    fs.appendFileSync(sessionPath, '{"type":"assistant","message":"second"}\n', 'utf8');
    fs.utimesSync(sessionPath, afterDate, afterDate);

    const after = getFolderIndexMtimeMs(tmpDir);

    assert.ok(after > before, `expected index mtime to increase (${before} -> ${after})`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
