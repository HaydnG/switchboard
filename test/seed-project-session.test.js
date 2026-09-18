const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { getRuntime } = require('../agent-runtimes');
const {
  resolveAddProjectRuntimeId,
  addProjectRuntimeLabel,
  seedFilename,
  ensureProjectSessionFolder,
} = require('../seed-project-session');

test('resolveAddProjectRuntimeId accepts claude, pi, and omp and falls back to claude', () => {
  assert.equal(resolveAddProjectRuntimeId('claude'), 'claude');
  assert.equal(resolveAddProjectRuntimeId('pi'), 'pi');
  assert.equal(resolveAddProjectRuntimeId('omp'), 'omp');
  assert.equal(resolveAddProjectRuntimeId('nope'), 'claude');
  assert.equal(resolveAddProjectRuntimeId(undefined), 'claude');
  assert.equal(resolveAddProjectRuntimeId('__proto__'), 'claude');
});

test('addProjectRuntimeLabel uses Claude Code for the claude runtime', () => {
  assert.equal(addProjectRuntimeLabel('claude'), 'Claude Code');
  assert.equal(addProjectRuntimeLabel('pi'), 'Pi');
  assert.equal(addProjectRuntimeLabel('omp'), 'omp');
});

test('seedFilename uses a timestamp prefix for Pi and omp', () => {
  const now = new Date('2026-09-17T09:47:00.000Z');
  const sessionId = '11111111-1111-4111-8111-111111111111';
  assert.equal(seedFilename(getRuntime('claude'), sessionId, now), `${sessionId}.jsonl`);
  assert.equal(
    seedFilename(getRuntime('pi'), sessionId, now),
    `2026-09-17T09-47-00-000Z_${sessionId}.jsonl`,
  );
  assert.equal(
    seedFilename(getRuntime('omp'), sessionId, now),
    `2026-09-17T09-47-00-000Z_${sessionId}.jsonl`,
  );
});

test('ensureProjectSessionFolder seeds a readable session for each runtime', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-add-project-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const projectPath = path.join(root, 'app');
  fs.mkdirSync(projectPath);
  const sessionId = '22222222-2222-4222-8222-222222222222';
  const now = new Date('2026-09-17T09:47:00.000Z');

  for (const runtimeId of ['claude', 'pi', 'omp']) {
    const runtime = getRuntime(runtimeId);
    const sessionsDir = path.join(root, runtimeId);
    const result = ensureProjectSessionFolder(projectPath, runtimeId, {
      sessionsDir,
      sessionId,
      now,
    });
    assert.equal(result.runtimeId, runtimeId);
    assert.equal(result.seeded, true);
    assert.equal(result.folder, runtime.encodeProjectPath(projectPath));
    const seedPath = path.join(result.folderPath, result.sessionFile);
    const session = runtime.readSessionFile(seedPath, result.folder, projectPath);
    assert.ok(session, `${runtimeId} seed should parse`);
    assert.equal(session.runtime || runtimeId, runtimeId);
    assert.equal(session.summary, 'New project');
    assert.match(fs.readFileSync(seedPath, 'utf8'), /"cwd":/);
  }
});

test('ensureProjectSessionFolder does not add a second seed when jsonl already exists', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-add-project-existing-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const projectPath = path.join(root, 'app');
  fs.mkdirSync(projectPath);
  const sessionsDir = path.join(root, 'claude');
  const first = ensureProjectSessionFolder(projectPath, 'claude', { sessionsDir });
  const second = ensureProjectSessionFolder(projectPath, 'claude', { sessionsDir });
  assert.equal(first.seeded, true);
  assert.equal(second.seeded, false);
  const jsonl = fs.readdirSync(first.folderPath).filter((file) => file.endsWith('.jsonl'));
  assert.equal(jsonl.length, 1);
});

test('ensureProjectSessionFolder can register a folder without seeding a dummy session', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-add-project-noseed-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const projectPath = path.join(root, 'app');
  fs.mkdirSync(projectPath);
  const sessionsDir = path.join(root, 'pi');
  const result = ensureProjectSessionFolder(projectPath, 'pi', { sessionsDir, seed: false });
  assert.equal(result.seeded, false);
  assert.equal(result.sessionFile, null);
  assert.equal(fs.existsSync(result.folderPath), true);
  assert.deepEqual(fs.readdirSync(result.folderPath).filter((file) => file.endsWith('.jsonl')), []);
});
