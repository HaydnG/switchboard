const fs = require('fs');

const DEFAULT_JSONL_MAX_BYTES = 2 * 1024 * 1024; // 2 MiB
const DEFAULT_JSONL_MAX_ENTRIES = 400;

function parseJsonlChunk(text, { skipIncompleteFirstLine } = {}) {
  const lines = text.split('\n');
  if (skipIncompleteFirstLine) lines.shift();
  const entries = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try { entries.push(JSON.parse(line)); } catch {}
  }
  return entries;
}

function normalizeJsonlReadOptions(options = {}) {
  const maxBytesRaw = Number(options.maxBytes);
  const maxEntriesRaw = Number(options.maxEntries);
  return {
    maxBytes: Number.isFinite(maxBytesRaw) && maxBytesRaw > 0
      ? Math.min(Math.floor(maxBytesRaw), DEFAULT_JSONL_MAX_BYTES)
      : DEFAULT_JSONL_MAX_BYTES,
    maxEntries: Number.isFinite(maxEntriesRaw) && maxEntriesRaw > 0
      ? Math.min(Math.floor(maxEntriesRaw), DEFAULT_JSONL_MAX_ENTRIES)
      : DEFAULT_JSONL_MAX_ENTRIES,
  };
}

function readJsonlFile(filePath, options) {
  const { maxBytes, maxEntries } = normalizeJsonlReadOptions(options);
  const totalBytes = fs.statSync(filePath).size;
  let text;
  let tailed = false;

  if (totalBytes <= maxBytes) {
    text = fs.readFileSync(filePath, 'utf-8');
  } else {
    const fd = fs.openSync(filePath, 'r');
    try {
      const buffer = Buffer.alloc(maxBytes);
      fs.readSync(fd, buffer, 0, maxBytes, totalBytes - maxBytes);
      text = buffer.toString('utf-8');
      tailed = true;
    } finally {
      fs.closeSync(fd);
    }
  }

  let entries = parseJsonlChunk(text, { skipIncompleteFirstLine: tailed });
  let truncated = tailed;
  if (entries.length > maxEntries) {
    entries = entries.slice(-maxEntries);
    truncated = true;
  }

  return { entries, truncated, totalBytes, returnedEntries: entries.length };
}

module.exports = {
  DEFAULT_JSONL_MAX_BYTES,
  DEFAULT_JSONL_MAX_ENTRIES,
  parseJsonlChunk,
  normalizeJsonlReadOptions,
  readJsonlFile,
};
