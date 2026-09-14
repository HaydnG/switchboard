const test = require('node:test');
const assert = require('node:assert/strict');
const { shouldDeleteStaleLock, settlePendingDiff } = require('../mcp-bridge');

test('shouldDeleteStaleLock only removes dead Switchboard locks', () => {
  const alive = () => true;
  const dead = () => false;

  assert.equal(shouldDeleteStaleLock({ ideName: 'VS Code', pid: 1 }, dead), false);
  assert.equal(shouldDeleteStaleLock({ ideName: 'Switchboard', pid: 99 }, alive), false);
  assert.equal(shouldDeleteStaleLock({ ideName: 'Switchboard', pid: 99 }, dead), true);
  assert.equal(shouldDeleteStaleLock({ ideName: 'Switchboard', pid: 'nope' }, dead), true);
  assert.equal(shouldDeleteStaleLock({ ideName: 'Switchboard', pid: process.pid }, (pid) => pid === process.pid), false);
});

test('settlePendingDiff resolves once and clears its timeout', () => {
  const resolved = [];
  const pending = {
    resolve: (value) => resolved.push(value),
    settled: false,
    timeout: setTimeout(() => {}, 60_000),
  };
  pending.timeout.unref();

  assert.equal(settlePendingDiff(pending, { action: 'reject' }), true);
  assert.equal(settlePendingDiff(pending, { action: 'accept' }), false);
  assert.deepEqual(resolved, [{ action: 'reject' }]);
  assert.equal(pending.timeout, null);
});
