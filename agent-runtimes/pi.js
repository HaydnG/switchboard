const path = require('path');
const os = require('os');
const { createPiLikeSessionReader } = require('./read-pi-like-session');
const {
  sessionIdFromFilename,
  resolveSessionFilePath,
} = require('./timestamped-jsonl');

function encodeProjectPath(projectPath) {
  let sanitized = projectPath.replace(/[^a-zA-Z0-9]/g, '-').replace(/^-+/, '');
  if (sanitized.length <= 200) return `--${sanitized}--`;
  let h = 0;
  for (let i = 0; i < projectPath.length; i++) {
    h = (h << 5) - h + projectPath.charCodeAt(i) | 0;
  }
  return `--${sanitized.slice(0, 200)}-${Math.abs(h).toString(36)}--`;
}

function buildSpawnArgs({ sessionId, isNew, sessionOptions }) {
  const args = [];
  if (sessionOptions?.forkFrom) {
    args.push('--fork', String(sessionOptions.forkFrom));
  } else if (isNew) {
    args.push('--session-id', String(sessionId));
  } else {
    args.push('--session', String(sessionId));
  }
  if (sessionOptions?.name) args.push('--name', String(sessionOptions.name));
  if (sessionOptions?.provider) args.push('--provider', String(sessionOptions.provider));
  if (sessionOptions?.model) args.push('--model', String(sessionOptions.model));
  if (sessionOptions?.thinking) args.push('--thinking', String(sessionOptions.thinking));
  if (sessionOptions?.appendSystemPrompt) {
    args.push('--append-system-prompt', String(sessionOptions.appendSystemPrompt));
  }
  return args;
}

function resolveLaunchOptions(effective) {
  const options = { runtime: 'pi' };
  if (effective.piProvider) options.provider = effective.piProvider;
  if (effective.piModel) options.model = effective.piModel;
  if (effective.piThinking) options.thinking = effective.piThinking;
  if (effective.preLaunchCmd) options.preLaunchCmd = effective.preLaunchCmd;
  return options;
}

module.exports = {
  id: 'pi',
  label: 'Pi',
  command: 'pi',
  sessionsDir: path.join(os.homedir(), '.pi', 'agent', 'sessions'),
  ui: {
    badge: 'π',
    sidebarClass: 'is-pi',
    iconClass: 'pi-icon',
    popoverIcon: 'pi',
    newSessionSummary: 'New Pi session',
    configureLabel: 'Pi (Configure...)',
  },
  supportsMcp: false,
  supportsHandoff: false,
  usesTimestampedSessionFiles: true,
  encodeProjectPath,
  readSessionFile: createPiLikeSessionReader('pi'),
  sessionIdFromFilename,
  resolveSessionFilePath,
  buildSpawnArgs,
  readResumeMetadata() {
    return {};
  },
  resolveLaunchOptions,
  transitionKind: 'pi-like',
};
