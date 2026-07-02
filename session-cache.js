const path = require('path');
const fs = require('fs');
const { Worker } = require('worker_threads');
const { getFolderIndexMtimeMs } = require('./folder-index-state');
const { deriveProjectPath } = require('./derive-project-path');
const { encodeProjectPath } = require('./encode-project-path');
const {
  getAgentRuntimes,
  getRuntime,
  readSessionFileForRuntime,
  sessionIdFromFile,
} = require('./agent-runtimes');

let activeSessions, getMainWindow, log;
let deleteCachedFolder, getCachedByFolder, upsertCachedSessions, deleteCachedSession;
let deleteSearchFolder, deleteSearchSession, upsertSearchEntries;
let setFolderMeta, getAllFolderMeta, getAllMeta, getAllCached, getSetting, getMeta, setName;
let runtimeSessionsDirs = null;

function sessionsDirFor(runtime) {
  return runtimeSessionsDirs?.[runtime.id] ?? runtime.sessionsDir;
}

function init(ctx) {
  activeSessions = ctx.activeSessions;
  getMainWindow = ctx.getMainWindow;
  log = ctx.log;
  runtimeSessionsDirs = ctx.runtimeSessionsDirs || null;
  deleteCachedFolder = ctx.db.deleteCachedFolder;
  getCachedByFolder = ctx.db.getCachedByFolder;
  upsertCachedSessions = ctx.db.upsertCachedSessions;
  deleteCachedSession = ctx.db.deleteCachedSession;
  deleteSearchFolder = ctx.db.deleteSearchFolder;
  deleteSearchSession = ctx.db.deleteSearchSession;
  upsertSearchEntries = ctx.db.upsertSearchEntries;
  setFolderMeta = ctx.db.setFolderMeta;
  getAllFolderMeta = ctx.db.getAllFolderMeta;
  getAllMeta = ctx.db.getAllMeta;
  getAllCached = ctx.db.getAllCached;
  getSetting = ctx.db.getSetting;
  getMeta = ctx.db.getMeta;
  setName = ctx.db.setName;
}

function readFolderFromFilesystem(runtime, folder) {
  const folderPath = path.join(sessionsDirFor(runtime), folder);
  const projectPath = deriveProjectPath(folderPath, folder);
  if (!projectPath) return { projectPath: null, sessions: [] };
  const sessions = [];

  try {
    const jsonlFiles = fs.readdirSync(folderPath).filter(f => f.endsWith('.jsonl'));
    for (const file of jsonlFiles) {
      const s = runtime.readSessionFile(path.join(folderPath, file), folder, projectPath);
      if (s) sessions.push(s);
    }
  } catch {}

  return { projectPath, sessions };
}

function refreshFolderForRuntime(runtime, folder) {
  const folderPath = path.join(sessionsDirFor(runtime), folder);
  if (!fs.existsSync(folderPath)) {
    deleteCachedFolder(folder);
    return;
  }

  const projectPath = deriveProjectPath(folderPath, folder);
  if (!projectPath) {
    setFolderMeta(folder, null, getFolderIndexMtimeMs(folderPath));
    return;
  }

  const cachedSessions = getCachedByFolder(folder);
  const cachedMap = new Map();
  for (const row of cachedSessions) {
    cachedMap.set(row.sessionId, row.modified);
  }

  let jsonlFiles;
  try {
    jsonlFiles = fs.readdirSync(folderPath).filter(f => f.endsWith('.jsonl'));
  } catch { return; }

  const currentIds = new Set();
  const sessionsToUpsert = [];
  const searchEntriesToUpsert = [];
  const namesToSet = [];
  const sessionsToDelete = [];

  for (const file of jsonlFiles) {
    const filePath = path.join(folderPath, file);
    let fileMtime;
    try { fileMtime = fs.statSync(filePath).mtime.toISOString(); } catch { continue; }

    const provisionalId = runtime.sessionIdFromFilename(file);
    if (provisionalId && cachedMap.has(provisionalId) && cachedMap.get(provisionalId) === fileMtime) {
      currentIds.add(provisionalId);
      continue;
    }

    const s = runtime.readSessionFile(filePath, folder, projectPath);
    if (!s) continue;
    currentIds.add(s.sessionId);

    if (cachedMap.has(s.sessionId) && cachedMap.get(s.sessionId) === fileMtime) {
      continue;
    }

    sessionsToUpsert.push(s);
    const name = getMeta(s.sessionId)?.name || s.customTitle || s.aiTitle || '';
    searchEntriesToUpsert.push({
      id: s.sessionId, type: 'session', folder: s.folder,
      title: (name ? name + ' ' : '') + s.summary, body: s.textContent,
    });
    if (s.customTitle) namesToSet.push({ id: s.sessionId, name: s.customTitle });
  }

  for (const sessionId of cachedMap.keys()) {
    if (!currentIds.has(sessionId)) sessionsToDelete.push(sessionId);
  }

  if (sessionsToUpsert.length > 0) upsertCachedSessions(sessionsToUpsert);
  for (const entry of searchEntriesToUpsert) deleteSearchSession(entry.id);
  if (searchEntriesToUpsert.length > 0) upsertSearchEntries(searchEntriesToUpsert);
  for (const { id, name } of namesToSet) setName(id, name);
  for (const sessionId of sessionsToDelete) {
    deleteCachedSession(sessionId);
    deleteSearchSession(sessionId);
  }

  setFolderMeta(folder, projectPath, getFolderIndexMtimeMs(folderPath));
}

