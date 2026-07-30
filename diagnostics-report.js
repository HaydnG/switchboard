const path = require('path');

const SECRET_PATTERNS = [
  /\b(sk-ant-[A-Za-z0-9_-]+)\b/g,
  /\b(sk-[A-Za-z0-9_-]{16,})\b/g,
  /\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi,
  /("(?:access|refresh|oauth)?_?token"\s*:\s*")[^"]+"/gi,
  /((?:access|refresh|oauth)?_?token\s*=\s*)[^\s&]+/gi,
];

function redactDiagnosticsText(value, homeDirectory) {
  let output = String(value || '');
  if (homeDirectory) {
    const normalizedHome = path.resolve(homeDirectory);
    output = output.split(normalizedHome).join('~');
  }
  for (const pattern of SECRET_PATTERNS) {
    output = output.replace(pattern, (_match, prefix) =>
      prefix && /Bearer|token|"$/i.test(prefix) ? `${prefix}[REDACTED]` : '[REDACTED]',
    );
  }
  return output;
}

function clampCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
}

function buildDiagnosticsReport(input = {}) {
  const safeCounts = {};
  for (const [key, value] of Object.entries(input.counts || {})) {
    safeCounts[key] = clampCount(value);
  }
  const report = {
    generatedAt: input.generatedAt || new Date().toISOString(),
    app: {
      version: String(input.appVersion || 'unknown'),
      packaged: Boolean(input.isPackaged),
    },
    system: {
      platform: String(input.platform || process.platform),
      arch: String(input.arch || process.arch),
      node: String(input.nodeVersion || process.versions.node),
      electron: String(input.electronVersion || process.versions.electron || 'unknown'),
    },
    runtimes: Array.isArray(input.runtimes)
      ? input.runtimes.map(runtime => ({
          id: String(runtime.id || 'unknown'),
          available: Boolean(runtime.available),
          version: runtime.version ? String(runtime.version) : null,
        }))
      : [],
    index: {
      ready: Boolean(input.index && input.index.ready),
      lastUpdatedAt: input.index && input.index.lastUpdatedAt
        ? String(input.index.lastUpdatedAt)
        : null,
      error: input.index && input.index.error
        ? redactDiagnosticsText(input.index.error, input.homeDirectory)
        : null,
    },
    counts: safeCounts,
    recentLogs: Array.isArray(input.recentLogs)
      ? input.recentLogs
          .slice(-200)
          .map(line => redactDiagnosticsText(line, input.homeDirectory))
      : [],
  };
  return `${JSON.stringify(report, null, 2)}\n`;
}

module.exports = {
  buildDiagnosticsReport,
  redactDiagnosticsText,
};
