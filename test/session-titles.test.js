const test = require('node:test');
const assert = require('node:assert/strict');

const sessionCache = require('../session-cache');

function initCacheDb(overrides = {}) {
  const namesSet = [];
  const upserted = [];
  sessionCache.init({
    PROJECTS_DIR: '/tmp',
    runtimeSessionsDirs: { claude: '/tmp' },
    activeSessions: new Map(),
    getMainWindow: () => null,
    log: console,
    db: {
      deleteCachedFolder() {},
      getCachedByFolder() { return []; },
      upsertCachedSessions(sessions) { upserted.push(...sessions); },
      deleteCachedSession() {},
      deleteSearchFolder() {},
      deleteSearchSession() {},
      upsertSearchEntries() {},
      setFolderMeta() {},
      getAllFolderMeta() { return new Map(); },
      getAllMeta() { return new Map(); },
      getAllCached() { return []; },
      getSetting() { return {}; },
      getMeta() { return null; },
      setName(id, name) { namesSet.push({ id, name }); },
      ...overrides,
    },
  });
  return { namesSet, upserted };
}

test('jsonlDisplayTitle prefers a /rename custom title over the AI title', () => {
  assert.equal(
    sessionCache.jsonlDisplayTitle({ customTitle: 'Renamed', aiTitle: 'Generated' }),
    'Renamed',
  );
  assert.equal(sessionCache.jsonlDisplayTitle({ aiTitle: 'Generated' }), 'Generated');
  assert.equal(sessionCache.jsonlDisplayTitle({}), null);
});

test('applyFolderRefreshResult stores JSONL titles on aiTitle instead of session_meta', () => {
  const { namesSet, upserted } = initCacheDb();

  sessionCache.applyFolderRefreshResult({
    folder: 'proj',
    projectPath: '/tmp/proj',
    indexMtimeMs: 1,
    sessionsToUpsert: [{
      sessionId: 's2',
      folder: 'proj',
      summary: 'hello',
      textContent: 'hello',
      customTitle: 'From /rename',
      aiTitle: 'Generated',
    }],
  });

  assert.deepEqual(namesSet, []);
  assert.equal(upserted[0].aiTitle, 'From /rename');
});

test('applyFolderRefreshResult does not overwrite a manual session name', () => {
  const meta = new Map([['s1', { name: 'Manual name' }]]);
  const { namesSet, upserted } = initCacheDb({
    getAllMeta() { return meta; },
    getMeta(id) { return meta.get(id) || null; },
  });

  sessionCache.applyFolderRefreshResult({
    folder: 'proj',
    projectPath: '/tmp/proj',
    indexMtimeMs: 1,
    sessionsToUpsert: [{
      sessionId: 's1',
      folder: 'proj',
      summary: 'hello',
      textContent: 'hello',
      customTitle: 'JSONL rename',
      aiTitle: 'Generated',
    }],
  });

  assert.deepEqual(namesSet, []);
  assert.equal(upserted[0].aiTitle, 'JSONL rename');
});

test('applyFolderRefreshResult keeps a remembered project path when no jsonl cwd exists', () => {
  const folderMeta = new Map([['proj', { folder: 'proj', projectPath: '/tmp/app' }]]);
  initCacheDb({
    getAllFolderMeta() { return folderMeta; },
    setFolderMeta(folder, projectPath, indexMtimeMs) {
      folderMeta.set(folder, { folder, projectPath, indexMtimeMs });
    },
  });

  sessionCache.applyFolderRefreshResult({
    folder: 'proj',
    projectPath: null,
    indexMtimeMs: 2,
  });

  assert.equal(folderMeta.get('proj').projectPath, '/tmp/app');
  assert.equal(folderMeta.get('proj').indexMtimeMs, 2);
});
