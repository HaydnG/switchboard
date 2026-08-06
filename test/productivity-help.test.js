const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getShortcutReference,
  shortcutLabel,
  shouldShowProductivityOnboarding,
} = require('../public/productivity-help');

test('shortcut labels adapt the primary modifier to the platform', () => {
  assert.equal(shortcutLabel(['Mod', 'Shift', 'A'], 'darwin'), '⌘⇧A');
  assert.equal(shortcutLabel(['Mod', 'Shift', 'A'], 'linux'), 'Ctrl+Shift+A');
});

test('shortcut reference exposes the core productivity commands', () => {
  const shortcuts = getShortcutReference('darwin');

  assert.ok(shortcuts.some(shortcut => shortcut.display === '⌘K'));
  assert.ok(shortcuts.some(shortcut => shortcut.label.includes('attention')));
  assert.ok(shortcuts.some(shortcut => shortcut.display === '?'));
});

test('onboarding only appears for a new, sparse workspace', () => {
  assert.equal(shouldShowProductivityOnboarding(null, 0), true);
  assert.equal(shouldShowProductivityOnboarding(null, 2), false);
  assert.equal(shouldShowProductivityOnboarding('done', 0), false);
});
