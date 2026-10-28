const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildGatewayRequest,
  gatewayConfigured,
  gatewayHeaders,
  gatewayModel,
  gatewayUrl,
  parseGatewayAnswers,
  selectRelevant,
} = require('../kb-gateway');

test('gatewayUrl comes only from the environment', () => {
  assert.equal(gatewayUrl({}), '');
  assert.equal(gatewayUrl({ SWITCHBOARD_KB_GATEWAY_URL: '   ' }), '');
  assert.equal(
    gatewayUrl({ SWITCHBOARD_KB_GATEWAY_URL: 'http://127.0.0.1:4100/v1/decisions' }),
    'http://127.0.0.1:4100/v1/decisions',
  );
  assert.equal(
    gatewayUrl({ SWITCHBOARD_KB_GATEWAY_URL: 'https://gateway.example.com/v1/decisions' }),
    'https://gateway.example.com/v1/decisions',
  );
  assert.equal(gatewayUrl({ SWITCHBOARD_KB_GATEWAY_URL: 'ftp://example.com/x' }), '');
  assert.equal(gatewayUrl({ SWITCHBOARD_KB_GATEWAY_URL: 'not a url' }), '');
});

test('gatewayConfigured tracks the URL', () => {
  assert.equal(gatewayConfigured({}), false);
  assert.equal(gatewayConfigured({ SWITCHBOARD_KB_GATEWAY_URL: 'https://g.example/v1' }), true);
});

test('gatewayModel comes only from the environment', () => {
  assert.equal(gatewayModel({}), '');
  assert.equal(gatewayModel({ SWITCHBOARD_KB_GATEWAY_MODEL: ' team/analyser ' }), 'team/analyser');
});

test('gatewayHeaders builds a bearer for the token and merges header JSON', () => {
  assert.deepEqual(gatewayHeaders({}), {});
  assert.deepEqual(gatewayHeaders({ SWITCHBOARD_KB_GATEWAY_TOKEN: 'k' }), {
    authorization: 'Bearer k',
  });
  assert.deepEqual(
    gatewayHeaders({
      SWITCHBOARD_KB_GATEWAY_TOKEN: 'k',
      SWITCHBOARD_KB_GATEWAY_HEADERS: '{"X-Provider":"acme","X-Mode":"fast"}',
    }),
    { authorization: 'Bearer k', 'x-provider': 'acme', 'x-mode': 'fast' },
  );
  assert.deepEqual(gatewayHeaders({ SWITCHBOARD_KB_GATEWAY_HEADERS: 'not json' }), {});
  assert.deepEqual(gatewayHeaders({ SWITCHBOARD_KB_GATEWAY_HEADERS: '["x"]' }), {});
});

test('buildGatewayRequest asks one question per candidate with capped excerpts', () => {
  const body = buildGatewayRequest(
    'x'.repeat(2500),
    [
      { path: 'a.md', heading: 'A', excerpt: 'y'.repeat(800) },
      { path: 'b.md', heading: 'B', excerpt: 'short' },
    ],
    'demo/model',
  );
  assert.equal(body.model, 'demo/model');
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
