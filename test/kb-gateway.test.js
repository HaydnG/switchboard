const test = require('node:test');
const assert = require('node:assert/strict');

const {
  GATEWAY_MODEL,
  GATEWAY_URL,
  buildGatewayRequest,
  gatewayUrl,
  parseGatewayAnswers,
  selectRelevant,
} = require('../kb-gateway');

test('gatewayUrl only accepts loopback overrides', () => {
  assert.equal(gatewayUrl({}), GATEWAY_URL);
  assert.equal(
    gatewayUrl({ SWITCHBOARD_KB_GATEWAY_URL: 'http://127.0.0.1:4100/v1/decisions' }),
    'http://127.0.0.1:4100/v1/decisions',
  );
  assert.equal(gatewayUrl({ SWITCHBOARD_KB_GATEWAY_URL: 'https://example.com/v1/decisions' }), GATEWAY_URL);
  assert.equal(gatewayUrl({ SWITCHBOARD_KB_GATEWAY_URL: 'http://127.0.0.1.example.com/' }), GATEWAY_URL);
  assert.equal(gatewayUrl({ SWITCHBOARD_KB_GATEWAY_URL: 'not a url' }), GATEWAY_URL);
});

test('buildGatewayRequest asks one question per candidate with capped excerpts', () => {
  const body = buildGatewayRequest('x'.repeat(2500), [
    { path: 'a.md', heading: 'A', excerpt: 'y'.repeat(800) },
    { path: 'b.md', heading: 'B', excerpt: 'short' },
  ]);
  assert.equal(body.model, GATEWAY_MODEL);
  assert.equal(body.state.request.length, 2000);
  assert.deepEqual(
    body.state.notes.map((note) => [note.id, note.source, note.heading, note.excerpt.length]),
    [
      ['n0', 'a.md', 'A', 500],
      ['n1', 'b.md', 'B', 5],
    ],
  );
  assert.deepEqual(Object.keys(body.questions), ['q0', 'q1']);
  assert.equal(body.questions.q1.type, 'noul');
  assert.match(body.questions.q1.instructions, /note n1 .*Answer for n1 only\.$/);
});

test('parseGatewayAnswers requires a probability for every candidate', () => {
  assert.deepEqual(parseGatewayAnswers({ answers: { q0: { noul: 0.9 }, q1: { noul: 0 } } }, 2), [
    0.9, 0,
  ]);
  assert.equal(parseGatewayAnswers({ answers: { q0: { noul: 0.9 } } }, 2), null);
  assert.equal(parseGatewayAnswers(null, 1), null);
  assert.deepEqual(parseGatewayAnswers({}, 0), []);
});

test('selectRelevant keeps candidates at or above the threshold, best first', () => {
  assert.deepEqual(selectRelevant([0.2, 0.5, 0.9, 0.7], 2), [2, 3]);
  assert.deepEqual(selectRelevant([0.2, 0.5, 0.9, 0.7], 8), [2, 3, 1]);
  assert.deepEqual(selectRelevant([0.2, 0.5, 0.9], 8, 0.3), [2, 1]);
  assert.deepEqual(selectRelevant([0.1], 3), []);
});
