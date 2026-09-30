// Launches Switchboard against a seeded demo HOME with an isolated Electron
// profile and DB, exposing CDP on `port`. Never touches the real ~/.claude,
// ~/.switchboard or Electron userData.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..');

function writeEntryShim(manifest) {
  const shimDir = path.join(manifest.demoDir, 'app');
  fs.mkdirSync(shimDir, { recursive: true });
  fs.writeFileSync(
    path.join(shimDir, 'package.json'),
    JSON.stringify({ name: 'Switchboard', main: 'main.js' }),
  );
  fs.writeFileSync(
    path.join(shimDir, 'main.js'),
    [
      "const { app } = require('electron');",
      // main.js loads electron-reloader in dev, which reloads the renderer when
      // files in the repo change — including the screenshots we write to build/.
      "const Module = require('module');",
      'const load = Module._load;',
      "Module._load = function (request, ...rest) { return request === 'electron-reloader' ? () => {} : load.call(this, request, ...rest); };",
      `app.setPath('userData', ${JSON.stringify(manifest.userDataDir)});`,
      // Record at the display's native size. Simple fullscreen on macOS skips the
      // Spaces animation and also covers the menu bar and dock.
      "app.on('browser-window-created', (_e, win) => {",
      "  const go = () => (process.platform === 'darwin' ? win.setSimpleFullScreen(true) : win.setFullScreen(true));",
      "  win.once('ready-to-show', go);",
      '  setTimeout(go, 1500);',
      '});',
      `require(${JSON.stringify(path.join(repoRoot, 'main.js'))});`,
      '',
    ].join('\n'),
  );
  return shimDir;
}

function launch(manifest, { port = 9339 } = {}) {
  const shimDir = writeEntryShim(manifest);
  const env = {
    ...process.env,
    HOME: manifest.home,
    // Keeps the Keychain lookup from finding real Claude credentials.
    USER: 'switchboard-demo',
    SWITCHBOARD_DATA_DIR: manifest.dataDir,
    SHELL: '/bin/zsh',
  };
  delete env.ZDOTDIR;
  delete env.CLAUDE_CONFIG_DIR;
  delete env.ELECTRON_RUN_AS_NODE;
  const logFd = fs.openSync(path.join(manifest.demoDir, 'electron.log'), 'w');
  // The window is usually behind other windows while recording; without these
  // flags macOS occlusion stops the compositor and screencasts get no frames.
  const flags = [
    `--remote-debugging-port=${port}`,
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
  ];
  const child = spawn(require('electron'), [shimDir, ...flags], {
    cwd: repoRoot,
    env,
    detached: true,
    stdio: ['ignore', logFd, logFd],
  });
  fs.closeSync(logFd);
  return child;
}

module.exports = { launch };

if (require.main === module) {
  const { DEFAULT_DEMO_HOME } = require('./seed');
  const manifest = require(
    path.join(process.argv[2] || DEFAULT_DEMO_HOME, '.demo', 'manifest.json'),
  );
  const child = launch(manifest);
  console.log(`Switchboard demo running (pid ${child.pid}); CDP on 9339`);
  child.on('exit', (code) => process.exit(code ?? 0));
}
