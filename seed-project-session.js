const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getRuntime, RUNTIMES, DEFAULT_RUNTIME_ID } = require('./agent-runtimes');

function resolveAddProjectRuntimeId(runtimeId) {
  if (typeof runtimeId === 'string' && Object.prototype.hasOwnProperty.call(RUNTIMES, runtimeId)) {
    return runtimeId;
  }
  return DEFAULT_RUNTIME_ID;
}

function addProjectRuntimeLabel(runtimeId) {
  const id = resolveAddProjectRuntimeId(runtimeId);
  if (id === 'claude') return 'Claude Code';
  return getRuntime(id).label;
}

function seedFilename(runtime, sessionId, now = new Date()) {
  if (runtime.usesTimestampedSessionFiles) {
    return `${now.toISOString().replace(/[:.]/g, '-')}_${sessionId}.jsonl`;
  }
  return `${sessionId}.jsonl`;
}

function seedSessionLine(projectPath, sessionId, now = new Date()) {
  return JSON.stringify({
    type: 'user',
    cwd: projectPath,
    sessionId,
    uuid: crypto.randomUUID(),
    timestamp: now.toISOString(),
    message: { role: 'user', content: 'New project' },
  });
}

function ensureProjectSessionFolder(projectPath, runtimeId, options = {}) {
  const runtime = getRuntime(resolveAddProjectRuntimeId(runtimeId));
  const sessionsDir = options.sessionsDir || runtime.sessionsDir;
  const folder = runtime.encodeProjectPath(projectPath);
  const folderPath = path.join(sessionsDir, folder);
  fs.mkdirSync(folderPath, { recursive: true });

  const hasJsonl = fs.readdirSync(folderPath).some((file) => file.endsWith('.jsonl'));
  let seeded = false;
  let sessionFile = null;
  if (options.seed !== false && !hasJsonl) {
    const sessionId = options.sessionId || crypto.randomUUID();
    const now = options.now || new Date();
    sessionFile = seedFilename(runtime, sessionId, now);
    fs.writeFileSync(path.join(folderPath, sessionFile), seedSessionLine(projectPath, sessionId, now) + '\n');
    seeded = true;
  }

  return {
    runtimeId: runtime.id,
    folder,
    folderPath,
    sessionFile,
    seeded,
  };
}

module.exports = {
  resolveAddProjectRuntimeId,
  addProjectRuntimeLabel,
  seedFilename,
  seedSessionLine,
  ensureProjectSessionFolder,
};
