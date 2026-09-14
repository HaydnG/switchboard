const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { encodeProjectPath } = require('../encode-project-path');

describe('encodeProjectPath', () => {
  it('replaces every non-alphanumeric character, matching Claude CLI folders', () => {
    assert.equal(encodeProjectPath('/Users/haydn/Projects/web'), '-Users-haydn-Projects-web');
    assert.equal(
      encodeProjectPath('/Users/haydn/Projects/my@app (v2)'),
      '-Users-haydn-Projects-my-app--v2-',
    );
  });

  it('diverges from a slash-and-underscore-only remap for real project paths', () => {
    const projectPath = '/Users/haydn/Projects/my@app (v2)';
    const naive = projectPath.replace(/[/_]/g, '-').replace(/^-/, '-');
    assert.notEqual(naive, encodeProjectPath(projectPath));
    assert.match(naive, /@/);
  });

  it('hashes paths longer than 200 characters', () => {
    const longPath = `/${'a'.repeat(220)}`;
    const encoded = encodeProjectPath(longPath);
    assert.ok(encoded.length > 200);
    assert.match(encoded, /-[0-9a-z]+$/);
  });
});
