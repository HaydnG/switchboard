const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { parseJsonlChunk, readJsonlFile } = require('../jsonl-read');

function writeTempJsonl(t, content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-jsonl-read-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, 'session.jsonl');
  fs.writeFileSync(filePath, content);
  return filePath;
}

test('parseJsonlChunk skips incomplete first line when asked', () => {
  const entries = parseJsonlChunk('{"id":"partial"}\n{"id":"ok"}\n', {
    skipIncompleteFirstLine: true,
  });
  assert.deepEqual(entries, [{ id: 'ok' }]);
});

test('small file returns all entries and is not truncated', (t) => {
  const filePath = writeTempJsonl(
    t,
    [JSON.stringify({ id: 'a' }), JSON.stringify({ id: 'b' })].join('\n') + '\n',
  );

  const result = readJsonlFile(filePath);
  assert.equal(result.truncated, false);
  assert.equal(result.returnedEntries, 2);
  assert.equal(result.totalBytes, fs.statSync(filePath).size);
  assert.deepEqual(result.entries, [{ id: 'a' }, { id: 'b' }]);
});

test('file larger than maxBytes parses only the tail and marks truncated', (t) => {
  const startLine = JSON.stringify({ id: 'only-at-start', pad: 'x'.repeat(400) }) + '\n';
  const tailLine = JSON.stringify({ id: 'tail' }) + '\n';
  const filePath = writeTempJsonl(t, startLine + tailLine);
  const maxBytes = Math.floor(startLine.length / 2) + tailLine.length;

  const result = readJsonlFile(filePath, { maxBytes, maxEntries: 50 });
  assert.equal(result.truncated, true);
  assert.equal(result.totalBytes, startLine.length + tailLine.length);
  assert.ok(result.entries.every((entry) => entry.id !== 'only-at-start'));
  assert.deepEqual(result.entries.map((entry) => entry.id), ['tail']);
});

test('maxEntries slices the tail and sets truncated', (t) => {
  const lines = [];
  for (let i = 0; i < 10; i++) lines.push(JSON.stringify({ n: i }));
  const filePath = writeTempJsonl(t, lines.join('\n') + '\n');

  const result = readJsonlFile(filePath, { maxEntries: 3 });
  assert.equal(result.truncated, true);
  assert.equal(result.returnedEntries, 3);
  assert.deepEqual(result.entries, [{ n: 7 }, { n: 8 }, { n: 9 }]);
});

test('skips malformed JSON lines', (t) => {
  const filePath = writeTempJsonl(
    t,
    [
      JSON.stringify({ id: 'ok-1' }),
      '{not-json',
      JSON.stringify({ id: 'ok-2' }),
    ].join('\n') + '\n',
  );

  const result = readJsonlFile(filePath);
  assert.equal(result.truncated, false);
  assert.deepEqual(result.entries, [{ id: 'ok-1' }, { id: 'ok-2' }]);
});

test('skip incomplete first line when tailing mid-line', (t) => {
  const head = '{"id":"head","pad":"' + 'y'.repeat(300) + '"}\n';
  const complete = JSON.stringify({ id: 'kept' }) + '\n';
  const filePath = writeTempJsonl(t, head + complete);
  // Start the tail window in the middle of `head` so the first parsed line is a fragment.
  const maxBytes = Math.floor(head.length / 2) + complete.length;

  const result = readJsonlFile(filePath, { maxBytes, maxEntries: 50 });
  assert.equal(result.truncated, true);
  assert.deepEqual(result.entries, [{ id: 'kept' }]);
  assert.ok(!result.entries.some((entry) => entry.id === 'head'));
});

test('normalizeJsonlReadOptions clamps oversized and invalid limits', () => {
  const {
    DEFAULT_JSONL_MAX_BYTES,
    DEFAULT_JSONL_MAX_ENTRIES,
    normalizeJsonlReadOptions,
  } = require('../jsonl-read');

  assert.deepEqual(normalizeJsonlReadOptions({}), {
    maxBytes: DEFAULT_JSONL_MAX_BYTES,
    maxEntries: DEFAULT_JSONL_MAX_ENTRIES,
  });
  assert.equal(normalizeJsonlReadOptions({ maxBytes: 1e15 }).maxBytes, DEFAULT_JSONL_MAX_BYTES);
  assert.equal(normalizeJsonlReadOptions({ maxEntries: 9999 }).maxEntries, DEFAULT_JSONL_MAX_ENTRIES);
  assert.equal(normalizeJsonlReadOptions({ maxBytes: 512 * 1024 }).maxBytes, 512 * 1024);
  assert.equal(normalizeJsonlReadOptions({ maxBytes: 0, maxEntries: -1 }).maxBytes, DEFAULT_JSONL_MAX_BYTES);
});
