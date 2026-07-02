const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { encodePiProjectPath, isPiSessionFolder } = require('../encode-pi-project-path');

describe('encodePiProjectPath', () => {
  it('wraps sanitized paths with double dashes', () => {
    assert.equal(
      encodePiProjectPath('/Users/haydngynn/Projects/claudeProject'),
      '--Users-haydngynn-Projects-claudeProject--'
    );
    assert.equal(encodePiProjectPath('/Users/haydngynn'), '--Users-haydngynn--');
  });

  it('detects Pi session folders', () => {
    assert.equal(isPiSessionFolder('--Users-haydngynn--'), true);
    assert.equal(isPiSessionFolder('-Users-haydngynn-Projects-foo'), false);
  });
});
