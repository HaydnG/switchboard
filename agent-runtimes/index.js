const claude = require('./claude');
const pi = require('./pi');
const omp = require('./omp');

const RUNTIMES = Object.freeze({
  claude,
  pi,
  omp,
});

const DEFAULT_RUNTIME_ID = 'claude';
const REQUIRED_RUNTIME_FUNCTIONS = Object.freeze([
  'encodeProjectPath',
  'readSessionFile',
  'sessionIdFromFilename',
  'resolveSessionFilePath',
  'buildSpawnArgs',
  'readResumeMetadata',
  'resolveLaunchOptions',
]);

function validateRuntimeDefinition(runtime) {
  const errors = [];
  if (!runtime || typeof runtime !== 'object') return ['runtime must be an object'];
  for (const field of ['id', 'label', 'command', 'sessionsDir', 'transitionKind']) {
    if (typeof runtime[field] !== 'string' || !runtime[field].trim()) {
      errors.push(`${field} must be a non-empty string`);
    }
  }
  for (const functionName of REQUIRED_RUNTIME_FUNCTIONS) {
    if (typeof runtime[functionName] !== 'function') {
      errors.push(`${functionName} must be a function`);
    }
  }
  if (!runtime.ui || typeof runtime.ui !== 'object') {
    errors.push('ui must be an object');
  }
  return errors;
}

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
  REQUIRED_RUNTIME_FUNCTIONS,
  validateRuntimeDefinition,
  getRuntime,
  getAgentRuntimes,
  getRuntimeUiCatalog,
  getRuntimeForFolder,
  resolveRuntimeId,
  readSessionFileForRuntime,
  sessionIdFromFile,
};
