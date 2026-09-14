const crypto = require('crypto');

const ATTENTION_HOOK_MARK = '/switchboard-attention-hook';
const MIN_TOKEN_LENGTH = 32;

function createAttentionHookToken() {
  return crypto.randomBytes(32).toString('hex');
}

function buildAttentionHookUrl(port, token) {
  return `http://127.0.0.1:${port}${ATTENTION_HOOK_MARK}?token=${encodeURIComponent(token)}`;
}

function tokensMatch(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string') return false;
  if (provided.length === 0 || provided.length !== expected.length) return false;
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function isAuthorizedAttentionHookRequest(req, expectedToken) {
  if (!req || req.method !== 'POST') return false;
  if (typeof expectedToken !== 'string' || expectedToken.length < MIN_TOKEN_LENGTH) return false;
  let parsed;
  try {
    parsed = new URL(req.url || '', 'http://127.0.0.1');
  } catch {
    return false;
  }
  if (parsed.pathname !== ATTENTION_HOOK_MARK) return false;
  return tokensMatch(parsed.searchParams.get('token') || '', expectedToken);
}

module.exports = {
  ATTENTION_HOOK_MARK,
  buildAttentionHookUrl,
  createAttentionHookToken,
  isAuthorizedAttentionHookRequest,
  tokensMatch,
};
