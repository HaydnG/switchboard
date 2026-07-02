const path = require('path');
const os = require('os');
const { createPiLikeSessionReader } = require('./read-pi-like-session');
const {
  sessionIdFromFilename,
  resolveSessionFilePath,
} = require('./timestamped-jsonl');

/** omp stores sessions relative to $HOME under ~/.omp/agent/sessions/ */
function encodeProjectPath(projectPath, home = os.homedir()) {
  let rel = projectPath;
  if (projectPath.startsWith(home + path.sep)) {
    rel = projectPath.slice(home.length);
  } else if (projectPath === home) {
    rel = '';
  }
  const sanitized = rel.replace(/[^a-zA-Z0-9]/g, '-').replace(/^-+/, '');
  if (sanitized.length <= 200) return `-${sanitized}`;
  let h = 0;
  for (let i = 0; i < projectPath.length; i++) {
    h = (h << 5) - h + projectPath.charCodeAt(i) | 0;
  }
  return `-${sanitized.slice(0, 200)}-${Math.abs(h).toString(36)}`;
}

function buildSpawnArgs({ sessionId, isNew, sessionOptions }) {
  const args = [];
  if (sessionOptions?.forkFrom) {
    args.push(`--resume=${String(sessionOptions.forkFrom)}`, '--fork');
  } else if (!isNew) {
    args.push(`--resume=${String(sessionId)}`);
  }
  if (sessionOptions?.model) args.push('--model', String(sessionOptions.model));
  if (sessionOptions?.provider) args.push('--provider', String(sessionOptions.provider));
  if (sessionOptions?.thinking) args.push('--thinking', String(sessionOptions.thinking));
  if (sessionOptions?.appendSystemPrompt) {
    args.push('--append-system-prompt', String(sessionOptions.appendSystemPrompt));
  }
  return args;
}

function resolveLaunchOptions(effective) {
  const options = { runtime: 'omp' };
  if (effective.ompModel) options.model = effective.ompModel;
  if (effective.ompProvider) options.provider = effective.ompProvider;
  if (effective.ompThinking) options.thinking = effective.ompThinking;
  if (effective.preLaunchCmd) options.preLaunchCmd = effective.preLaunchCmd;
  return options;
}

module.exports = {
  id: 'omp',
  label: 'omp',
  command: 'omp',
  sessionsDir: path.join(os.homedir(), '.omp', 'agent', 'sessions'),
  ui: {
    badge: 'omp',
    sidebarClass: 'is-omp',
    iconClass: 'omp-icon',
    popoverIcon: 'omp',
    newSessionSummary: 'New omp session',
    configureLabel: 'omp (Configure...)',
  },
  supportsMcp: false,
  supportsHandoff: false,
  usesTimestampedSessionFiles: true,
  encodeProjectPath,
  readSessionFile: createPiLikeSessionReader('omp', {
    titleFromEntry(entry) {
      if (entry.type === 'title' && entry.title) return entry.title;
      if (entry.type === 'session' && entry.title) return entry.title;
      return null;
    },
  }),
  sessionIdFromFilename,
  resolveSessionFilePath,
  buildSpawnArgs,
  readResumeMetadata() {
    return {};
  },
  resolveLaunchOptions,
  transitionKind: 'pi-like',
};
