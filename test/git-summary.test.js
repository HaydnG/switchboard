const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseGitStatusPorcelain,
  parseDiffNumstat,
  summarizeGitState,
  shouldPollGit,
} = require('../public/git-summary');

test('porcelain parsing handles NUL-separated status output', () => {
  const text = ' M file1.js\0?? file2.js\0';
  const result = parseGitStatusPorcelain(text);

  assert.deepEqual(result, { staged: 0, unstaged: 1, untracked: 1, conflicted: 0, dirtyFiles: 2 });
});

test('porcelain parsing handles newline-separated status output', () => {
  const text = 'M  file1.js\n M file2.js\n';
  const result = parseGitStatusPorcelain(text);

  assert.deepEqual(result, { staged: 1, unstaged: 1, untracked: 0, conflicted: 0, dirtyFiles: 2 });
});

test('porcelain parsing ignores empty entries from separators', () => {
  const result = parseGitStatusPorcelain('\n\nM  file1.js\n\n');
  assert.equal(result.dirtyFiles, 1);
  assert.equal(result.staged, 1);
});

test('porcelain parsing counts a text-form rename as one file', () => {
  const result = parseGitStatusPorcelain('R  old.js -> new.js\n');
  assert.deepEqual(result, { staged: 1, unstaged: 0, untracked: 0, conflicted: 0, dirtyFiles: 1 });
});

test('porcelain parsing consumes the paired "from" field for a -z rename', () => {
  const text = 'R  new.js\0old.js\0M  other.js\0';
  const result = parseGitStatusPorcelain(text);

  assert.deepEqual(result, { staged: 2, unstaged: 0, untracked: 0, conflicted: 0, dirtyFiles: 2 });
});

test('porcelain parsing marks an entry both staged and unstaged when both columns are dirty', () => {
  const result = parseGitStatusPorcelain('MM file.js\n');
  assert.deepEqual(result, { staged: 1, unstaged: 1, untracked: 0, conflicted: 0, dirtyFiles: 1 });
});

test('porcelain parsing detects untracked files', () => {
  const result = parseGitStatusPorcelain('?? new-file.js\n');
  assert.deepEqual(result, { staged: 0, unstaged: 0, untracked: 1, conflicted: 0, dirtyFiles: 1 });
});

test('porcelain parsing detects conflict codes (U anywhere, AA, DD)', () => {
  const text = 'UU both.js\nAA added.js\nDD deleted.js\nAU addedByUs.js\n';
  const result = parseGitStatusPorcelain(text);

  assert.equal(result.conflicted, 4);
  assert.equal(result.dirtyFiles, 4);
  assert.equal(result.staged, 0);
  assert.equal(result.unstaged, 0);
});

test('porcelain parsing tolerates empty or missing input', () => {
  assert.deepEqual(parseGitStatusPorcelain(''), { staged: 0, unstaged: 0, untracked: 0, conflicted: 0, dirtyFiles: 0 });
  assert.deepEqual(parseGitStatusPorcelain(null), { staged: 0, unstaged: 0, untracked: 0, conflicted: 0, dirtyFiles: 0 });
});

test('numstat parsing sums insertions, deletions, and file count', () => {
  const text = '10\t2\tsrc/a.js\n0\t5\tsrc/b.js\n';
  const result = parseDiffNumstat(text);

  assert.deepEqual(result, { insertions: 10, deletions: 7, files: 2 });
});

test('numstat parsing treats binary "-" columns as zero but still counts the file', () => {
  const text = '-\t-\tassets/image.png\n3\t1\tsrc/a.js\n';
  const result = parseDiffNumstat(text);

  assert.deepEqual(result, { insertions: 3, deletions: 1, files: 2 });
});

test('numstat parsing ignores blank lines', () => {
  const result = parseDiffNumstat('\n5\t1\tsrc/a.js\n\n');
  assert.deepEqual(result, { insertions: 5, deletions: 1, files: 1 });
});

