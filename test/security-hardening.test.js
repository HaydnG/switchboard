const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  PATH_AUTHORIZATION_ERROR,
  authorizeMarkdownPath,
  authorizePlanPath,
  authorizeProjectPath,
  buildSafeCommandPrefix,
  isPathInside,
  isTrustedIpcSender,
  parseCommandPrefix,
} = require('../security-hardening');
const { _handleMessageForTest } = require('../mcp-bridge');

function makeTempProjects(t) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-security-'));
  const project = path.join(tempDir, 'project');
  const outside = path.join(tempDir, 'outside');
  fs.mkdirSync(project);
  fs.mkdirSync(outside);
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  return { project, outside };
}

test('project path authorization permits project files and relative paths', (t) => {
  const { project } = makeTempProjects(t);
  const filePath = path.join(project, 'src', 'index.js');
  fs.mkdirSync(path.dirname(filePath));
  fs.writeFileSync(filePath, 'ok');
  const canonicalFilePath = fs.realpathSync.native
    ? fs.realpathSync.native(filePath)
    : fs.realpathSync(filePath);

  assert.deepEqual(authorizeProjectPath(filePath, [project]), {
    ok: true,
    path: canonicalFilePath,
  });
  assert.deepEqual(authorizeProjectPath('src/index.js', [project]), {
    ok: true,
    path: canonicalFilePath,
  });
});

test('project path authorization rejects traversal, siblings, and sensitive files', (t) => {
  const { project, outside } = makeTempProjects(t);
  const outsideFile = path.join(outside, 'secret.txt');
  fs.writeFileSync(outsideFile, 'secret');
  fs.writeFileSync(path.join(project, '.env.production'), 'TOKEN=secret');

  for (const candidate of [
    outsideFile,
    path.join(project, '..', 'outside', 'secret.txt'),
    path.join(project, '.env.production'),
  ]) {
    const result = authorizeProjectPath(candidate, [project]);
    assert.equal(result.ok, false);
    assert.equal(result.error, PATH_AUTHORIZATION_ERROR);
  }
});

test('project path authorization rejects symlinks that escape the project', (t) => {
  const { project, outside } = makeTempProjects(t);
  const outsideFile = path.join(outside, 'secret.txt');
  const link = path.join(project, 'linked-secret.txt');
  fs.writeFileSync(outsideFile, 'secret');
  fs.symlinkSync(outsideFile, link);

  const result = authorizeProjectPath(link, [project]);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'outside authorized project');
});

test('pre-launch executable prefixes preserve quoted arguments', () => {
  assert.deepEqual(parseCommandPrefix('aws-vault exec "team profile" --'), [
    'aws-vault',
    'exec',
    'team profile',
    '--',
  ]);
  assert.equal(
    buildSafeCommandPrefix('/bin/zsh', 'aws-vault exec "team profile" --'),
    "'aws-vault' 'exec' 'team profile' '--'",
  );
  assert.deepEqual(parseCommandPrefix('"C:\\Program Files\\wrapper.exe" profile --'), [
    'C:\\Program Files\\wrapper.exe',
    'profile',
    '--',
  ]);
  assert.equal(
    buildSafeCommandPrefix(
      'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
      'aws-vault exec profile --',
    ),
    "& 'aws-vault' 'exec' 'profile' '--'",
  );
});

test('pre-launch shell metacharacters remain literal argv data', () => {
  const prefix = buildSafeCommandPrefix(
    '/bin/bash',
    'aws-vault exec profile --; touch /tmp/pwned $(whoami)',
  );
  assert.equal(prefix, "'aws-vault' 'exec' 'profile' '--;' 'touch' '/tmp/pwned' '$(whoami)'");
  assert.throws(() => parseCommandPrefix('wrapper "unterminated'), /unterminated quote/);
  assert.throws(() => parseCommandPrefix('wrapper\nmalicious'), /invalid characters/);
});

