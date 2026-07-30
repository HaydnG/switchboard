const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const testDir = path.join(root, 'test');
const databaseTest = 'db-persistence.test.js';
const nodeTests = fs
  .readdirSync(testDir)
  .filter(file => file.endsWith('.test.js') && file !== databaseTest)
  .sort()
  .map(file => path.join('test', file));

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    stdio: 'inherit',
  });
  if (result.error) {
    console.error(result.error);
    return 1;
  }
  return result.status ?? 1;
}

const nodeExitCode = run(process.execPath, ['--test', ...nodeTests]);
if (nodeExitCode !== 0) process.exit(nodeExitCode);

// Native dependencies are rebuilt for Electron by postinstall. Run DB tests
// under Electron's Node runtime so local and CI tests use the same ABI as the
// packaged application without rebuilding node_modules back and forth.
const electronPath = require('electron');
const databaseExitCode = run(
  electronPath,
  ['--test', path.join('test', databaseTest)],
  { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
);
process.exit(databaseExitCode);
