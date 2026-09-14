const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ATTENTION_HOOK_MARK,
  buildAttentionHookUrl,
  createAttentionHookToken,
  isAuthorizedAttentionHookRequest,
  tokensMatch,
} = require('../attention-hook-auth');

test('attention hook URLs keep the sentinel path and include the token', () => {
  const token = createAttentionHookToken();
  assert.ok(token.length >= 32);
  const url = buildAttentionHookUrl(43111, token);
  assert.equal(url, `http://127.0.0.1:43111${ATTENTION_HOOK_MARK}?token=${token}`);
});

test('attention hook requests require POST, the sentinel path, and the token', () => {
  const token = createAttentionHookToken();
  const url = `${ATTENTION_HOOK_MARK}?token=${token}`;

  assert.equal(isAuthorizedAttentionHookRequest({ method: 'POST', url }, token), true);
  assert.equal(isAuthorizedAttentionHookRequest({ method: 'GET', url }, token), false);
  assert.equal(isAuthorizedAttentionHookRequest({ method: 'POST', url: '/other?token=' + token }, token), false);
  assert.equal(
    isAuthorizedAttentionHookRequest({ method: 'POST', url: `${ATTENTION_HOOK_MARK}?token=nope` }, token),
    false,
  );
  assert.equal(isAuthorizedAttentionHookRequest({ method: 'POST', url: ATTENTION_HOOK_MARK }, token), false);
});

test('tokensMatch rejects empty or different-length values', () => {
  assert.equal(tokensMatch('abc', 'abc'), true);
  assert.equal(tokensMatch('abc', 'abd'), false);
  assert.equal(tokensMatch('', ''), false);
  assert.equal(tokensMatch('ab', 'abc'), false);
});
