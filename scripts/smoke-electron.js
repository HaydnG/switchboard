const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const root = path.resolve(__dirname, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-smoke-'));
const electronPath = require('electron');
const child = spawn(electronPath, ['.'], {
  cwd: root,
  env: {
    ...process.env,
    SWITCHBOARD_DATA_DIR: dataDir,
    SWITCHBOARD_SMOKE_TEST: '1',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let output = '';
const collect = chunk => {
  const text = chunk.toString();
  output += text;
  process.stdout.write(text);
};
child.stdout.on('data', collect);
child.stderr.on('data', collect);

const timer = setTimeout(() => {
  child.kill('SIGTERM');
  console.error('[smoke] timed out waiting for Electron');
}, 20_000);

child.on('exit', code => {
  clearTimeout(timer);
  fs.rmSync(dataDir, { recursive: true, force: true });
  const passed = code === 0 && output.includes('[smoke] renderer-ready');
  process.exit(passed ? 0 : code || 1);
});

child.on('error', error => {
  clearTimeout(timer);
  fs.rmSync(dataDir, { recursive: true, force: true });
  console.error('[smoke] failed to launch Electron:', error.message);
  process.exit(1);
});
