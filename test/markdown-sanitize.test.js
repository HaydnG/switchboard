const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const createDOMPurify = require('dompurify');
const { isSafeInlineImagePath, sanitizeMarkdownHtml } = require('../public/markdown-sanitize');

function purify() {
  const window = new JSDOM('').window;
  return createDOMPurify(window);
}

test('isSafeInlineImagePath allows raster images and rejects sensitive or scriptable paths', () => {
  assert.equal(isSafeInlineImagePath('/tmp/shot.png'), true);
  assert.equal(isSafeInlineImagePath('/Users/me/Desktop/photo.JPEG'), true);
  assert.equal(isSafeInlineImagePath('/tmp/notes.svg'), false);
  assert.equal(isSafeInlineImagePath('/tmp/../.ssh/id_rsa.png'), false);
  assert.equal(isSafeInlineImagePath('/Users/me/.ssh/id_rsa.png'), false);
  assert.equal(isSafeInlineImagePath('file:///tmp/shot.png'), false);
  assert.equal(isSafeInlineImagePath(''), false);
});

test('sanitizeMarkdownHtml strips javascript URLs and raw HTML event handlers', () => {
  const html = sanitizeMarkdownHtml(
    '<p><a href="javascript:alert(1)">click</a><img src="x" onerror="alert(1)"></p>',
    purify(),
  );
  assert.equal(/javascript:/i.test(html), false);
  assert.equal(/onerror/i.test(html), false);
  assert.match(html, /click/);
});

test('sanitizeMarkdownHtml strips file: image URLs', () => {
  const html = sanitizeMarkdownHtml('<p><img src="file:///etc/passwd"></p>', purify());
  assert.equal(/file:/i.test(html), false);
});

test('sanitizeMarkdownHtml returns empty when no sanitizer is available', () => {
  assert.equal(sanitizeMarkdownHtml('<p>hi</p>', null), '');
});
