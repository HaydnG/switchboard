// kb-ipc.js — IPC for the Knowledge tab: browse, read and search the knowledge
// bases connected through second-brain (doordash/second-brain-kb).
//
// Everything is read-only. Entries come from the daemon's SQLite index, search
// goes through the daemon's hybrid search, and relevance through the same Jev
// Decisions request the plugin makes (src/relevance.ts), so what the tab shows
// is what agents get.
const { ipcMain, dialog, shell } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  buildLinkGraph,
  classifyEntry,
  createResolver,
  extractLinks,
  extractTerms,
  loadKbConfig,
  resolveLinks,
  tierBoost,
} = require('./kb-links');
const {
  PRODUCTION_JEV_TIMEOUT_MS,
  RELEVANCE_MIN,
  buildJevRequest,
  jevUrl,
  parseJevAnswers,
  selectRelevant,
} = require('./kb-jev');
const { authorizeMarkdownPath } = require('./security-hardening');

const MAX_POOL = 48;

const LINK_CACHE_VERSION = 1;
const DATA_DIR = process.env.SWITCHBOARD_DATA_DIR || path.join(os.homedir(), '.switchboard');
const LINK_CACHE_FILE = path.join(DATA_DIR, 'kb-links-cache.json');
const FILE_READ_TIMEOUT_MS = 20_000;

let log = console;
let isTrustedMainFrame = () => true;
let getMainWindow = () => null;
let loadDatabase = () => require('better-sqlite3');

let indexState = null; // { key, config, entries, byId, resolver, meta }
let graphState = null; // { key, promise, result }

function trusted(event, operation) {
  return isTrustedMainFrame(event, operation);
}

// --- Daemon ------------------------------------------------------------------

function daemonPort(config) {
  try {
    const port = Number(fs.readFileSync(config.portFile, 'utf8').trim());
    return Number.isFinite(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}

async function daemonRequest(config, route, init, timeoutMs) {
  const port = daemonPort(config);
  if (!port) return null;
  try {
    const res = await fetch(`http://127.0.0.1:${port}${route}`, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

function daemonHealth(config, timeoutMs = 800) {
  return daemonRequest(config, '/health', {}, timeoutMs);
}

function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff) return diff;
  }
  return 0;
}

/** The installed plugin copy, the way the README locates it (omp first, then Claude Code). */
function findPluginDir(home = os.homedir()) {
  const candidates = [];
  try {
    candidates.push(fs.realpathSync(path.join(home, '.omp', 'plugins', 'node_modules', 'second-brain')));
  } catch {
    // omp install absent
  }
  const claudeCache = path.join(home, '.claude', 'plugins', 'cache', 'second-brain');
  try {
    for (const marketplace of fs.readdirSync(claudeCache)) {
      const versions = fs
        .readdirSync(path.join(claudeCache, marketplace))
        .filter((name) => /^\d+(\.\d+)*$/.test(name))
        .sort(compareVersions);
      if (versions.length) candidates.push(path.join(claudeCache, marketplace, versions.at(-1)));
    }
  } catch {
    // Claude Code install absent
  }
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'src', 'engine', 'daemon.ts'))) {
      let version = null;
      try {
        version = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version || null;
      } catch {
        // version stays unknown
      }
      return { dir, version };
    }
  }
  return null;
}

function findBun(home = os.homedir()) {
  return [
    process.env.SECOND_BRAIN_BUN,
    '/opt/homebrew/bin/bun',
    '/usr/local/bin/bun',
    path.join(home, '.bun', 'bin', 'bun'),
  ].find((candidate) => candidate && fs.existsSync(candidate));
}

