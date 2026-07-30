const fs = require('fs');
const path = require('path');
const { quoteArgvForShell } = require('./shell-profiles');

const PATH_AUTHORIZATION_ERROR = 'path is not authorized for this project';

const SENSITIVE_PATH_PATTERNS = [
  /[/\\]\.ssh(?:[/\\]|$)/i,
  /[/\\]\.gnupg(?:[/\\]|$)/i,
  /[/\\]\.aws[/\\]credentials$/i,
  /[/\\]\.env(?:\.[^/\\]+)?$/i,
  /[/\\]\.netrc$/i,
  /[/\\]\.docker[/\\]config\.json$/i,
  /[/\\]\.kube[/\\]config$/i,
];

function isPathInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

function canonicalizeWithExistingAncestor(candidate) {
  let ancestor = candidate;
  const missingSegments = [];

  while (!fs.existsSync(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) return null;
    missingSegments.unshift(path.basename(ancestor));
    ancestor = parent;
  }

  const canonicalAncestor = fs.realpathSync.native
    ? fs.realpathSync.native(ancestor)
    : fs.realpathSync(ancestor);
  return path.resolve(canonicalAncestor, ...missingSegments);
}

/**
 * Resolve a file path against one or more project roots and reject traversal,
 * symlink escapes, and known credential locations.
 */
function authorizeProjectPath(filePath, projectRoots) {
  if (typeof filePath !== 'string' || !filePath || filePath.includes('\0')) {
    return { ok: false, error: PATH_AUTHORIZATION_ERROR, reason: 'invalid path' };
  }

  const roots = [
    ...new Set((projectRoots || []).filter((root) => typeof root === 'string' && root)),
  ]
    .map((root) => {
      try {
        const resolved = path.resolve(root);
        if (!fs.statSync(resolved).isDirectory()) return null;
        return fs.realpathSync.native
          ? fs.realpathSync.native(resolved)
          : fs.realpathSync(resolved);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  if (roots.length === 0) {
    return { ok: false, error: PATH_AUTHORIZATION_ERROR, reason: 'no authorized project' };
  }

  const candidates = path.isAbsolute(filePath)
    ? [path.resolve(filePath)]
    : roots.map((root) => path.resolve(root, filePath));

  for (const candidate of candidates) {
    if (SENSITIVE_PATH_PATTERNS.some((pattern) => pattern.test(candidate))) {
      return { ok: false, error: PATH_AUTHORIZATION_ERROR, reason: 'sensitive path' };
    }

    try {
      const canonical = canonicalizeWithExistingAncestor(candidate);
      if (
        canonical &&
        !SENSITIVE_PATH_PATTERNS.some((pattern) => pattern.test(canonical)) &&
        roots.some((root) => isPathInside(root, canonical))
      ) {
        return { ok: true, path: canonical };
      }
    } catch {
      // Treat filesystem resolution failures as authorization failures.
    }
  }

  return { ok: false, error: PATH_AUTHORIZATION_ERROR, reason: 'outside authorized project' };
}

/**
 * Parse a command prefix into argv without asking a shell to interpret it.
 * The setting is an executable prefix (for example `aws-vault exec profile --`),
 * not an arbitrary shell script.
 */
function parseCommandPrefix(command) {
  const input = String(command || '');
  if (/[\0\r\n]/.test(input)) throw new Error('preLaunchCmd contains invalid characters');

  const argv = [];
  let token = '';
  let quote = null;
  let tokenStarted = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (quote) {
      if (char === quote) {
        quote = null;
        tokenStarted = true;
      } else if (char === '\\' && quote === '"' && i + 1 < input.length) {
        const next = input[i + 1];
        if (next === '"' || next === '\\') {
          token += next;
          i++;
        } else {
          token += char;
        }
        tokenStarted = true;
      } else {
        token += char;
        tokenStarted = true;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      tokenStarted = true;
    } else if (/\s/.test(char)) {
      if (tokenStarted) {
        argv.push(token);
        token = '';
        tokenStarted = false;
      }
    } else if (char === '\\' && i + 1 < input.length) {
      const next = input[i + 1];
      if (/\s/.test(next) || next === '"' || next === "'" || next === '\\') {
        token += next;
        i++;
      } else {
        token += char;
      }
      tokenStarted = true;
    } else {
      token += char;
      tokenStarted = true;
    }
  }

  if (quote) throw new Error('preLaunchCmd contains an unterminated quote');
  if (tokenStarted) argv.push(token);
  if (argv.length === 0) throw new Error('preLaunchCmd is empty');
  return argv;
}

function buildSafeCommandPrefix(shellPath, command) {
  const quoted = quoteArgvForShell(shellPath, parseCommandPrefix(command));
  const shellName = path.basename(shellPath).toLowerCase();
  return shellName.includes('powershell') || shellName.includes('pwsh') ? `& ${quoted}` : quoted;
}

function isTrustedIpcSender(event, mainWindow, expectedUrl) {
  if (!event || !mainWindow || mainWindow.isDestroyed?.()) return false;
  const webContents = mainWindow.webContents;
  const frame = event.senderFrame;
  if (!webContents || event.sender !== webContents || !frame) return false;
  if (webContents.mainFrame && frame !== webContents.mainFrame) return false;
  return !expectedUrl || frame.url === expectedUrl;
}

function logRejectedOperation(log, { source, operation, target, reason }) {
  const safeTarget = typeof target === 'string' ? target.replace(/[\r\n]/g, '').slice(0, 1000) : '';
  log?.warn?.('[security] rejected operation', {
    source,
    operation,
    reason: reason || 'unauthorized',
    target: safeTarget,
  });
}

module.exports = {
  PATH_AUTHORIZATION_ERROR,
  authorizeProjectPath,
  buildSafeCommandPrefix,
  isTrustedIpcSender,
  logRejectedOperation,
  parseCommandPrefix,
};