/** Back-compat wrapper used by Claude-only transition watcher. */
function refreshFolder(folder) {
  refreshFolderForRuntime(getRuntime('claude'), folder);
}

function reconcileDir(runtime) {
  const sessionsDir = sessionsDirFor(runtime);
  if (!sessionsDir || !fs.existsSync(sessionsDir)) return;
  const metaMap = getAllFolderMeta();
  const folders = fs.readdirSync(sessionsDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name !== '.git')
    .map(d => d.name);

  for (const folder of folders) {
    const meta = metaMap.get(folder);
    const folderPath = path.join(sessionsDir, folder);
    if (!meta || getFolderIndexMtimeMs(folderPath) > (meta.indexMtimeMs || 0)) {
      refreshFolderForRuntime(runtime, folder);
    }
  }
}

function reconcileCacheFromFilesystem() {
  try {
    for (const runtime of getAgentRuntimes()) {
      reconcileDir(runtime);
    }
  } catch (err) {
    console.error('Error reconciling cache:', err);
  }
}

function buildProjectsFromCache(showArchived) {
  const metaMap = getAllMeta();
  const cachedRows = getAllCached();
  const global = getSetting('global') || {};
  const hiddenProjects = new Set(global.hiddenProjects || []);

  const projectMap = new Map();
  for (const row of cachedRows) {
    if (!row.projectPath) continue;
    if (hiddenProjects.has(row.projectPath)) continue;
    const meta = metaMap.get(row.sessionId);
    const s = {
      sessionId: row.sessionId,
      summary: row.summary,
      firstPrompt: row.firstPrompt,
      created: row.created,
      modified: row.modified,
      messageCount: row.messageCount,
      userMessageCount: row.userMessageCount || 0,
      inputTokens: row.inputTokens || 0,
      outputTokens: row.outputTokens || 0,
      cacheCreationTokens: row.cacheCreationTokens || 0,
      cacheReadTokens: row.cacheReadTokens || 0,
      largestUserPromptWords: row.largestUserPromptWords || 0,
      startedAt: row.startedAt || null,
      lastEntryAt: row.lastEntryAt || null,
      activeMinutes: row.activeMinutes || 0,
      projectPath: row.projectPath,
      slug: row.slug || null,
      aiTitle: row.aiTitle || null,
      runtime: row.runtime || 'claude',
      sessionFile: row.sessionFile || null,
      name: meta?.name || null,
      starred: meta?.starred || 0,
      archived: meta?.archived || 0,
    };
    if (!showArchived && s.archived) continue;
    if (!projectMap.has(row.projectPath)) {
      projectMap.set(row.projectPath, {
        folder: encodeProjectPath(row.projectPath),
        projectPath: row.projectPath,
        missing: !fs.existsSync(row.projectPath),
        sessions: [],
      });
    }
    projectMap.get(row.projectPath).sessions.push(s);
  }

  for (const runtime of getAgentRuntimes()) {
    const sessionsDir = sessionsDirFor(runtime);
    if (!sessionsDir || !fs.existsSync(sessionsDir)) continue;
    const folderMeta = getAllFolderMeta();
    const dirs = fs.readdirSync(sessionsDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && d.name !== '.git');
    for (const d of dirs) {
      let projectPath = folderMeta.get(d.name)?.projectPath;
      if (!projectPath) {
        projectPath = deriveProjectPath(path.join(sessionsDir, d.name), d.name);
        if (projectPath) setFolderMeta(d.name, projectPath, 0);
      }
      if (!projectPath) continue;
      if (hiddenProjects.has(projectPath)) continue;
      if (!projectMap.has(projectPath)) {
        projectMap.set(projectPath, {
          folder: encodeProjectPath(projectPath),
          projectPath,
          missing: !fs.existsSync(projectPath),
          sessions: [],
        });
      }
    }
  }

  for (const [sessionId, session] of activeSessions) {
    if (session.exited || !session.isPlainTerminal) continue;
    if (!session.projectPath) continue;
    if (hiddenProjects.has(session.projectPath)) continue;
    if (!projectMap.has(session.projectPath)) {
      projectMap.set(session.projectPath, {
        folder: encodeProjectPath(session.projectPath),
        projectPath: session.projectPath,
        sessions: [],
      });
    }
    const proj = projectMap.get(session.projectPath);
    if (!proj.sessions.some(s => s.sessionId === sessionId)) {
      proj.sessions.push({
        sessionId, summary: 'Terminal', firstPrompt: '', projectPath: session.projectPath,
        name: null, starred: 0, archived: 0, messageCount: 0,
        modified: new Date(session._openedAt).toISOString(),
        created: new Date(session._openedAt).toISOString(),
        type: 'terminal',
      });
    }
  }

  for (const [sessionId, session] of activeSessions) {
    if (session.exited || session.isPlainTerminal || !session.runtime) continue;
    const runtime = getRuntime(session.runtime);
    if (!session.projectPath) continue;
    if (hiddenProjects.has(session.projectPath)) continue;
    if (!projectMap.has(session.projectPath)) {
      projectMap.set(session.projectPath, {
        folder: runtime.encodeProjectPath(session.projectPath),
        projectPath: session.projectPath,
        sessions: [],
      });
    }
    const proj = projectMap.get(session.projectPath);
    if (!proj.sessions.some(s => s.sessionId === sessionId)) {
      proj.sessions.push({
        sessionId,
        summary: runtime.ui.newSessionSummary,
        firstPrompt: '',
        projectPath: session.projectPath,
        runtime: runtime.id,
        name: null,
        starred: 0,
        archived: 0,
        messageCount: 0,
        modified: new Date(session._openedAt || Date.now()).toISOString(),
        created: new Date(session._openedAt || Date.now()).toISOString(),
      });
    }
  }

  const projects = [];
  for (const proj of projectMap.values()) {
    proj.sessions.sort((a, b) => new Date(b.modified) - new Date(a.modified));
    projects.push(proj);
  }

  projects.sort((a, b) => {
    if (a.missing && !b.missing) return 1;
    if (!a.missing && b.missing) return -1;
    if (a.sessions.length === 0 && b.sessions.length > 0) return 1;
    if (b.sessions.length === 0 && a.sessions.length > 0) return -1;
    const aDate = a.sessions[0]?.modified || '';
    const bDate = b.sessions[0]?.modified || '';
    return new Date(bDate) - new Date(aDate);
  });

  return projects;
}

