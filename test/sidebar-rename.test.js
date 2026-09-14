const test = require('node:test');
const assert = require('node:assert/strict');

const {
  sessionNameToPersist,
  isRenameUiEvent,
  isRenameInputActive,
} = require('../public/sidebar-rename');

test('sessionNameToPersist keeps a distinct manual name', () => {
  assert.equal(sessionNameToPersist('  My session  ', 'First user prompt'), 'My session');
});

test('sessionNameToPersist clears names that match the auto title', () => {
  assert.equal(sessionNameToPersist('First user prompt', 'First user prompt'), null);
  assert.equal(sessionNameToPersist('   ', 'First user prompt'), null);
  assert.equal(sessionNameToPersist('', 'First user prompt'), null);
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
