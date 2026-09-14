const test = require('node:test');
const assert = require('node:assert/strict');
const { cronMatches } = require('../schedule-runner');

test('cronMatches uses OR when both day-of-month and day-of-week are constrained', () => {
  // Saturday 15 Aug 2026 at 09:00 local
  const saturdayThe15th = new Date(2026, 7, 15, 9, 0, 0);
  assert.equal(saturdayThe15th.getDate(), 15);
  assert.equal(saturdayThe15th.getDay(), 6);

  assert.equal(cronMatches('0 9 15 * 1', saturdayThe15th), true, 'DOM 15 should fire even when DOW is Monday');
  assert.equal(cronMatches('0 9 1 * 6', saturdayThe15th), true, 'Saturday should fire even when DOM is 1');
  assert.equal(cronMatches('0 9 1 * 1', saturdayThe15th), false, 'neither DOM nor DOW match');
});

test('cronMatches still ANDs when either day field is wildcard', () => {
  const saturdayThe15th = new Date(2026, 7, 15, 9, 0, 0);
  assert.equal(cronMatches('0 9 15 * *', saturdayThe15th), true);
  assert.equal(cronMatches('0 9 * * 6', saturdayThe15th), true);
  assert.equal(cronMatches('0 9 14 * *', saturdayThe15th), false);
  assert.equal(cronMatches('0 9 * * 1', saturdayThe15th), false);
  assert.equal(cronMatches('0 8 15 * 6', saturdayThe15th), false);
});
