const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { runWithBusyRetry } = require('./sqlite-busy-retry');

const DATA_DIR = process.env.SWITCHBOARD_DATA_DIR || path.join(os.homedir(), '.switchboard');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'switchboard.db');

// Migrate from old locations if needed
const OLD_LOCATIONS = [
  path.join(os.homedir(), '.claude', 'browser', 'switchboard.db'),
  path.join(os.homedir(), '.claude', 'browser', 'session-browser.db'),
  path.join(os.homedir(), '.claude', 'session-browser.db'),
];
if (!fs.existsSync(DB_PATH)) {
  for (const oldPath of OLD_LOCATIONS) {
    if (fs.existsSync(oldPath)) {
      fs.renameSync(oldPath, DB_PATH);
      try {
        fs.renameSync(oldPath + '-wal', DB_PATH + '-wal');
      } catch {}
      try {
        fs.renameSync(oldPath + '-shm', DB_PATH + '-shm');
      } catch {}
      break;
    }
  }
}
const databaseExisted = fs.existsSync(DB_PATH);
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

function tableExists(name) {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name),
  );
}

function columnExists(table, column) {
  if (!tableExists(table)) return false;
  return db
    .prepare(`PRAGMA table_info("${table.replace(/"/g, '""')}")`)
    .all()
    .some((row) => row.name === column);
}

function getStoredDbVersion() {
  if (!tableExists('settings')) return 0;
  const row = db.prepare("SELECT value FROM settings WHERE key = 'db_version'").get();
  if (!row) return 0;
  try {
    const version = JSON.parse(row.value);
    return Number.isInteger(version) && version >= 0 ? version : 0;
  } catch {
    return 0;
  }
}