test('sensitive IPC accepts only the expected main frame', () => {
  const mainFrame = { url: 'file:///app/public/index.html' };
  const webContents = { mainFrame };
  const mainWindow = {
    isDestroyed: () => false,
    webContents,
  };

  assert.equal(
    isTrustedIpcSender(
      {
        sender: webContents,
        senderFrame: mainFrame,
      },
      mainWindow,
      mainFrame.url,
    ),
    true,
  );
  assert.equal(
    isTrustedIpcSender(
      {
        sender: webContents,
        senderFrame: { url: mainFrame.url },
      },
      mainWindow,
      mainFrame.url,
    ),
    false,
  );
  assert.equal(
    isTrustedIpcSender(
      {
        sender: webContents,
        senderFrame: mainFrame,
      },
      mainWindow,
      'file:///unexpected.html',
    ),
    false,
  );
});

test('MCP file tools reject paths outside their workspace and log the operation', async (t) => {
  const { project, outside } = makeTempProjects(t);
  const outsideFile = path.join(outside, 'secret.txt');
  fs.writeFileSync(outsideFile, 'secret');

  const sent = [];
  const warnings = [];
  const entry = {
    sessionId: 'session-1',
    workspaceFolders: [project],
    pendingDiffs: new Map(),
    ws: {
      readyState: 1,
      send: (message) => sent.push(JSON.parse(message)),
    },
  };
  const log = {
    warn: (...args) => warnings.push(args),
    debug: () => {},
    info: () => {},
  };

  await _handleMessageForTest(
    entry,
    JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'openFile',
        arguments: { filePath: outsideFile },
      },
    }),
    log,
  );

  assert.equal(sent.length, 1);
  assert.equal(sent[0].error.code, -32001);
  assert.equal(sent[0].error.message, PATH_AUTHORIZATION_ERROR);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0][0], '[security] rejected operation');
  assert.equal(warnings[0][1].operation, 'openFile');
});

test('isPathInside rejects sibling directories that share a prefix', (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-prefix-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const plans = path.join(tempDir, 'plans');
  const plansEvil = path.join(tempDir, 'plans-evil');
  fs.mkdirSync(plans);
  fs.mkdirSync(plansEvil);

  assert.equal(isPathInside(plans, path.join(plans, 'note.md')), true);
  assert.equal(isPathInside(plans, path.join(plansEvil, 'pwn.md')), false);
  assert.equal(plansEvil.startsWith(plans), true);
});

test('plan path authorization confines writes to basename inside the plans directory', (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-plans-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const plansDir = path.join(tempDir, 'plans');
  const plansEvil = path.join(tempDir, 'plans-evil');
  fs.mkdirSync(plansDir);
  fs.mkdirSync(plansEvil);
  fs.writeFileSync(path.join(plansEvil, 'pwn.md'), 'nope');

  const canonicalPlans = fs.realpathSync.native
    ? fs.realpathSync.native(plansDir)
    : fs.realpathSync(plansDir);
  const confined = authorizePlanPath(path.join(plansEvil, 'pwn.md'), plansDir);
  assert.equal(confined.ok, true);
  assert.equal(path.basename(confined.path), 'pwn.md');
  assert.equal(isPathInside(canonicalPlans, confined.path), true);

  const rejected = authorizePlanPath('../secret.md', plansDir);
  assert.equal(rejected.ok, true);
  assert.equal(path.basename(rejected.path), 'secret.md');
  assert.equal(isPathInside(canonicalPlans, rejected.path), true);

  const notMarkdown = authorizePlanPath('notes.txt', plansDir);
  assert.equal(notMarkdown.ok, false);
  assert.equal(notMarkdown.reason, 'not a markdown file');
});

test('markdown path authorization rejects symlink escapes and non-markdown files', (t) => {
  const { project, outside } = makeTempProjects(t);
  const outsideFile = path.join(outside, 'secret.md');
  const link = path.join(project, 'linked.md');
  fs.writeFileSync(outsideFile, 'secret');
  fs.symlinkSync(outsideFile, link);
  fs.writeFileSync(path.join(project, 'notes.txt'), 'nope');
  fs.writeFileSync(path.join(project, 'CLAUDE.md'), 'ok');

  assert.equal(authorizeMarkdownPath(link, [project]).ok, false);
  assert.equal(authorizeMarkdownPath(path.join(project, 'notes.txt'), [project]).ok, false);
  assert.equal(authorizeMarkdownPath(path.join(project, 'CLAUDE.md'), [project]).ok, true);
});
