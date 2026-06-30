const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');

const { transformUsageResponse, getKeychainServiceNames, getConfigDir } = require('../claude-auth');

test('getKeychainServiceNames always includes the hashed entry for the config dir', () => {
  const configDir = getConfigDir();
  const names = getKeychainServiceNames();
  assert.ok(names.length >= 1);
  assert.equal(names[0], `Claude Code-credentials-${require('crypto').createHash('sha256').update(configDir).digest('hex').substring(0, 8)}`);
  assert.equal(names.at(-1), 'Claude Code-credentials');
});

test('getKeychainServiceNames uses the same hash for default and explicit ~/.claude config dir', () => {
  const defaultDir = path.join(os.homedir(), '.claude');
  const explicitHash = require('crypto').createHash('sha256').update(defaultDir).digest('hex').substring(0, 8);
  const names = getKeychainServiceNames();
  assert.ok(names[0].endsWith(`-${explicitHash}`));
});

test('transformUsageResponse maps extra usage quota fields', () => {
  const usage = transformUsageResponse({
    five_hour: null,
    extra_usage: {
      is_enabled: true,
      monthly_limit: 200000,
      used_credits: 176958,
      utilization: 88.479,
      currency: 'USD',
      disabled_reason: null,
    },
  });

  assert.deepEqual(usage, {
    extraUsageEnabled: true,
    extraUsageLimit: 200000,
    extraUsageUsed: 176958,
    extraUsage: 88,
    extraUsageCurrency: 'USD',
  });
});
