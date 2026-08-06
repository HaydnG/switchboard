const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildDiagnosticsReport,
  redactDiagnosticsText,
} = require('../diagnostics-report');

test('redactDiagnosticsText removes home paths and common credentials', () => {
  const redacted = redactDiagnosticsText(
    'read /Users/tester/project token=secret-value Bearer abc.def sk-ant-api-key',
    '/Users/tester',
  );

  assert.equal(redacted.includes('/Users/tester'), false);
  assert.equal(redacted.includes('secret-value'), false);
  assert.equal(redacted.includes('abc.def'), false);
  assert.equal(redacted.includes('sk-ant-api-key'), false);
});

test('buildDiagnosticsReport only emits aggregate session information', () => {
  const report = JSON.parse(
    buildDiagnosticsReport({
      generatedAt: '2026-07-27T12:00:00.000Z',
      appVersion: '1.0.0',
      counts: { sessions: 42, running: 3, invalid: -4 },
      recentLogs: ['Opened /Users/tester/private/session.jsonl'],
      homeDirectory: '/Users/tester',
    }),
  );

  assert.deepEqual(report.counts, { sessions: 42, running: 3, invalid: 0 });
  assert.match(report.recentLogs[0], /^Opened ~\//);
  assert.equal('transcripts' in report, false);
});
