const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const { getFolderIndexMtimeMs } = require('../folder-index-state');
const { deriveProjectPath } = require('../derive-project-path');
const { getRuntime } = require('../agent-runtimes');

const RUNTIMES = (workerData.runtimes || []).map(spec => ({
  id: spec.id,
  sessionsDir: spec.sessionsDir,
  runtime: getRuntime(spec.id),
}));

function readFolderFromFilesystem(runtime, folder) {
  const folderPath = path.join(runtime.sessionsDir, folder);
  const projectPath = deriveProjectPath(folderPath, folder);
  if (!projectPath) return null;
  const sessions = [];
  const indexMtimeMs = getFolderIndexMtimeMs(folderPath);

  try {
    const jsonlFiles = fs.readdirSync(folderPath).filter(f => f.endsWith('.jsonl'));
    for (const file of jsonlFiles) {
      const s = runtime.runtime.readSessionFile(path.join(folderPath, file), folder, projectPath);
      if (s) sessions.push(s);
    }
  } catch {}

  return { folder, projectPath, sessions, indexMtimeMs };
}

try {
  const jobs = [];
  for (const runtime of RUNTIMES) {
    if (!runtime.sessionsDir || !fs.existsSync(runtime.sessionsDir)) continue;
    const folders = fs.readdirSync(runtime.sessionsDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && d.name !== '.git')
      .map(d => d.name);
    for (const folder of folders) jobs.push({ runtime, folder });
  }

  const results = [];
  for (let i = 0; i < jobs.length; i++) {
    if (i % 5 === 0 || i === jobs.length - 1) {
      parentPort.postMessage({ type: 'progress', text: `Scanning projects (${i + 1}/${jobs.length})\u2026` });
    }
    const result = readFolderFromFilesystem(jobs[i].runtime, jobs[i].folder);
    if (result) results.push(result);
  }

  parentPort.postMessage({ ok: true, results });
} catch (err) {
  parentPort.postMessage({ ok: false, error: err.message });
}
