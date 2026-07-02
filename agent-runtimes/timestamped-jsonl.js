const path = require('path');
const fs = require('fs');

/** Extract session UUID from timestamp_uuid.jsonl filenames. */
function sessionIdFromFilename(filename) {
  const base = path.basename(filename, '.jsonl');
  const idx = base.lastIndexOf('_');
  if (idx === -1) return null;
  return base.slice(idx + 1) || null;
}

function findSessionFile(folderPath, sessionId) {
  try {
    const suffix = `_${sessionId}.jsonl`;
    for (const file of fs.readdirSync(folderPath)) {
      if (file.endsWith(suffix)) return file;
    }
  } catch {}
  return null;
}

function resolveSessionFilePath(sessionsDir, folder, sessionId, sessionFile) {
  const folderPath = path.join(sessionsDir, folder);
  const file = sessionFile || findSessionFile(folderPath, sessionId);
  if (!file) return null;
  return path.join(folderPath, file);
}

function readSessionHeader(filePath) {
  try {
    const head = fs.readFileSync(filePath, 'utf8').slice(0, 4096);
    for (const line of head.split('\n')) {
      if (!line) continue;
      const entry = JSON.parse(line);
      if (entry.type === 'session' && entry.id) return { sessionId: entry.id };
    }
  } catch {}
  return { sessionId: null };
}

module.exports = {
  sessionIdFromFilename,
  findSessionFile,
  resolveSessionFilePath,
  readSessionHeader,
};