function notifyRendererProjectsChanged() {
  const mainWindow = getMainWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('projects-changed');
  }
}

function sendStatus(text, type) {
  if (text) log.info(`[status] (${type || 'info'}) ${text}`);
  const mw = getMainWindow();
  if (mw && !mw.isDestroyed()) {
    mw.webContents.send('status-update', text, type || 'info');
  }
}

let populatingCache = false;

function populateCacheViaWorker() {
  if (populatingCache) return;
  populatingCache = true;
  sendStatus('Scanning projects\u2026', 'active');

  const worker = new Worker(path.join(__dirname, 'workers', 'scan-projects.js'), {
    workerData: {
      runtimes: getAgentRuntimes().map(runtime => ({
        id: runtime.id,
        sessionsDir: sessionsDirFor(runtime),
      })),
    },
  });

  worker.on('message', (msg) => {
    if (msg.type === 'progress') {
      sendStatus(msg.text, 'active');
      return;
    }

    if (!msg.ok) {
      console.error('Worker scan error:', msg.error);
      sendStatus('Scan failed: ' + msg.error, 'error');
      populatingCache = false;
      return;
    }

    sendStatus(`Indexing ${msg.results.length} projects\u2026`, 'active');

    let sessionCount = 0;
    for (const { folder, projectPath, sessions, indexMtimeMs } of msg.results) {
      deleteCachedFolder(folder);
      deleteSearchFolder(folder);
      if (sessions.length > 0) {
        sessionCount += sessions.length;
        upsertCachedSessions(sessions);
        for (const s of sessions) {
          if (s.customTitle) setName(s.sessionId, s.customTitle);
        }
        upsertSearchEntries(sessions.map(s => {
          const name = getMeta(s.sessionId)?.name || s.customTitle || s.aiTitle || '';
          return {
            id: s.sessionId, type: 'session', folder: s.folder,
            title: (name ? name + ' ' : '') + s.summary,
            body: s.textContent,
          };
        }));
      }
      setFolderMeta(folder, projectPath, indexMtimeMs);
    }

    populatingCache = false;
    sendStatus(`Indexed ${sessionCount} sessions across ${msg.results.length} projects`, 'done');
    setTimeout(() => sendStatus(''), 5000);
    notifyRendererProjectsChanged();
  });

  worker.on('error', (err) => {
    console.error('Worker error:', err);
    sendStatus('Worker error: ' + err.message, 'error');
    populatingCache = false;
  });

  worker.on('exit', (code) => {
    if (populatingCache) {
      populatingCache = false;
      if (code !== 0) sendStatus('Scan worker exited unexpectedly', 'error');
    }
  });
}

module.exports = {
  init,
  readSessionFileForRuntime,
  readFolderFromFilesystem,
  refreshFolder,
  refreshFolderForRuntime,
  reconcileCacheFromFilesystem,
  buildProjectsFromCache,
  notifyRendererProjectsChanged,
  sendStatus,
  populateCacheViaWorker,
};