test('numstat parsing tolerates empty or missing input', () => {
  assert.deepEqual(parseDiffNumstat(''), { insertions: 0, deletions: 0, files: 0 });
  assert.deepEqual(parseDiffNumstat(undefined), { insertions: 0, deletions: 0, files: 0 });
});

test('summarize reports a clean chip using the branch name', () => {
  const result = summarizeGitState({ branch: 'main', status: null, numstat: null });
  assert.deepEqual(result, { label: 'main', detail: 'clean', level: 'clean' });
});

test('summarize reports clean even with zero-count status/numstat objects', () => {
  const status = { staged: 0, unstaged: 0, untracked: 0, conflicted: 0, dirtyFiles: 0 };
  const numstat = { insertions: 0, deletions: 0, files: 0 };
  const result = summarizeGitState({ branch: 'main', status, numstat });

  assert.equal(result.level, 'clean');
  assert.equal(result.detail, 'clean');
});

test('summarize reports a dirty chip with a U+2212 minus sign in the label', () => {
  const status = { staged: 2, unstaged: 1, untracked: 1, conflicted: 0, dirtyFiles: 3 };
  const numstat = { insertions: 12, deletions: 4, files: 3 };
  const result = summarizeGitState({ branch: 'feature/x', status, numstat });

  assert.equal(result.label, 'feature/x +12 \u22124');
  assert.ok(result.label.includes('\u2212'));
  assert.equal(result.detail, '3 files changed \u00b7 1 untracked');
  assert.equal(result.level, 'dirty');
});

test('summarize omits the +/- suffix entirely when numstat is null', () => {
  const status = { staged: 0, unstaged: 0, untracked: 1, conflicted: 0, dirtyFiles: 1 };
  const result = summarizeGitState({ branch: 'main', status, numstat: null });

  assert.equal(result.label, 'main');
  assert.equal(result.detail, '1 untracked');
  assert.equal(result.level, 'dirty');
});

test('summarize reports conflict level and mentions conflicts in the detail', () => {
  const status = { staged: 0, unstaged: 0, untracked: 0, conflicted: 2, dirtyFiles: 2 };
  const result = summarizeGitState({ branch: 'main', status, numstat: null });

  assert.equal(result.level, 'conflict');
  assert.match(result.detail, /conflict/);
});

test('summarize falls back to "detached" when branch is null or empty', () => {
  const status = { staged: 1, unstaged: 0, untracked: 0, conflicted: 0, dirtyFiles: 1 };
  assert.equal(summarizeGitState({ branch: null, status, numstat: null }).label, 'detached');
  assert.equal(summarizeGitState({ branch: '', status: null, numstat: null }).label, 'detached');
});

test('shouldPollGit refuses to poll a session without a live PTY', () => {
  const result = shouldPollGit({ hasLivePty: false, lastPollAt: null, now: 1000 });
  assert.equal(result, false);
});

test('shouldPollGit polls immediately when a live session has never been polled', () => {
  const result = shouldPollGit({ hasLivePty: true, lastPollAt: null, now: 1000 });
  assert.equal(result, true);
});

test('shouldPollGit withholds polling within the minimum interval', () => {
  const result = shouldPollGit({ hasLivePty: true, lastPollAt: 1000, now: 1000 + 5000, minIntervalMs: 15000 });
  assert.equal(result, false);
});

test('shouldPollGit allows polling once the minimum interval has elapsed', () => {
  const result = shouldPollGit({ hasLivePty: true, lastPollAt: 1000, now: 1000 + 15000, minIntervalMs: 15000 });
  assert.equal(result, true);
});

test('shouldPollGit uses the default 15s interval when not specified', () => {
  assert.equal(shouldPollGit({ hasLivePty: true, lastPollAt: 0, now: 14999 }), false);
  assert.equal(shouldPollGit({ hasLivePty: true, lastPollAt: 0, now: 15000 }), true);
});