function createPreMigrationBackup(fromVersion) {
  const backupDir = process.env.SWITCHBOARD_DB_BACKUP_DIR || path.join(DATA_DIR, 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const baseName = `switchboard-v${fromVersion}-${timestamp}.db`;
  let backupPath = path.join(backupDir, baseName);
  let suffix = 1;
  while (fs.existsSync(backupPath)) {
    backupPath = path.join(backupDir, `${baseName}.${suffix}`);
    suffix += 1;
  }

  // VACUUM INTO uses SQLite's own consistent snapshot mechanism, including
  // committed WAL contents, instead of copying only the main database file.
  db.prepare('VACUUM INTO ?').run(backupPath);
  return backupPath;
}

// --- Migrations ---
// Each migration runs once, in order. Add new migrations to the end.
let searchFtsRecreated = false;
const migrations = [
  // v1: (superseded by v2)
  () => {},
  // v2: Clear session cache to re-index with corrected worktree paths
  (db) => {
    if (tableExists('session_cache')) db.exec('DELETE FROM session_cache');
    if (tableExists('cache_meta')) db.exec('DELETE FROM cache_meta');
    if (tableExists('search_map')) db.exec('DELETE FROM search_map');
    db.exec('DROP TABLE IF EXISTS search_fts');
    searchFtsRecreated = true;
  },
  // v3: Add aiTitle column for AI-generated session titles. Clear cache so a
  // re-index repopulates the column. Also clear session_meta.name entries that
  // were clobbered by AI titles in v0.0.29 (when ai-title was written into the
  // user-name column). We cannot tell with certainty which names came from an
  // AI title vs a manual rename, but the safe heuristic is: drop names whose
  // value matches the JSONL aiTitle on next index. That post-index cleanup is
  // not done here — instead we accept that any pre-fix AI-title pollution
  // remains until the user renames manually, and only future indexes are clean.
  (db) => {
    if (!columnExists('session_cache', 'aiTitle')) {
      db.exec('ALTER TABLE session_cache ADD COLUMN aiTitle TEXT');
    }
    db.exec('DELETE FROM session_cache');
    db.exec('DELETE FROM cache_meta');
  },
  // v4: Add session health metrics derived from JSONL usage/timestamp data.
  (db) => {
    const columns = [
      'ALTER TABLE session_cache ADD COLUMN userMessageCount INTEGER DEFAULT 0',
      'ALTER TABLE session_cache ADD COLUMN inputTokens INTEGER DEFAULT 0',
      'ALTER TABLE session_cache ADD COLUMN outputTokens INTEGER DEFAULT 0',
      'ALTER TABLE session_cache ADD COLUMN cacheCreationTokens INTEGER DEFAULT 0',
      'ALTER TABLE session_cache ADD COLUMN cacheReadTokens INTEGER DEFAULT 0',
      'ALTER TABLE session_cache ADD COLUMN largestUserPromptWords INTEGER DEFAULT 0',
      'ALTER TABLE session_cache ADD COLUMN startedAt TEXT',
      'ALTER TABLE session_cache ADD COLUMN lastEntryAt TEXT',
      'ALTER TABLE session_cache ADD COLUMN activeMinutes INTEGER DEFAULT 0',
    ];
    for (const sql of columns) {
      const column = sql.match(/ADD COLUMN (\w+)/)[1];
      if (!columnExists('session_cache', column)) db.exec(sql);
    }
    db.exec('DELETE FROM session_cache');
    db.exec('DELETE FROM cache_meta');
    if (tableExists('search_map')) db.exec('DELETE FROM search_map');
    if (tableExists('search_fts')) db.exec('DELETE FROM search_fts');
  },
  // v5: Pi runtime support — track agent runtime and Pi session filenames.
  (db) => {
    if (!columnExists('session_cache', 'runtime')) {
      db.exec("ALTER TABLE session_cache ADD COLUMN runtime TEXT DEFAULT 'claude'");
    }
    if (!columnExists('session_cache', 'sessionFile')) {
      db.exec('ALTER TABLE session_cache ADD COLUMN sessionFile TEXT');
    }
  },
  // v6: Durable local-first organization and schedule history.
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS saved_views (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        definition TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS session_notes (
        sessionId TEXT PRIMARY KEY,
        note TEXT NOT NULL DEFAULT '',
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tags (
        name TEXT PRIMARY KEY COLLATE NOCASE,
        createdAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS session_tags (
        sessionId TEXT NOT NULL,
        tagName TEXT NOT NULL COLLATE NOCASE,
        createdAt TEXT NOT NULL,
        PRIMARY KEY (sessionId, tagName),
        FOREIGN KEY (tagName) REFERENCES tags(name) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS schedule_runs (
        id TEXT PRIMARY KEY,
        scheduleId TEXT NOT NULL,
        status TEXT NOT NULL,
        startedAt TEXT NOT NULL,
        finishedAt TEXT,
        sessionId TEXT,
        runtime TEXT,
        metadata TEXT,
        error TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_session_tags_tag
        ON session_tags(tagName);
      CREATE INDEX IF NOT EXISTS idx_schedule_runs_schedule_started
        ON schedule_runs(scheduleId, startedAt DESC);
    `);
  },
];

const currentDbVersion = getStoredDbVersion();
let migrationBackupPath = null;
if (databaseExisted && currentDbVersion < migrations.length) {
  try {
    migrationBackupPath = createPreMigrationBackup(currentDbVersion);
    console.info(`[switchboard-db] Created pre-migration backup for v${currentDbVersion}`);
  } catch (error) {
    console.error(`[switchboard-db] Could not back up database before v${migrations.length}`);
    db.close();
    const backupError = new Error(
      'Database migration aborted because the pre-migration backup failed',
    );
    backupError.code = 'SWITCHBOARD_DB_BACKUP_FAILED';
    backupError.cause = error;
    throw backupError;
  }
}

db.exec(`
  CREATE TABLE IF NOT EXISTS session_meta (
    sessionId TEXT PRIMARY KEY,
    name TEXT,
    starred INTEGER DEFAULT 0,
    archived INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS session_cache (
    sessionId TEXT PRIMARY KEY,
    folder TEXT NOT NULL,
    projectPath TEXT,
    summary TEXT,
    firstPrompt TEXT,
    created TEXT,
    modified TEXT,
    messageCount INTEGER DEFAULT 0,
    userMessageCount INTEGER DEFAULT 0,
    inputTokens INTEGER DEFAULT 0,
    outputTokens INTEGER DEFAULT 0,
    cacheCreationTokens INTEGER DEFAULT 0,
    cacheReadTokens INTEGER DEFAULT 0,
    largestUserPromptWords INTEGER DEFAULT 0,
    startedAt TEXT,
    lastEntryAt TEXT,
    activeMinutes INTEGER DEFAULT 0,
    slug TEXT,
    aiTitle TEXT,
    runtime TEXT DEFAULT 'claude',
    sessionFile TEXT
  );

  CREATE TABLE IF NOT EXISTS cache_meta (
    folder TEXT PRIMARY KEY,
    projectPath TEXT,
    indexMtimeMs REAL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_session_cache_folder ON session_cache(folder);
  CREATE INDEX IF NOT EXISTS idx_session_cache_slug ON session_cache(slug);
`);

for (let i = currentDbVersion; i < migrations.length; i += 1) {
  const targetVersion = i + 1;
  console.info(`[switchboard-db] Applying migration v${targetVersion}`);
  try {
    db.transaction(() => {
      migrations[i](db);
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('db_version', ?)").run(
        JSON.stringify(targetVersion),
      );
    })();
    console.info(`[switchboard-db] Applied migration v${targetVersion}`);
  } catch (error) {
    console.error(`[switchboard-db] Migration v${targetVersion} failed`);
    db.close();
    const migrationError = new Error(`Database migration v${targetVersion} failed`);
    migrationError.code = 'SWITCHBOARD_DB_MIGRATION_FAILED';
    migrationError.cause = error;
    throw migrationError;
  }
}
db.pragma('foreign_keys = ON');

// --- FTS5 full-text search ---
db.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
    title, body, tokenize='trigram case_sensitive 0'
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS search_map (
    rowid INTEGER PRIMARY KEY,
    id TEXT NOT NULL,
    type TEXT NOT NULL,
    folder TEXT
  )
`);

db.exec('CREATE INDEX IF NOT EXISTS idx_search_map_type_id ON search_map(type, id)');

const stmts = {
  get: db.prepare('SELECT * FROM session_meta WHERE sessionId = ?'),
  getAll: db.prepare('SELECT * FROM session_meta'),
  upsertName: db.prepare(`
    INSERT INTO session_meta (sessionId, name) VALUES (?, ?)
    ON CONFLICT(sessionId) DO UPDATE SET name = excluded.name
  `),
  upsertStar: db.prepare(`
    INSERT INTO session_meta (sessionId, starred) VALUES (?, 1)
    ON CONFLICT(sessionId) DO UPDATE SET starred = CASE WHEN starred = 1 THEN 0 ELSE 1 END
  `),
  upsertArchived: db.prepare(`
    INSERT INTO session_meta (sessionId, archived) VALUES (?, ?)
    ON CONFLICT(sessionId) DO UPDATE SET archived = excluded.archived
  `),
  // Session cache statements
  cacheCount: db.prepare('SELECT COUNT(*) as cnt FROM session_cache'),
  cacheGetAll: db.prepare('SELECT * FROM session_cache'),
  cacheUpsert: db.prepare(`
    INSERT INTO session_cache (
      sessionId, folder, projectPath, summary, firstPrompt, created, modified,
      messageCount, userMessageCount, inputTokens, outputTokens, cacheCreationTokens,
      cacheReadTokens, largestUserPromptWords, startedAt, lastEntryAt, activeMinutes,
      slug, aiTitle, runtime, sessionFile
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(sessionId) DO UPDATE SET
      folder = excluded.folder, projectPath = excluded.projectPath,
      summary = excluded.summary, firstPrompt = excluded.firstPrompt,
      created = excluded.created, modified = excluded.modified,
      messageCount = excluded.messageCount,
      userMessageCount = excluded.userMessageCount,
      inputTokens = excluded.inputTokens,
      outputTokens = excluded.outputTokens,
      cacheCreationTokens = excluded.cacheCreationTokens,
      cacheReadTokens = excluded.cacheReadTokens,
      largestUserPromptWords = excluded.largestUserPromptWords,
      startedAt = excluded.startedAt,
      lastEntryAt = excluded.lastEntryAt,
      activeMinutes = excluded.activeMinutes,
      slug = excluded.slug,
      aiTitle = excluded.aiTitle,
      runtime = excluded.runtime,
      sessionFile = excluded.sessionFile
  `),
  cacheGetByFolder: db.prepare('SELECT sessionId, modified FROM session_cache WHERE folder = ?'),
  cacheGetFolder: db.prepare('SELECT folder FROM session_cache WHERE sessionId = ?'),
  cacheGetSession: db.prepare('SELECT * FROM session_cache WHERE sessionId = ?'),
  cacheDeleteSession: db.prepare('DELETE FROM session_cache WHERE sessionId = ?'),
  cacheDeleteFolder: db.prepare('DELETE FROM session_cache WHERE folder = ?'),
  // Cache meta statements
  metaGet: db.prepare('SELECT * FROM cache_meta WHERE folder = ?'),
  metaGetAll: db.prepare('SELECT * FROM cache_meta'),
  metaUpsert: db.prepare(`
    INSERT INTO cache_meta (folder, projectPath, indexMtimeMs)
    VALUES (?, ?, ?)
    ON CONFLICT(folder) DO UPDATE SET
      projectPath = excluded.projectPath, indexMtimeMs = excluded.indexMtimeMs
  `),
  metaDelete: db.prepare('DELETE FROM cache_meta WHERE folder = ?'),
  // FTS search statements
  searchDeleteBySession: db.prepare(
    "DELETE FROM search_fts WHERE rowid IN (SELECT rowid FROM search_map WHERE type = 'session' AND id = ?)",
  ),
  searchMapDeleteBySession: db.prepare("DELETE FROM search_map WHERE type = 'session' AND id = ?"),
  searchDeleteByFolder: db.prepare(
    "DELETE FROM search_fts WHERE rowid IN (SELECT rowid FROM search_map WHERE type = 'session' AND folder = ?)",
  ),
  searchMapDeleteByFolder: db.prepare(
    "DELETE FROM search_map WHERE type = 'session' AND folder = ?",
  ),
  searchDeleteByType: db.prepare(
    'DELETE FROM search_fts WHERE rowid IN (SELECT rowid FROM search_map WHERE type = ?)',
  ),
  searchMapDeleteByType: db.prepare('DELETE FROM search_map WHERE type = ?'),
  searchInsertFts: db.prepare(
    'INSERT OR REPLACE INTO search_fts(rowid, title, body) VALUES (?, ?, ?)',
  ),
  searchInsertMap: db.prepare(
    'INSERT OR REPLACE INTO search_map(id, type, folder) VALUES (?, ?, ?)',
  ),
  searchMapLookup: db.prepare('SELECT rowid FROM search_map WHERE id = ? AND type = ?'),
  searchUpdateTitle: db.prepare(
    'UPDATE search_fts SET title = ? WHERE rowid = (SELECT rowid FROM search_map WHERE id = ? AND type = ?)',
  ),
  searchDeleteByRowid: db.prepare('DELETE FROM search_fts WHERE rowid = ?'),
  searchMapDeleteByRowid: db.prepare('DELETE FROM search_map WHERE rowid = ?'),
  // Settings statements
  settingsGet: db.prepare('SELECT value FROM settings WHERE key = ?'),
  settingsUpsert: db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `),
  settingsDelete: db.prepare('DELETE FROM settings WHERE key = ?'),
  // Saved view statements
  savedViewGet: db.prepare('SELECT * FROM saved_views WHERE id = ?'),
  savedViewList: db.prepare('SELECT * FROM saved_views ORDER BY name COLLATE NOCASE, id'),
  savedViewUpsert: db.prepare(`
    INSERT INTO saved_views (id, name, definition, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      definition = excluded.definition,
      updatedAt = excluded.updatedAt
  `),
  savedViewDelete: db.prepare('DELETE FROM saved_views WHERE id = ?'),
  // Session note and tag statements
  sessionNoteGet: db.prepare('SELECT * FROM session_notes WHERE sessionId = ?'),
  sessionNoteUpsert: db.prepare(`
    INSERT INTO session_notes (sessionId, note, updatedAt)
    VALUES (?, ?, ?)
    ON CONFLICT(sessionId) DO UPDATE SET
      note = excluded.note,
      updatedAt = excluded.updatedAt
  `),
  sessionNoteDelete: db.prepare('DELETE FROM session_notes WHERE sessionId = ?'),
  tagInsert: db.prepare('INSERT OR IGNORE INTO tags (name, createdAt) VALUES (?, ?)'),
  tagGetCanonical: db.prepare('SELECT name FROM tags WHERE name = ? COLLATE NOCASE'),
  sessionTagInsert: db.prepare(`
    INSERT INTO session_tags (sessionId, tagName, createdAt) VALUES (?, ?, ?)
  `),
  sessionTagDelete: db.prepare('DELETE FROM session_tags WHERE sessionId = ?'),
  sessionTagList: db.prepare(`
    SELECT tags.name
    FROM session_tags
    JOIN tags ON tags.name = session_tags.tagName COLLATE NOCASE
    WHERE session_tags.sessionId = ?
    ORDER BY tags.name COLLATE NOCASE
  `),
  tagDeleteUnused: db.prepare(`
    DELETE FROM tags
    WHERE NOT EXISTS (
      SELECT 1 FROM session_tags WHERE session_tags.tagName = tags.name COLLATE NOCASE
    )
  `),
  // Schedule run statements
  scheduleRunGet: db.prepare('SELECT * FROM schedule_runs WHERE id = ?'),
  scheduleRunList: db.prepare(`
    SELECT * FROM schedule_runs
    WHERE scheduleId = ?
    ORDER BY startedAt DESC, id DESC
    LIMIT ?
  `),
  scheduleRunUpsert: db.prepare(`
    INSERT INTO schedule_runs (
      id, scheduleId, status, startedAt, finishedAt, sessionId, runtime, metadata, error
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      scheduleId = excluded.scheduleId,
      status = excluded.status,
      startedAt = excluded.startedAt,
      finishedAt = excluded.finishedAt,
      sessionId = excluded.sessionId,
      runtime = excluded.runtime,
      metadata = excluded.metadata,
      error = excluded.error
  `),
  scheduleRunDeleteBySchedule: db.prepare('DELETE FROM schedule_runs WHERE scheduleId = ?'),
  searchQuery: db.prepare(`
    SELECT search_map.id, snippet(search_fts, 1, '<mark>', '</mark>', '...', 40) as snippet
    FROM search_fts
    JOIN search_map ON search_fts.rowid = search_map.rowid
    WHERE search_map.type = ? AND search_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `),
};

function getMeta(sessionId) {
  return stmts.get.get(sessionId) || null;
}

function getAllMeta() {
  const rows = stmts.getAll.all();
  const map = new Map();
  for (const row of rows) map.set(row.sessionId, row);
  return map;
}

function setName(sessionId, name) {
  runWithBusyRetry(() => stmts.upsertName.run(sessionId, name));
}

function toggleStar(sessionId) {
  runWithBusyRetry(() => stmts.upsertStar.run(sessionId));
  const row = stmts.get.get(sessionId);
  return row.starred;
}

function setArchived(sessionId, archived) {
  runWithBusyRetry(() => stmts.upsertArchived.run(sessionId, archived ? 1 : 0));
}

// --- Session cache functions ---

function isCachePopulated() {
  return stmts.cacheCount.get().cnt > 0;
}

function getAllCached() {
  return stmts.cacheGetAll.all();
}

const upsertCachedSessionsBatch = db.transaction((sessions) => {
  for (const s of sessions) {
    stmts.cacheUpsert.run(
      s.sessionId,
      s.folder,
      s.projectPath,
      s.summary,
      s.firstPrompt,
      s.created,
      s.modified,
      s.messageCount || 0,
      s.userMessageCount || 0,
      s.inputTokens || 0,
      s.outputTokens || 0,
      s.cacheCreationTokens || 0,
      s.cacheReadTokens || 0,
      s.largestUserPromptWords || 0,
      s.startedAt || null,
      s.lastEntryAt || null,
      s.activeMinutes || 0,
      s.slug || null,
      s.aiTitle || null,
      s.runtime || 'claude',
      s.sessionFile || null,
    );
  }
});

function upsertCachedSessions(sessions) {
  runWithBusyRetry(() => upsertCachedSessionsBatch(sessions));
}

function getCachedByFolder(folder) {
  return stmts.cacheGetByFolder.all(folder);
}

function getCachedFolder(sessionId) {
  const row = stmts.cacheGetFolder.get(sessionId);
  return row ? row.folder : null;
}

function getCachedSession(sessionId) {
  return stmts.cacheGetSession.get(sessionId) || null;
}

function deleteCachedSession(sessionId) {
  runWithBusyRetry(() => stmts.cacheDeleteSession.run(sessionId));
}

function deleteCachedFolder(folder) {
  runWithBusyRetry(() => {
    stmts.cacheDeleteFolder.run(folder);
    stmts.metaDelete.run(folder);
  });
}

function getFolderMeta(folder) {
  return stmts.metaGet.get(folder) || null;
}

function getAllFolderMeta() {
  const rows = stmts.metaGetAll.all();
  const map = new Map();
  for (const row of rows) map.set(row.folder, row);
  return map;
}

function setFolderMeta(folder, projectPath, indexMtimeMs) {
  runWithBusyRetry(() => stmts.metaUpsert.run(folder, projectPath, indexMtimeMs));
}

// --- FTS search functions ---

const upsertSearchEntriesBatch = db.transaction((entries) => {
  for (const e of entries) {
    // Delete any existing FTS row for this (id, type) pair before inserting.
    // search_map uses INSERT OR REPLACE which deletes the old row and creates
    // a new one with a new rowid, but the orphaned FTS5 row keyed to the old
    // rowid would never be cleaned up — causing duplicate search results and
    // unbounded FTS table growth.
    const existing = stmts.searchMapLookup.get(e.id, e.type);
    if (existing) {
      stmts.searchDeleteByRowid.run(existing.rowid);
      stmts.searchMapDeleteByRowid.run(existing.rowid);
    }
    const result = stmts.searchInsertMap.run(e.id, e.type, e.folder || null);
    stmts.searchInsertFts.run(result.lastInsertRowid, e.title || '', e.body || '');
  }
});

function deleteSearchSession(sessionId) {
  runWithBusyRetry(() => {
    stmts.searchDeleteBySession.run(sessionId);
    stmts.searchMapDeleteBySession.run(sessionId);
  });
}

function deleteSearchFolder(folder) {
  runWithBusyRetry(() => {
    stmts.searchDeleteByFolder.run(folder);
    stmts.searchMapDeleteByFolder.run(folder);
  });
}

function deleteSearchType(type) {
  runWithBusyRetry(() => {
    stmts.searchDeleteByType.run(type);
    stmts.searchMapDeleteByType.run(type);
  });
}

function upsertSearchEntries(entries) {
  runWithBusyRetry(() => upsertSearchEntriesBatch(entries));
}

function updateSearchTitle(id, type, title) {
  try {
    runWithBusyRetry(() => stmts.searchUpdateTitle.run(title, id, type));
  } catch {}
}

function searchByType(type, query, limit = 50, titleOnly = false) {
  try {
    // Wrap in double quotes for exact substring matching with trigram tokenizer.
    // This prevents FTS5 from splitting on punctuation (e.g. "spec.md" → "spec" + "md")
    const escaped = '"' + query.replace(/"/g, '""') + '"';
    // FTS5 column filter: prefix with "title:" to restrict match to title column
    const match = titleOnly ? 'title:' + escaped : escaped;
    return stmts.searchQuery.all(type, match, limit);
  } catch {
    return [];
  }
}

function isSearchIndexPopulated() {
  const row = db.prepare('SELECT COUNT(*) as cnt FROM search_map WHERE type = ?').get('session');
  return row.cnt > 0;
}

// --- Settings functions ---

function getSetting(key) {
  const row = stmts.settingsGet.get(key);
  if (!row) return null;
  try {
    return JSON.parse(row.value);
  } catch {
    return row.value;
  }
}

function setSetting(key, value) {
  runWithBusyRetry(() => stmts.settingsUpsert.run(key, JSON.stringify(value)));
}

function deleteSetting(key) {
  runWithBusyRetry(() => stmts.settingsDelete.run(key));
}

// --- Durable organization and schedule history ---

function requireNonEmptyString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  return value;
}

function parseJsonColumn(value) {
  if (value == null) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function toSavedView(row) {
  if (!row) return null;
  return { ...row, definition: parseJsonColumn(row.definition) };
}

function getSavedView(id) {
  return toSavedView(stmts.savedViewGet.get(id));
}

function listSavedViews() {
  return stmts.savedViewList.all().map(toSavedView);
}

function saveSavedView(view) {
  if (!view || typeof view !== 'object') throw new TypeError('view must be an object');
  const id = requireNonEmptyString(view.id, 'view.id');
  const name = requireNonEmptyString(view.name, 'view.name');
  const now = new Date().toISOString();
  const createdAt = view.createdAt || now;
  const updatedAt = view.updatedAt || now;
  const definition = JSON.stringify(view.definition ?? {});
  runWithBusyRetry(() => stmts.savedViewUpsert.run(id, name, definition, createdAt, updatedAt));
  return getSavedView(id);
}

function deleteSavedView(id) {
  return runWithBusyRetry(() => stmts.savedViewDelete.run(id)).changes > 0;
}

function getSessionNote(sessionId) {
  return stmts.sessionNoteGet.get(sessionId) || null;
}

function setSessionNote(sessionId, note, updatedAt = new Date().toISOString()) {
  requireNonEmptyString(sessionId, 'sessionId');
  if (typeof note !== 'string') throw new TypeError('note must be a string');
  runWithBusyRetry(() => stmts.sessionNoteUpsert.run(sessionId, note, updatedAt));
  return getSessionNote(sessionId);
}

function deleteSessionNote(sessionId) {
  return runWithBusyRetry(() => stmts.sessionNoteDelete.run(sessionId)).changes > 0;
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) throw new TypeError('tags must be an array');
  const unique = new Map();
  for (const tag of tags) {
    if (typeof tag !== 'string') throw new TypeError('each tag must be a string');
    const trimmed = tag.trim();
    const key = trimmed.toLocaleLowerCase();
    if (trimmed && !unique.has(key)) unique.set(key, trimmed);
  }
  return [...unique.values()];
}

const setSessionTagsTransaction = db.transaction((sessionId, tags, createdAt) => {
  stmts.sessionTagDelete.run(sessionId);
  for (const tag of tags) {
    stmts.tagInsert.run(tag, createdAt);
    const canonical = stmts.tagGetCanonical.get(tag);
    if (!canonical) {
      throw new Error('Could not resolve the saved session tag');
    }
    stmts.sessionTagInsert.run(sessionId, canonical.name, createdAt);
  }
  stmts.tagDeleteUnused.run();
});

function getSessionTags(sessionId) {
  return stmts.sessionTagList.all(sessionId).map((row) => row.name);
}

function setSessionTags(sessionId, tags, createdAt = new Date().toISOString()) {
  requireNonEmptyString(sessionId, 'sessionId');
  const normalized = normalizeTags(tags);
  runWithBusyRetry(() => setSessionTagsTransaction(sessionId, normalized, createdAt));
  return getSessionTags(sessionId);
}

function toScheduleRun(row) {
  if (!row) return null;
  return { ...row, metadata: parseJsonColumn(row.metadata) };
}

function getScheduleRun(id) {
  return toScheduleRun(stmts.scheduleRunGet.get(id));
}

function listScheduleRuns(scheduleId, limit = 100) {
  requireNonEmptyString(scheduleId, 'scheduleId');
  const safeLimit = Math.max(1, Math.min(1000, Number.isInteger(limit) ? limit : 100));
  return stmts.scheduleRunList.all(scheduleId, safeLimit).map(toScheduleRun);
}

function saveScheduleRun(run) {
  if (!run || typeof run !== 'object') throw new TypeError('run must be an object');
  const id = requireNonEmptyString(run.id, 'run.id');
  const scheduleId = requireNonEmptyString(run.scheduleId, 'run.scheduleId');
  const status = requireNonEmptyString(run.status, 'run.status');
  const startedAt = requireNonEmptyString(run.startedAt, 'run.startedAt');
  const metadata = run.metadata == null ? null : JSON.stringify(run.metadata);
  runWithBusyRetry(() =>
    stmts.scheduleRunUpsert.run(
      id,
      scheduleId,
      status,
      startedAt,
      run.finishedAt || null,
      run.sessionId || null,
      run.runtime || null,
      metadata,
      run.error || null,
    ),
  );
  return getScheduleRun(id);
}

function deleteScheduleRuns(scheduleId) {
  return runWithBusyRetry(() => stmts.scheduleRunDeleteBySchedule.run(scheduleId)).changes;
}

function closeDb() {
  try {
    db.close();
  } catch {}
}

module.exports = {
  getMeta,
  getAllMeta,
  setName,
  toggleStar,
  setArchived,
  isCachePopulated,
  getAllCached,
  getCachedByFolder,
  getCachedFolder,
  getCachedSession,
  upsertCachedSessions,
  deleteCachedSession,
  deleteCachedFolder,
  getFolderMeta,
  getAllFolderMeta,
  setFolderMeta,
  upsertSearchEntries,
  updateSearchTitle,
  deleteSearchSession,
  deleteSearchFolder,
  deleteSearchType,
  searchByType,
  isSearchIndexPopulated,
  searchFtsRecreated,
  getSetting,
  setSetting,
  deleteSetting,
  getSavedView,
  listSavedViews,
  saveSavedView,
  deleteSavedView,
  getSessionNote,
  setSessionNote,
  deleteSessionNote,
  getSessionTags,
  setSessionTags,
  getScheduleRun,
  listScheduleRuns,
  saveScheduleRun,
  deleteScheduleRuns,
  migrationBackupPath,
  closeDb,
};
