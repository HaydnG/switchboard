const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const { readPiSessionFile } = require('../read-pi-session-file');
const { sessionIdFromPiFilename } = require('../pi-session-path');

describe('readPiSessionFile', () => {
  it('parses a real Pi session when present', () => {
    const home = os.homedir();
    const folder = '--Users-haydngynn-Projects-claudeProject--';
    const dir = path.join(home, '.pi', 'agent', 'sessions', folder);
    const fs = require('fs');
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl'));
    if (files.length === 0) return;

    const filePath = path.join(dir, files[0]);
    const session = readPiSessionFile(filePath, folder, '/Users/haydngynn/Projects/claudeProject');
    assert.ok(session);
    assert.equal(session.runtime, 'pi');
    assert.equal(session.sessionId, sessionIdFromPiFilename(files[0]));
    assert.ok(session.summary.length > 0);
    assert.ok(session.messageCount >= 1);
  });
});

describe('sessionIdFromPiFilename', () => {
  it('extracts uuid suffix from Pi filenames', () => {
    assert.equal(
      sessionIdFromPiFilename('2026-07-02T08-43-36-035Z_019f21ff-6ee3-7235-9cba-fb3084a5dcf1.jsonl'),
      '019f21ff-6ee3-7235-9cba-fb3084a5dcf1'
    );
  });
});
