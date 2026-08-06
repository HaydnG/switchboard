// Pure schedule presentation helpers shared by the supervision UI and tests.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    Object.assign(root, factory());
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const MAX_LOOKAHEAD_MINUTES = 366 * 24 * 60;

  function fieldMatches(field, value) {
    if (field === '*') return true;
    if (field.startsWith('*/')) {
      const step = Number(field.slice(2));
      return Number.isInteger(step) && step > 0 && value % step === 0;
    }
    if (field.includes(',')) {
      return field.split(',').some(part => fieldMatches(part.trim(), value));
    }
    if (field.includes('-')) {
      const [lower, upper] = field.split('-').map(Number);
      return Number.isFinite(lower) && Number.isFinite(upper) && value >= lower && value <= upper;
    }
    return Number(field) === value;
  }

  function cronMatches(expression, date) {
    const fields = String(expression || '')
      .trim()
      .split(/\s+/);
    if (fields.length !== 5 || !(date instanceof Date) || Number.isNaN(date.getTime())) {
      return false;
    }
    const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
    return (
      fieldMatches(minute, date.getMinutes()) &&
      fieldMatches(hour, date.getHours()) &&
      fieldMatches(dayOfMonth, date.getDate()) &&
      fieldMatches(month, date.getMonth() + 1) &&
      fieldMatches(dayOfWeek, date.getDay())
    );
  }

  function getNextScheduleRun(expression, from = new Date()) {
    const cursor = new Date(from);
    if (Number.isNaN(cursor.getTime())) return null;
    cursor.setSeconds(0, 0);
    cursor.setMinutes(cursor.getMinutes() + 1);

    for (let offset = 0; offset < MAX_LOOKAHEAD_MINUTES; offset += 1) {
      if (cronMatches(expression, cursor)) return new Date(cursor);
      cursor.setMinutes(cursor.getMinutes() + 1);
    }
    return null;
  }

  function getScheduleState(schedule, lastRun) {
    if (schedule && schedule.running) return 'running';
    if (lastRun && lastRun.status === 'failed') return 'failed';
    if (schedule && schedule.enabled === false) return 'disabled';
    if (lastRun && lastRun.status === 'succeeded') return 'succeeded';
    return 'scheduled';
  }

  function buildScheduleView(schedule, lastRun, now = new Date()) {
    const nextRun = schedule && schedule.enabled !== false
      ? getNextScheduleRun(schedule.cron, now)
      : null;
    return {
      id: schedule.id || schedule.filePath || schedule.slug,
      name: schedule.name || schedule.slug || 'Scheduled task',
      projectPath: schedule.projectPath || '',
      cron: schedule.cron || '',
      enabled: schedule.enabled !== false,
      state: getScheduleState(schedule, lastRun),
      nextRun: nextRun ? nextRun.toISOString() : null,
      lastRunAt: lastRun ? lastRun.startedAt || null : null,
      lastError: lastRun && lastRun.status === 'failed' ? lastRun.error || 'Run failed' : null,
    };
  }

  function sortScheduleViews(views) {
    return [...(Array.isArray(views) ? views : [])].sort((left, right) => {
      if (left.state === 'failed' && right.state !== 'failed') return -1;
      if (right.state === 'failed' && left.state !== 'failed') return 1;
      if (!left.nextRun) return 1;
      if (!right.nextRun) return -1;
      return left.nextRun.localeCompare(right.nextRun);
    });
  }

  return {
    MAX_LOOKAHEAD_MINUTES,
    buildScheduleView,
    cronMatches,
    getNextScheduleRun,
    getScheduleState,
    sortScheduleViews,
  };
});
