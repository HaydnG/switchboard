const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createPromptQueueStore,
  enqueuePrompt,
  removePrompt,
  clearQueue,
  getQueue,
  queuedCount,
  shouldDeliverPrompt,
  takeNextPrompt,
  serializeQueues,
  deserializeQueues,
} = require('../public/prompt-queue');

test('createPromptQueueStore returns an empty, plain store', () => {
  assert.deepEqual(createPromptQueueStore(), { queues: {} });
});

test('enqueuePrompt trims text and stores the created item', () => {
  const store = createPromptQueueStore();
  const item = enqueuePrompt(store, 's1', '  do the thing  ', 1000);

  assert.equal(item.text, 'do the thing');
  assert.equal(item.createdAt, 1000);
  assert.equal(item.id, 'q-1000-0');
  assert.deepEqual(store.queues.s1, [item]);
});

test('enqueuePrompt rejects empty or whitespace-only text', () => {
  const store = createPromptQueueStore();

  assert.equal(enqueuePrompt(store, 's1', '', 1000), null);
  assert.equal(enqueuePrompt(store, 's1', '   ', 1000), null);
  assert.equal(enqueuePrompt(store, 's1', undefined, 1000), null);
  assert.deepEqual(store.queues, {});
});

test('enqueuePrompt assigns unique ids for the same timestamp', () => {
  const store = createPromptQueueStore();
  const first = enqueuePrompt(store, 's1', 'a', 5000);
  const second = enqueuePrompt(store, 's1', 'b', 5000);
  const third = enqueuePrompt(store, 's2', 'c', 5000);

  assert.notEqual(first.id, second.id);
  assert.notEqual(second.id, third.id);
  assert.equal(first.id, 'q-5000-0');
  assert.equal(second.id, 'q-5000-1');
  assert.equal(third.id, 'q-5000-2');
});

test('takeNextPrompt dequeues FIFO and returns null when empty', () => {
  const store = createPromptQueueStore();
  enqueuePrompt(store, 's1', 'first', 1);
  enqueuePrompt(store, 's1', 'second', 2);

  const first = takeNextPrompt(store, 's1');
  assert.equal(first.text, 'first');

  const second = takeNextPrompt(store, 's1');
  assert.equal(second.text, 'second');

  assert.equal(takeNextPrompt(store, 's1'), null);
  assert.equal(store.queues.s1, undefined);
});

test('removePrompt drops the item and empties the queue entry', () => {
  const store = createPromptQueueStore();
  const item = enqueuePrompt(store, 's1', 'only', 1);

  assert.equal(removePrompt(store, 's1', 'missing-id'), false);
  assert.equal(removePrompt(store, 's1', item.id), true);
  assert.equal(store.queues.s1, undefined);
  assert.equal(removePrompt(store, 's1', item.id), false);
});

test('removePrompt keeps sibling items when the queue is not emptied', () => {
  const store = createPromptQueueStore();
  const first = enqueuePrompt(store, 's1', 'first', 1);
  enqueuePrompt(store, 's1', 'second', 2);

  removePrompt(store, 's1', first.id);
  assert.equal(store.queues.s1.length, 1);
  assert.equal(store.queues.s1[0].text, 'second');
});

test('clearQueue removes every item and returns the count removed', () => {
  const store = createPromptQueueStore();
  enqueuePrompt(store, 's1', 'a', 1);
  enqueuePrompt(store, 's1', 'b', 2);

  assert.equal(clearQueue(store, 's1'), 2);
  assert.equal(store.queues.s1, undefined);
  assert.equal(clearQueue(store, 's1'), 0);
});

test('getQueue returns a copy that cannot mutate internal state', () => {
  const store = createPromptQueueStore();
  enqueuePrompt(store, 's1', 'a', 1);

  const copy = getQueue(store, 's1');
  copy.push({ id: 'bogus', text: 'x', createdAt: 1 });
  copy[0].text = 'mutated';

  assert.equal(store.queues.s1.length, 1);
  assert.equal(store.queues.s1[0].text, 'a');
});

test('getQueue returns an empty array for a session with no items', () => {
  const store = createPromptQueueStore();
  assert.deepEqual(getQueue(store, 'nope'), []);
});

test('queuedCount reports queue length, zero when absent', () => {
  const store = createPromptQueueStore();
  enqueuePrompt(store, 's1', 'a', 1);
  enqueuePrompt(store, 's1', 'b', 2);

  assert.equal(queuedCount(store, 's1'), 2);
  assert.equal(queuedCount(store, 'nope'), 0);
});

test('shouldDeliverPrompt truth table across statuses, pty, and queue length', () => {
  const statuses = ['needs-attention', 'response-ready', 'busy', 'idle', 'exited'];
  const deliverable = new Set(['response-ready', 'idle']);

  for (const status of statuses) {
    for (const hasLivePty of [true, false]) {
      for (const queueLength of [0, 1, 3]) {
        const result = shouldDeliverPrompt({ status, hasLivePty, queueLength });
        const expected = queueLength > 0 && hasLivePty && deliverable.has(status);
        assert.equal(
          result,
          expected,
          `status=${status} hasLivePty=${hasLivePty} queueLength=${queueLength}`
        );
      }
    }
  }
});

test('shouldDeliverPrompt never delivers into a permission prompt or busy turn', () => {
  assert.equal(
    shouldDeliverPrompt({ status: 'needs-attention', hasLivePty: true, queueLength: 5 }),
    false
  );
  assert.equal(shouldDeliverPrompt({ status: 'busy', hasLivePty: true, queueLength: 5 }), false);
  assert.equal(shouldDeliverPrompt({ status: 'exited', hasLivePty: true, queueLength: 5 }), false);
});

test('serializeQueues then deserializeQueues round-trips the store', () => {
  const store = createPromptQueueStore();
  enqueuePrompt(store, 's1', 'first', 1000);
  enqueuePrompt(store, 's1', 'second', 1000);
  enqueuePrompt(store, 's2', 'third', 2000);

  const restored = deserializeQueues(serializeQueues(store));
  assert.deepEqual(restored, store);
});

test('deserializeQueues tolerates null and garbage input with a fresh store', () => {
  assert.deepEqual(deserializeQueues(null), { queues: {} });
  assert.deepEqual(deserializeQueues(undefined), { queues: {} });
  assert.deepEqual(deserializeQueues('not json'), { queues: {} });
  assert.deepEqual(deserializeQueues('[]'), { queues: {} });
  assert.deepEqual(deserializeQueues('42'), { queues: {} });
});

test('deserializeQueues drops malformed entries but keeps valid ones', () => {
  const json = JSON.stringify({
    s1: [
      { id: 'q-1-0', text: 'valid', createdAt: 1 },
      { id: 'q-1-1', text: '   ', createdAt: 2 },
      { id: 'q-1-2', createdAt: 3 },
      { text: 'no id', createdAt: 4 },
      { id: 'q-1-4', text: 'bad time', createdAt: 'nope' },
      null,
    ],
    s2: 'not-an-array',
    s3: [{ id: 'q-1-5', text: 'keeps me', createdAt: 5 }],
  });

  const restored = deserializeQueues(json);
  assert.deepEqual(restored.queues.s1, [{ id: 'q-1-0', text: 'valid', createdAt: 1 }]);
  assert.equal(restored.queues.s2, undefined);
  assert.deepEqual(restored.queues.s3, [{ id: 'q-1-5', text: 'keeps me', createdAt: 5 }]);
});
