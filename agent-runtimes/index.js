const claude = require('./claude');
const pi = require('./pi');
const omp = require('./omp');

const RUNTIMES = Object.freeze({
  claude,
  pi,
  omp,
});

const DEFAULT_RUNTIME_ID = 'claude';

function getRuntime(id) {
  return RUNTIMES[id] || RUNTIMES[DEFAULT_RUNTIME_ID];
}

function getAgentRuntimes() {
  return Object.values(RUNTIMES);
}

function getRuntimeUiCatalog() {
  return getAgentRuntimes().map(runtime => ({
    id: runtime.id,
    label: runtime.label,
    command: runtime.command,
    ...runtime.ui,
    supportsHandoff: !!runtime.supportsHandoff,
    hasConfigureDialog: runtime.id === 'claude' || runtime.id === 'pi' || runtime.id === 'omp',
  }));
}

function getRuntimeForFolder(sessionsDir) {
  return getAgentRuntimes().find(runtime => runtime.sessionsDir === sessionsDir) || null;
}

function resolveRuntimeId(sessionOptions, cachedSession) {
  if (sessionOptions?.type === 'terminal') return null;
  return sessionOptions?.runtime || cachedSession?.runtime || DEFAULT_RUNTIME_ID;
}

function readSessionFileForRuntime(runtimeId, filePath, folder, projectPath) {
  return getRuntime(runtimeId).readSessionFile(filePath, folder, projectPath);
}

function sessionIdFromFile(runtimeId, filePath) {
  const runtime = getRuntime(runtimeId);
  return runtime.sessionIdFromFilename(require('path').basename(filePath));
}

module.exports = {
  RUNTIMES,
  DEFAULT_RUNTIME_ID,
  getRuntime,
  getAgentRuntimes,
  getRuntimeUiCatalog,
  getRuntimeForFolder,
  resolveRuntimeId,
  readSessionFileForRuntime,
  sessionIdFromFile,
};
