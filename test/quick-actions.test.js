const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getQuickActionsForSession,
  buildQuickReplyPayload,
  isQuickActionAllowed,
} = require('../public/quick-actions');

function ids(actions) {
  return actions.map((a) => a.id);
}

test('no live pty means no quick actions regardless of status', () => {
  assert.deepEqual(getQuickActionsForSession({ status: 'needs-attention', hasLivePty: false }), []);
  assert.deepEqual(getQuickActionsForSession({ status: 'response-ready', hasLivePty: false }), []);
  assert.deepEqual(getQuickActionsForSession({ status: 'busy', hasLivePty: false }), []);
});

test('needs-attention offers approve, deny, and reply with exact payloads', () => {
  const actions = getQuickActionsForSession({ status: 'needs-attention', hasLivePty: true });

  assert.deepEqual(ids(actions), ['approve', 'deny', 'reply']);

  const approve = actions.find((a) => a.id === 'approve');
  assert.equal(approve.label, 'Approve');
  assert.equal(approve.send, '1');
  assert.equal(approve.tone, 'safe');
  assert.equal(approve.title, 'Choose option 1 (Yes)');

  const deny = actions.find((a) => a.id === 'deny');
  assert.equal(deny.label, 'Deny');
  assert.equal(deny.send, '\u001b');
  assert.equal(deny.tone, 'danger');
  assert.equal(deny.title, 'Send Escape (dismiss prompt)');

  const reply = actions.find((a) => a.id === 'reply');
  assert.equal(reply.label, 'Reply…');
  assert.equal(reply.send, null);
  assert.equal(reply.tone, 'neutral');
  assert.equal(reply.title, 'Type a reply');
});

test('response-ready, idle, and busy sessions with a live pty only offer reply', () => {
  for (const status of ['response-ready', 'idle', 'busy']) {
    const actions = getQuickActionsForSession({ status, hasLivePty: true });
    assert.deepEqual(ids(actions), ['reply']);
  }
});

test('running sessions get reply only; exited get nothing', () => {
  assert.deepEqual(getQuickActionsForSession({ status: 'running', hasLivePty: true }).map(a => a.id), ['reply']);
  assert.deepEqual(getQuickActionsForSession({ status: 'exited', hasLivePty: true }), []);
});

test('quick reply payload trims trailing newlines and appends carriage return', () => {
  assert.equal(buildQuickReplyPayload('hello'), 'hello\r');
  assert.equal(buildQuickReplyPayload('hello\n'), 'hello\r');
  assert.equal(buildQuickReplyPayload('hello\r\n'), 'hello\r');
  assert.equal(buildQuickReplyPayload('hello\n\n\n'), 'hello\r');
  assert.equal(buildQuickReplyPayload('  hello  '), '  hello  \r');
});

test('quick reply payload returns null for empty or whitespace-only input', () => {
  assert.equal(buildQuickReplyPayload(''), null);
  assert.equal(buildQuickReplyPayload('   '), null);
  assert.equal(buildQuickReplyPayload('\n\n'), null);
  assert.equal(buildQuickReplyPayload(undefined), null);
  assert.equal(buildQuickReplyPayload(null), null);
});

test('approve/deny are only allowed while needs-attention with a live pty', () => {
  const approve = { id: 'approve' };
  const deny = { id: 'deny' };

  assert.equal(isQuickActionAllowed(approve, { status: 'needs-attention', hasLivePty: true }), true);
  assert.equal(isQuickActionAllowed(deny, { status: 'needs-attention', hasLivePty: true }), true);

  assert.equal(isQuickActionAllowed(approve, { status: 'needs-attention', hasLivePty: false }), false);
  assert.equal(isQuickActionAllowed(deny, { status: 'needs-attention', hasLivePty: false }), false);
});

test('stale approve action is rejected once status has moved on', () => {
  const approve = { id: 'approve' };

  // Rendered while needs-attention, but by click time the agent moved to busy.
  assert.equal(isQuickActionAllowed(approve, { status: 'busy', hasLivePty: true }), false);
  assert.equal(isQuickActionAllowed(approve, { status: 'response-ready', hasLivePty: true }), false);
  assert.equal(isQuickActionAllowed(approve, { status: 'exited', hasLivePty: true }), false);
});

test('reply is allowed for any status as long as the pty is live', () => {
  const reply = { id: 'reply' };

  for (const status of ['needs-attention', 'response-ready', 'busy', 'running', 'idle', 'exited']) {
    assert.equal(isQuickActionAllowed(reply, { status, hasLivePty: true }), true);
  }
  assert.equal(isQuickActionAllowed(reply, { status: 'response-ready', hasLivePty: false }), false);
});

test('unknown action ids are never allowed', () => {
  assert.equal(isQuickActionAllowed({ id: 'nonsense' }, { status: 'needs-attention', hasLivePty: true }), false);
  assert.equal(isQuickActionAllowed(null, { status: 'needs-attention', hasLivePty: true }), false);
});
