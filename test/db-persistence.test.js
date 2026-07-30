const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');

const repositoryRoot = path.join(__dirname, '..');
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-db-test-'));
const freshDataDir = path.join(testRoot, 'fresh');
process.env.SWITCHBOARD_DATA_DIR = freshDataDir;

const store = require('../db');

test.after(() => {
  store.closeDb();
  fs.rmSync(testRoot, { recursive: true, force: true });
});

function openDatabase(dataDir) {
  return new Database(path.join(dataDir, 'switchboard.db'));
}

function initializeInChild(dataDir) {
  const result = spawnSync(process.execPath, ['-e', "require('./db').closeDb()"], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: { ...process.env, SWITCHBOARD_DATA_DIR: dataDir },
  });
  assert.equal(result.status, 0, result.stderr);
  return result;
}

test('creates a fresh database at the current schema version', () => {
  const database = openDatabase(freshDataDir);
  const version = JSON.parse(
    database.prepare("SELECT value FROM settings WHERE key = 'db_version'").get().value,
  );
  const tables = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((row) => row.name);

  assert.equal(version, 6);
  assert.deepEqual(
    ['saved_views', 'schedule_runs', 'session_notes', 'session_tags', 'tags'].filter(
      (name) => !tables.includes(name),
    ),
    [],
  );
  assert.equal(fs.existsSync(path.join(freshDataDir, 'backups')), false);
  database.close();
});

test('upgrades once, creates a pre-migration snapshot, and preserves data', () => {
  const dataDir = path.join(testRoot, 'upgrade');
  initializeInChild(dataDir);

  const legacy = openDatabase(dataDir);
  legacy.exec(`
    DROP TABLE saved_views;
    DROP TABLE session_notes;
    DROP TABLE session_tags;
    DROP TABLE tags;
    DROP TABLE schedule_runs;
    INSERT INTO session_meta (sessionId, name) VALUES ('preserved-session', 'Preserved');
    UPDATE settings SET value = '5' WHERE key = 'db_version';
  `);
  legacy.pragma('wal_checkpoint(TRUNCATE)');
  legacy.close();

  const result = initializeInChild(dataDir);
  assert.match(result.stdout, /Created pre-migration backup for v5/);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /preserved-session|Preserved/);

  const backupsDir = path.join(dataDir, 'backups');
  const backups = fs.readdirSync(backupsDir);
  assert.equal(backups.length, 1);

  const upgraded = openDatabase(dataDir);
  assert.equal(
    upgraded.prepare('SELECT name FROM session_meta WHERE sessionId = ?').get('preserved-session')
      .name,
    'Preserved',
  );
  assert.equal(
    JSON.parse(upgraded.prepare("SELECT value FROM settings WHERE key = 'db_version'").get().value),
    6,
  );
  assert.ok(
    upgraded
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'saved_views'")
      .get(),
  );
  upgraded.close();

  const backup = new Database(path.join(backupsDir, backups[0]), { readonly: true });
  assert.equal(
    JSON.parse(backup.prepare("SELECT value FROM settings WHERE key = 'db_version'").get().value),
    5,
  );
  assert.equal(
    backup
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'saved_views'")
      .get(),
    undefined,
  );
  backup.close();

  initializeInChild(dataDir);
  assert.equal(fs.readdirSync(backupsDir).length, 1);
});

test('supports saved view CRUD with structured definitions', () => {
  const created = store.saveSavedView({
    id: 'recent-errors',
    name: 'Recent errors',
    definition: { query: 'error', filters: ['active'] },
    createdAt: '2026-07-01T10:00:00.000Z',
    updatedAt: '2026-07-01T10:00:00.000Z',
  });
  assert.deepEqual(created.definition, { query: 'error', filters: ['active'] });

  const updated = store.saveSavedView({
    id: 'recent-errors',
    name: 'Latest errors',
    definition: { query: 'exception' },
    createdAt: 'ignored-on-update',
    updatedAt: '2026-07-02T10:00:00.000Z',
  });
  assert.equal(updated.createdAt, '2026-07-01T10:00:00.000Z');
  assert.equal(store.listSavedViews()[0].name, 'Latest errors');
  assert.equal(store.deleteSavedView('recent-errors'), true);
  assert.equal(store.getSavedView('recent-errors'), null);
});

test('supports durable session notes and normalized tags', () => {
  assert.deepEqual(
    store.setSessionNote('session-1', 'Follow up tomorrow', '2026-07-03T10:00:00.000Z'),
    {
      sessionId: 'session-1',
      note: 'Follow up tomorrow',
      updatedAt: '2026-07-03T10:00:00.000Z',
    },
  );
  assert.equal(store.getSessionNote('session-1').note, 'Follow up tomorrow');

  assert.deepEqual(store.setSessionTags('session-1', [' Work ', 'urgent', 'work']), [
    'urgent',
    'Work',
  ]);
  assert.deepEqual(store.setSessionTags('session-2', ['WORK']), ['Work']);
  assert.deepEqual(store.setSessionTags('session-1', []), []);
  assert.deepEqual(store.getSessionTags('session-2'), ['Work']);
  assert.equal(store.deleteSessionNote('session-1'), true);
});

test('supports schedule run metadata and bounded history', () => {
  store.saveScheduleRun({
    id: 'run-1',
    scheduleId: 'daily-review',
    status: 'running',
    startedAt: '2026-07-04T09:00:00.000Z',
    runtime: 'claude',
    metadata: { source: 'timer', attempt: 1 },
  });
  const completed = store.saveScheduleRun({
    id: 'run-1',
    scheduleId: 'daily-review',
    status: 'completed',
    startedAt: '2026-07-04T09:00:00.000Z',
    finishedAt: '2026-07-04T09:05:00.000Z',
    sessionId: 'session-2',
    runtime: 'claude',
    metadata: { source: 'timer', attempt: 1 },
  });
  store.saveScheduleRun({
    id: 'run-2',
    scheduleId: 'daily-review',
    status: 'failed',
    startedAt: '2026-07-05T09:00:00.000Z',
    error: 'process exited',
  });

  assert.deepEqual(completed.metadata, { source: 'timer', attempt: 1 });
  assert.equal(store.getScheduleRun('run-1').status, 'completed');
  assert.deepEqual(
    store.listScheduleRuns('daily-review', 1).map((run) => run.id),
    ['run-2'],
  );
  assert.equal(store.deleteScheduleRuns('daily-review'), 2);
});

test('handles punctuation, quotes, duplicate entries, and invalid FTS input', () => {
  store.upsertSearchEntries([
    {
      id: 'session-search',
      type: 'session',
      title: 'Investigate spec.md "parser"',
      body: 'Original exception details',
    },
  ]);
  assert.deepEqual(
    store.searchByType('session', 'spec.md', 10, true).map((row) => row.id),
    ['session-search'],
  );
  assert.deepEqual(
    store.searchByType('session', '"parser"', 10).map((row) => row.id),
    ['session-search'],
  );

  store.upsertSearchEntries([
    {
      id: 'session-search',
      type: 'session',
      title: 'Investigate spec.md "parser"',
      body: 'Replacement exception details',
    },
  ]);
  assert.equal(store.searchByType('session', 'exception').length, 1);
  assert.deepEqual(store.searchByType('session', null), []);
  assert.deepEqual(store.searchByType('session', ''), []);
});