/** Spawn the daemon detached, as engine/client.ts ensureDaemon does, and wait for /health. */
async function startDaemon(config) {
  if (!config.vault) return { ok: false, error: config.error || 'second-brain is not configured' };
  if (await daemonHealth(config, 400)) return { ok: true, alreadyRunning: true };
  const plugin = findPluginDir();
  if (!plugin) return { ok: false, error: 'second-brain plugin is not installed' };
  const bun = findBun();
  if (!bun) return { ok: false, error: 'bun was not found on this machine' };
  const engineDir = path.join(plugin.dir, 'src', 'engine');
  const needsInstall = !fs.existsSync(
    path.join(engineDir, 'node_modules', '@huggingface', 'transformers'),
  );
  fs.mkdirSync(config.cacheDir, { recursive: true });
  const logFd = fs.openSync(path.join(config.cacheDir, 'daemon.log'), 'a');
  const child = spawn(
    '/bin/sh',
    [
      '-c',
      `${needsInstall ? '"$SB_BUN" install --frozen-lockfile && ' : ''}exec "$SB_BUN" daemon.ts`,
    ],
    {
      cwd: engineDir,
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env: {
        ...process.env,
        SB_BUN: bun,
        ...(config.caFile ? { NODE_EXTRA_CA_CERTS: config.caFile } : {}),
      },
    },
  );
  child.on('error', (err) => log.warn('[kb] daemon spawn failed', err.message));
  child.unref();
  fs.closeSync(logFd);
  const deadline = Date.now() + (needsInstall ? 90_000 : 10_000);
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (await daemonHealth(config, 400)) return { ok: true, installed: needsInstall };
  }
  return {
    ok: false,
    error: `daemon did not answer yet; see ${path.join(config.cacheDir, 'daemon.log')}`,
  };
}

// --- Index -------------------------------------------------------------------

function indexKey(config) {
  try {
    const stat = fs.statSync(config.dbPath);
    let walMtime = 0;
    try {
      walMtime = fs.statSync(`${config.dbPath}-wal`).mtimeMs;
    } catch {
      // no WAL file
    }
    return `${config.configFile}|${stat.mtimeMs}|${walMtime}|${config.roots.map((r) => r.path).join(',')}`;
  } catch {
    return null;
  }
}

function readIndex(config) {
  const key = indexKey(config);
  if (!key) return null;
  if (indexState && indexState.key === key) return indexState;
  const Database = loadDatabase();
  const db = new Database(config.dbPath, { readonly: true, fileMustExist: true });
  try {
    db.pragma('busy_timeout = 2000');
    const rows = db
      .prepare(
        `SELECT f.path, f.realpath, f.mtime_ms, f.size, f.title, COUNT(c.id) AS chunks
         FROM files f LEFT JOIN chunks c ON c.file_path = f.path
         GROUP BY f.path`,
      )
      .all();
    const metaRows = db.prepare('SELECT key, value FROM meta').all();
    const meta = Object.fromEntries(metaRows.map((row) => [row.key, row.value]));
    const entries = rows.map((row) => ({
      id: row.path,
      title: row.title,
      realpath: row.realpath,
      mtimeMs: row.mtime_ms,
      size: row.size,
      chunks: row.chunks,
      boost: tierBoost(row.path, config.boost),
      ...classifyEntry(row.path, config),
    }));
    indexState = {
      key,
      config,
      entries,
      byId: new Map(entries.map((entry) => [entry.id, entry])),
      resolver: createResolver(entries, config),
      meta,
    };
    return indexState;
  } finally {
    db.close();
  }
}

function credentialStatus(config) {
  if (!config.jev) return { configured: false, readable: false, source: null };
  const file = config.jev.jwtFile && fs.existsSync(config.jev.jwtFile) ? config.jev.jwtFile : null;
  const keyFile = config.jev.keyFile && fs.existsSync(config.jev.keyFile) ? config.jev.keyFile : null;
  return {
    configured: true,
    readable: Boolean(file || keyFile),
    source: file ? 'jwtFile' : keyFile ? 'keyFile' : null,
  };
}

