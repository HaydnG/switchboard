const test = require('node:test');
const assert = require('node:assert/strict');

const { heatmapMonthLabels } = require('../public/stats-view');

function sundaysFrom(isoDate, count) {
  const start = new Date(`${isoDate}T00:00:00`);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i * 7);
    return d;
  });
}

test('heatmapMonthLabels drops a leading month that only shows one week', () => {
  // 28 Sep 2025 is the only September Sunday in view.
  const labels = heatmapMonthLabels(sundaysFrom('2025-09-28', 10));
  assert.deepEqual(labels.slice(0, 2), [
    { week: 1, month: 9 },
    { week: 5, month: 10 },
  ]);
});

test('heatmapMonthLabels keeps a leading month with two weeks of room', () => {
  const labels = heatmapMonthLabels(sundaysFrom('2025-09-21', 10));
  assert.deepEqual(labels.slice(0, 2), [
    { week: 0, month: 8 },
    { week: 2, month: 9 },
  ]);
});

test('heatmapMonthLabels labels every month across a full year once', () => {
  const labels = heatmapMonthLabels(sundaysFrom('2025-10-05', 53));
  assert.equal(labels.length, 13);
  assert.deepEqual(
    labels.map((l) => l.month),
    [9, 10, 11, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  );
  for (let i = 1; i < labels.length; i++) {
    assert.ok(labels[i].week - labels[i - 1].week >= 4);
  }
});
