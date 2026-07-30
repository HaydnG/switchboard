const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_PACKET_LENGTH,
  buildContextTransferPacket,
  getTransferTargets,
} = require('../public/context-transfer');

test('buildContextTransferPacket creates an auditable local packet', () => {
  const packet = buildContextTransferPacket(
    {
      sessionId: 'source-id',
      name: 'Checkout refactor',
      projectPath: '/work/consumer/checkout',
    },
    'Implemented the reducer. Tests still need updating.',
    {
      createdAt: '2026-07-27T12:00:00.000Z',
      intent: 'Finish the test migration.',
    },
  );

  assert.match(packet, /Source session: Checkout refactor/);
  assert.match(packet, /Source project: consumer\/checkout/);
  assert.match(packet, /Finish the test migration/);
  assert.match(packet, /Implemented the reducer/);
});

test('buildContextTransferPacket bounds transcript-derived content', () => {
  const packet = buildContextTransferPacket({ sessionId: 'source-id' }, 'x'.repeat(30_000));

  assert.ok(packet.length < MAX_PACKET_LENGTH + 1_000);
  assert.match(packet, /\[Packet truncated by Switchboard\]/);
});

test('getTransferTargets excludes the source and sorts by project and label', () => {
  const targets = getTransferTargets(
    [
      { sessionId: 'source', name: 'Source', projectPath: '/b/project' },
      { sessionId: 'two', name: 'Zed', projectPath: '/a/project', runtime: 'pi' },
      { sessionId: 'one', name: 'Alpha', projectPath: '/a/project' },
      { sessionId: 'closed', name: 'Closed', projectPath: '/a/project', isRunning: false },
    ],
    'source',
  );

  assert.deepEqual(
    targets.map(target => target.id),
    ['one', 'two'],
  );
  assert.equal(targets[1].runtime, 'pi');
});