async function getOverview() {
  const config = loadKbConfig();
  let index = null;
  let indexError = null;
  try {
    index = readIndex(config);
  } catch (err) {
    indexError = err.message;
    log.warn('[kb] failed to read index', err.message);
  }
  const health = config.vault ? await daemonHealth(config) : null;
  const plugin = findPluginDir();
  return {
    ok: true,
    config: {
      file: config.configFile,
      error: config.error || null,
      vault: config.vault,
      wikiDir: config.wikiDir,
      discoveredDir: config.discoveredDir,
      roots: config.roots.map(({ id, label, path: rootPath, isVault }) => ({
        id,
        label,
        path: rootPath,
        isVault,
      })),
    },
    jev: credentialStatus(config),
    daemon: { running: Boolean(health), port: daemonPort(config), health },
    plugin: plugin ? { dir: plugin.dir, version: plugin.version, bun: Boolean(findBun()) } : null,
    index: {
      dbPath: config.dbPath,
      exists: Boolean(index),
      error: indexError,
      lastIndexMs: index ? Number(index.meta.last_index_ms || 0) : 0,
      model: index ? index.meta.model || null : null,
    },
    entries: index
      ? index.entries.map(({ id, title, rootId, relPath, absPath, layer, mtimeMs, size, chunks, boost }) => ({
          id,
          title,
          rootId,
          relPath,
          absPath,
          layer,
          mtimeMs,
          size,
          chunks,
          boost,
        }))
      : [],
  };
}

// --- Link graph ----------------------------------------------------------------

function readLinkCache() {
  try {
    const parsed = JSON.parse(fs.readFileSync(LINK_CACHE_FILE, 'utf8'));
    if (parsed && parsed.version === LINK_CACHE_VERSION && parsed.files) return parsed.files;
  } catch {
    // cold cache
  }
  return {};
}

function writeLinkCache(files) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${LINK_CACHE_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ version: LINK_CACHE_VERSION, files }));
    fs.renameSync(tmp, LINK_CACHE_FILE);
  } catch (err) {
    log.warn('[kb] failed to write link cache', err.message);
  }
}

function readWithTimeout(file) {
  return Promise.race([
    fs.promises.readFile(file, 'utf8'),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('read timed out')), FILE_READ_TIMEOUT_MS),
    ),
  ]);
}

function sendProgress(done, total) {
  const win = getMainWindow();
  if (win && !win.isDestroyed()) win.webContents.send('kb-graph-progress', { done, total });
}

async function computeGraph(index) {
  const cache = readLinkCache();
  const next = {};
  let lastSent = 0;
  const graph = await buildLinkGraph(
    index.entries,
    async (entry) => {
      const file = entry.realpath || entry.absPath;
      const cached = cache[file];
      if (cached && cached.m === entry.mtimeMs && cached.s === entry.size) {
        next[file] = cached;
        return cached.links;
      }
      const links = extractLinks(await readWithTimeout(file), index.config);
      next[file] = { m: entry.mtimeMs, s: entry.size, links };
      return links;
    },
    index.config,
    {
      onProgress: (done, total) => {
        if (done === total || Date.now() - lastSent > 250) {
          lastSent = Date.now();
          sendProgress(done, total);
        }
      },
    },
  );
  writeLinkCache(next);
  return { ok: true, ...graph, builtAt: Date.now() };
}

async function getGraph(force = false) {
  const config = loadKbConfig();
  const index = readIndex(config);
  if (!index) return { ok: false, error: 'second-brain index not found' };
  if (!force && graphState && graphState.key === index.key) return graphState.promise;
  const promise = computeGraph(index).catch((err) => {
    log.warn('[kb] link graph failed', err.message);
    graphState = null;
    return { ok: false, error: err.message };
  });
  graphState = { key: index.key, promise };
  return promise;
}

// --- Entries -------------------------------------------------------------------

function authorizeEntry(id) {
  if (typeof id !== 'string' || !id) return { ok: false, error: 'invalid entry' };
  const index = readIndex(loadKbConfig());
  const entry = index && index.byId.get(id);
  if (!entry) return { ok: false, error: 'entry is not in the second-brain index' };
  const file = entry.realpath || entry.absPath;
  const authorization = authorizeMarkdownPath(file, [path.dirname(file)]);
  if (!authorization.ok) return { ok: false, error: authorization.error };
  return { ok: true, entry, index, path: authorization.path };
}

