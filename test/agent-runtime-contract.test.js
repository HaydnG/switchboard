const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getAgentRuntimes,
  getRuntimeUiCatalog,
  validateRuntimeDefinition,
} = require('../agent-runtimes');

test('all bundled agent runtimes satisfy the adapter contract', () => {
  for (const runtime of getAgentRuntimes()) {
    assert.deepEqual(
      validateRuntimeDefinition(runtime),
      [],
      `${runtime.id || 'unknown'} runtime contract`,
    );
  }
});

test('runtime UI catalog contains capability flags for every adapter', () => {
  const catalog = getRuntimeUiCatalog();

  assert.deepEqual(
    catalog.map(runtime => runtime.id),
    ['claude', 'pi', 'omp'],
  );
  for (const runtime of catalog) {
    assert.equal(typeof runtime.supportsHandoff, 'boolean');
    assert.equal(typeof runtime.hasConfigureDialog, 'boolean');
  }
});

test('validateRuntimeDefinition explains malformed adapters', () => {
  const errors = validateRuntimeDefinition({ id: 'broken' });

  assert.ok(errors.includes('label must be a non-empty string'));
  assert.ok(errors.includes('buildSpawnArgs must be a function'));
  assert.ok(errors.includes('ui must be an object'));
});
