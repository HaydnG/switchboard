const path = require('path');
const fs = require('fs');

/** Extract the Pi session UUID from a session filename (timestamp_uuid.jsonl). */
function sessionIdFromPiFilename(filename) {
  const base = path.basename(filename, '.jsonl');
  const idx = base.lastIndexOf('_');
  if (idx === -1) return null;
  return base.slice(idx + 1) || null;
}

/** Find a Pi session .jsonl filename in a folder by session UUID. */
function findPiSessionFile(folderPath, sessionId) {
  try {
    const suffix = `_${sessionId}.jsonl`;
    for (const file of fs.readdirSync(folderPath)) {
      if (file.endsWith(suffix)) return file;
    }
  } catch {}
  return null;
}

/** Resolve the on-disk path for a Pi session file. */
function resolvePiSessionFilePath(sessionsDir, folder, sessionId, sessionFile) {
  const folderPath = path.join(sessionsDir, folder);
  const file = sessionFile || findPiSessionFile(folderPath, sessionId);
  if (!file) return null;
  return path.join(folderPath, file);
}

module.exports = {
  sessionIdFromPiFilename,
  findPiSessionFile,
  resolvePiSessionFilePath,
};