async function readEntry(id) {
  const authorization = authorizeEntry(id);
  if (!authorization.ok) return authorization;
  const { entry, index } = authorization;
  try {
    const content = await readWithTimeout(authorization.path);
    const links = resolveLinks(extractLinks(content, index.config), entry, index.resolver);
    return { ok: true, id, content, links };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// --- Search + Jev ----------------------------------------------------------------

/** Portkey credential, re-read per call so rotation needs no restart (relevance.ts). */
function portkeyCredential(config) {
  if (!config.jev) return null;
  if (config.jev.jwtFile) {
    try {
      const jwt = JSON.parse(fs.readFileSync(config.jev.jwtFile, 'utf8'));
      const live = typeof jwt.exp !== 'number' || jwt.exp * 1000 > Date.now();
      if (typeof jwt.access_token === 'string' && live) return jwt.access_token;
    } catch {
      // fall through to the key file
    }
  }
  if (config.jev.keyFile) {
    try {
      return fs.readFileSync(config.jev.keyFile, 'utf8').trim() || null;
    } catch {
      return null;
    }
  }
  return null;
}

async function judgeRelevance(config, query, candidates, timeoutMs) {
  const startedAt = Date.now();
  const key = portkeyCredential(config);
  if (!key) return { probs: null, ms: 0, error: 'no readable Jev credential in the config' };
  try {
    const res = await fetch(jevUrl(), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-portkey-api-key': key,
        'x-portkey-provider': '@openrouter',
        'x-portkey-custom-host': 'https://openrouter.ai/api/alpha',
      },
      body: JSON.stringify(buildJevRequest(query, candidates)),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const ms = Date.now() - startedAt;
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { probs: null, ms, error: `Jev returned ${res.status} ${text.slice(0, 200)}`.trim() };
    }
    const body = await res.json();
    const probs = parseJevAnswers(body, candidates.length);
    if (!probs) {
      return { probs: null, ms, error: 'Jev answered without a probability for every note' };
    }
    return {
      probs,
      ms,
      model: typeof body.model === 'string' ? body.model : null,
      cost: typeof body.usage?.cost === 'number' ? body.usage.cost : null,
      inputTokens: body.usage?.input_tokens ?? null,
      outputTokens: body.usage?.output_tokens ?? null,
    };
  } catch (err) {
    return {
      probs: null,
      ms: Date.now() - startedAt,
      error: err.name === 'TimeoutError' ? `Jev timed out after ${timeoutMs} ms` : err.message,
    };
  }
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

async function search(options) {
  const query = typeof options?.query === 'string' ? options.query.trim() : '';
  if (!query) return { ok: false, error: 'empty query' };
  const pool = clampInt(options.pool, 1, MAX_POOL, 12);
  const max = clampInt(options.max, 1, pool, 3);
  const timeoutMs = clampInt(options.timeoutMs, 500, 30_000, 8000);
  const config = loadKbConfig();
  if (!config.vault) return { ok: false, error: config.error || 'second-brain is not configured' };

  const terms = extractTerms(query);
  const startedAt = Date.now();
  const response = await daemonRequest(
    config,
    '/search',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, terms, k: pool }),
    },
    10_000,
  );
  const searchMs = Date.now() - startedAt;
  if (!response) {
    return { ok: false, daemonDown: true, error: 'the second-brain daemon is not answering' };
  }
  const candidates = (response.hits || [])
    .filter((hit) => typeof hit.excerpt === 'string' && hit.excerpt.trim())
    .map((hit) => ({
      path: hit.path,
      realpath: hit.realpath,
      heading: hit.heading || '',
      excerpt: hit.excerpt,
      score: hit.score,
      source: hit.source,
    }));

  const jev = candidates.length
    ? await judgeRelevance(config, query, candidates, timeoutMs)
    : { probs: [], ms: 0 };
  const selected = jev.probs ? selectRelevant(jev.probs, max) : [];

  return {
    ok: true,
    query,
    terms,
    pool,
    max,
    threshold: RELEVANCE_MIN,
    productionTimeoutMs: PRODUCTION_JEV_TIMEOUT_MS,
    ranAt: Date.now(),
    timings: { searchMs, jevMs: jev.ms, totalMs: Date.now() - startedAt },
    jev: {
      ok: Boolean(jev.probs),
      error: jev.error || null,
      model: jev.model || null,
      cost: jev.cost ?? null,
      inputTokens: jev.inputTokens ?? null,
      outputTokens: jev.outputTokens ?? null,
    },
    candidates: candidates.map((candidate, i) => ({
      ...candidate,
      relevance: jev.probs ? jev.probs[i] : null,
    })),
    selected,
  };
}

