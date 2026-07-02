const path = require('path');
const os = require('os');
const fs = require('fs');
const { readSessionFile } = require('../read-session-file');
const { encodeProjectPath } = require('../encode-project-path');

function buildSpawnArgs({ sessionId, isNew, sessionOptions }) {
  const args = [];
  if (sessionOptions?.forkFrom) {
    args.push('--resume', String(sessionOptions.forkFrom), '--fork-session');
  } else if (isNew) {
    args.push('--session-id', String(sessionId));
  } else {
    args.push('--resume', String(sessionId));
  }

  if (sessionOptions) {
    if (sessionOptions.dangerouslySkipPermissions) {
      args.push('--dangerously-skip-permissions');
    } else if (sessionOptions.permissionMode) {
      args.push('--permission-mode', String(sessionOptions.permissionMode));
    }
    if (sessionOptions.worktree) {
      args.push('--worktree');
      if (sessionOptions.worktreeName) args.push(String(sessionOptions.worktreeName));
    }
    if (sessionOptions.chrome) args.push('--chrome');
    if (sessionOptions.addDirs) {
      for (const dir of String(sessionOptions.addDirs).split(',').map(d => d.trim()).filter(Boolean)) {
        args.push('--add-dir', dir);
      }
    }
  }
  if (sessionOptions?.appendSystemPrompt) {
    args.push('--append-system-prompt', String(sessionOptions.appendSystemPrompt));
  }
  return args;
}

function readResumeMetadata(agentProjectDir, sessionId) {
  try {
    const jsonlPath = path.join(agentProjectDir, sessionId + '.jsonl');
    const head = fs.readFileSync(jsonlPath, 'utf8').slice(0, 8000);
    for (const line of head.split('\n').filter(Boolean)) {
      const entry = JSON.parse(line);
      if (entry.slug) return { slug: entry.slug };
    }
  } catch {}
  return {};
}

function resolveLaunchOptions(effective) {
  const options = { runtime: 'claude' };
  if (effective.dangerouslySkipPermissions) {
    options.dangerouslySkipPermissions = true;
  } else if (effective.permissionMode) {
    options.permissionMode = effective.permissionMode;
  }
  if (effective.worktree) {
    options.worktree = true;
    if (effective.worktreeName) options.worktreeName = effective.worktreeName;
  }
  if (effective.chrome) options.chrome = true;
  if (effective.preLaunchCmd) options.preLaunchCmd = effective.preLaunchCmd;
  if (effective.addDirs) options.addDirs = effective.addDirs;
  if (effective.mcpEmulation === false) options.mcpEmulation = false;
  return options;
}

module.exports = {
  id: 'claude',
  label: 'Claude',
  command: 'claude',
  sessionsDir: path.join(os.homedir(), '.claude', 'projects'),
  ui: {
    badge: null,
    sidebarClass: null,
    iconClass: 'claude-icon',
    popoverIcon: 'claude',
    newSessionSummary: 'New session',
    configureLabel: 'Claude (Configure...)',
  },
  supportsMcp: true,
  supportsHandoff: true,
  usesTimestampedSessionFiles: false,
  encodeProjectPath,
  readSessionFile,
  sessionIdFromFilename: (filename) => path.basename(filename, '.jsonl'),
  resolveSessionFilePath(_sessionsDir, folder, sessionId) {
    return path.join(this.sessionsDir, folder, sessionId + '.jsonl');
  },
  buildSpawnArgs,
  readResumeMetadata,
  resolveLaunchOptions,
  transitionKind: 'claude',
};
