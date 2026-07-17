const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const { getFolderIndexMtimeMs } = require('../folder-index-state');
const { deriveProjectPath } = require('../derive-project-path');
const { getRuntime } = require('../agent-runtimes');

function refreshFolder({ runtimeId, sessionsDir, folder, cachedSessions }) {
  const runtime = getRuntime(runtimeId);
  const folderPath = path.join(sessionsDir, folder);
  if (!fs.existsSync(folderPath)) return { folder, missing: true };

  const projectPath = deriveProjectPath(folderPath, folder);
  if (!projectPath) {
    return { folder, projectPath: null, indexMtimeMs: getFolderIndexMtimeMs(folderPath) };
  }

  const cachedById = new Map((cachedSessions || []).map(session => [session.sessionId, session.modified]));
  const currentIds = new Set();
  const sessionsToUpsert = [];
  const jsonlFiles = fs.readdirSync(folderPath).filter(file => file.endsWith('.jsonl'));

  for (const file of jsonlFiles) {
    const filePath = path.join(folderPath, file);
    let modified;
    try { modified = fs.statSync(filePath).mtime.toISOString(); } catch { continue; }

    const provisionalId = runtime.sessionIdFromFilename(file);
    if (provisionalId && cachedById.get(provisionalId) === modified) {
      currentIds.add(provisionalId);
      continue;
    }

    const session = runtime.readSessionFile(filePath, folder, projectPath);
    if (!session) continue;
    currentIds.add(session.sessionId);
    if (cachedById.get(session.sessionId) !== modified) sessionsToUpsert.push(session);
  }

  const sessionsToDelete = [...cachedById.keys()].filter(sessionId => !currentIds.has(sessionId));
  return {
    folder,
    projectPath,
    indexMtimeMs: getFolderIndexMtimeMs(folderPath),
    sessionsToUpsert,
    sessionsToDelete,
  };
}

try {
  parentPort.postMessage({ ok: true, result: refreshFolder(workerData) });
} catch (err) {
  parentPort.postMessage({ ok: false, error: err.message });
}