// --- Export ------------------------------------------------------------------------

function isBenchCase(value) {
  return (
    value &&
    typeof value.prompt === 'string' &&
    Array.isArray(value.hits) &&
    Array.isArray(value.relevant) &&
    value.relevant.every((i) => Number.isInteger(i))
  );
}

async function exportEval(payload) {
  if (!payload || !Array.isArray(payload.cases) || !payload.cases.every(isBenchCase)) {
    return { ok: false, error: 'invalid evaluation payload' };
  }
  const json = JSON.stringify({ cases: payload.cases }, null, 2);
  if (json.length > 20 * 1024 * 1024) return { ok: false, error: 'evaluation export is too large' };
  const config = loadKbConfig();
  const result = await dialog.showSaveDialog(getMainWindow() || undefined, {
    title: 'Export relevance labels',
    defaultPath: path.join(
      config.cacheDir,
      `bench-switchboard-${new Date().toISOString().slice(0, 10)}.json`,
    ),
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (result.canceled || !result.filePath) return { ok: false, canceled: true };
  fs.mkdirSync(path.dirname(result.filePath), { recursive: true });
  fs.writeFileSync(result.filePath, json, 'utf8');
  return { ok: true, filePath: result.filePath };
}

// --- Registration ----------------------------------------------------------------

function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!trusted(event, channel)) return { ok: false, error: 'operation rejected' };
    try {
      return await fn(...args);
    } catch (err) {
      log.error(`[kb] ${channel} failed`, err);
      return { ok: false, error: err.message };
    }
  });
}

function init(options = {}) {
  log = options.log || console;
  isTrustedMainFrame = options.isTrustedMainFrame || isTrustedMainFrame;
  getMainWindow = options.getMainWindow || getMainWindow;
  if (options.loadDatabase) loadDatabase = options.loadDatabase;

  handle('kb-get-overview', () => getOverview());
  handle('kb-get-graph', (force) => getGraph(force === true));
  handle('kb-read-entry', (id) => readEntry(id));
  handle('kb-search', (options) => search(options || {}));
  handle('kb-reindex', async (full) => {
    const config = loadKbConfig();
    const stats = await daemonRequest(
      config,
      '/reindex',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ full: full === true }),
      },
      15 * 60_000,
    );
    if (!stats) return { ok: false, error: 'the second-brain daemon is not answering' };
    indexState = null;
    graphState = null;
    return { ok: true, stats };
  });
  handle('kb-start-daemon', () => startDaemon(loadKbConfig()));
  handle('kb-open-entry', async (id, mode) => {
    const authorization = authorizeEntry(id);
    if (!authorization.ok) return authorization;
    if (mode === 'reveal') {
      shell.showItemInFolder(authorization.path);
      return { ok: true };
    }
    const error = await shell.openPath(authorization.path);
    return error ? { ok: false, error } : { ok: true };
  });
  handle('kb-export-eval', (payload) => exportEval(payload));
}

module.exports = { init };
