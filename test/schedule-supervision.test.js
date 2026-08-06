const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildScheduleView,
  cronMatches,
  getNextScheduleRun,
  sortScheduleViews,
} = require('../public/schedule-supervision');

test('cronMatches supports ranges, lists, and steps', () => {
  const mondayAtNine = new Date('2026-07-27T09:00:00');

  assert.equal(cronMatches('*/15 9 1-31 1,7 1-5', mondayAtNine), true);
  assert.equal(cronMatches('5 9 * * *', mondayAtNine), false);
});

test('getNextScheduleRun returns the next matching minute', () => {
  const next = getNextScheduleRun('30 9 * * *', new Date('2026-07-27T09:12:45'));

  assert.equal(next.toISOString(), new Date('2026-07-27T09:30:00').toISOString());
});

test('buildScheduleView prioritizes failed run metadata', () => {
  const view = buildScheduleView(
    {
      filePath: '/project/.claude/commands/schedule-health.md',
      name: 'Repository health',
      cron: '0 8 * * *',
      enabled: true,
    },
    {
      status: 'failed',
      startedAt: '2026-07-27T08:00:00.000Z',
      error: 'Tests failed',
    },
    new Date('2026-07-27T09:00:00'),
  );

  assert.equal(view.state, 'failed');
  assert.equal(view.lastError, 'Tests failed');
  assert.ok(view.nextRun);
});

test('sortScheduleViews puts failures first then soonest run', () => {
  const sorted = sortScheduleViews([
    { id: 'later', state: 'scheduled', nextRun: '2026-07-29T00:00:00.000Z' },
    { id: 'failed', state: 'failed', nextRun: '2026-07-30T00:00:00.000Z' },
    { id: 'soon', state: 'scheduled', nextRun: '2026-07-28T00:00:00.000Z' },
  ]);

  assert.deepEqual(
    sorted.map(item => item.id),
    ['failed', 'soon', 'later'],
  );
});
