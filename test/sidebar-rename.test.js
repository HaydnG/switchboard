const test = require('node:test');
const assert = require('node:assert/strict');

const {
  sessionNameToPersist,
  preserveManualSessionName,
  isRenameUiEvent,
  isRenameInputActive,
} = require('../public/sidebar-rename');

test('sessionNameToPersist keeps a distinct manual name', () => {
  assert.equal(sessionNameToPersist('  My session  ', 'First user prompt'), 'My session');
});

test('sessionNameToPersist keeps a name that matches the auto title', () => {
  assert.equal(sessionNameToPersist('First user prompt', 'First user prompt'), 'First user prompt');
});

test('sessionNameToPersist clears only empty names', () => {
  assert.equal(sessionNameToPersist('   ', 'First user prompt'), null);
  assert.equal(sessionNameToPersist('', 'First user prompt'), null);
});

test('preserveManualSessionName keeps an in-memory name when the snapshot is empty', () => {
  assert.equal(preserveManualSessionName('Auth work', null), 'Auth work');
  assert.equal(preserveManualSessionName('Auth work', ''), 'Auth work');
  assert.equal(preserveManualSessionName('Auth work', 'From DB'), 'From DB');
  assert.equal(preserveManualSessionName(null, null), null);
});

test('isRenameUiEvent matches title and rename input clicks', () => {
  assert.equal(isRenameUiEvent({ closest: () => ({}) }), true);
  assert.equal(isRenameUiEvent({ closest: () => null }), false);
  assert.equal(isRenameUiEvent(null), false);
});

test('isRenameInputActive detects an open rename field', () => {
  assert.equal(isRenameInputActive({ querySelector: (sel) => sel.includes('session-rename-input') && {} }), true);
  assert.equal(isRenameInputActive({ querySelector: () => null }), false);
});
