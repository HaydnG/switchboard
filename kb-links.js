// kb-links.js — pure helpers for the second-brain knowledge base integration:
// config loading, entry classification, link extraction/resolution and the
// keyword-term extraction the daemon's keyword leg expects.
//
// Semantics mirror doordash/second-brain-kb (plugins/second-brain/src):
// engine/config.ts for the config file, verify.ts for frontmatter lists and
// source resolution, queue.ts for discovered-note citations and core.ts for
// extractTerms. Keep them in step when that plugin changes.
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE_EXCLUDE = [
  '/.smart-env/',
  '/.obsidian/',
  '/.trash/',
  '/Archive/',
  '/output/',
  '/node_modules/',
  '/.git/',
];
const DEFAULT_WIKI_DIR = 'KB/main/wiki';
const DEFAULT_DISCOVERED_DIR = 'KB/main/raw/Discovered';

/** Edge kinds, most specific first; one edge is kept per (from, to) pair. */
const LINK_KINDS = ['source', 'related', 'wikilink', 'link', 'cite'];

function expandHome(p, home) {
  return (p.startsWith('~/') ? path.join(home, p.slice(2)) : p).replace(/[\\/]+$/, '');
}

function isInside(entryPath, dir) {
  return entryPath.startsWith(dir) && /^[\\/]./.test(entryPath.slice(dir.length));
}

function toSlashes(p) {
  return path.sep === '\\' ? p.replace(/\\/g, '/') : p;
}

function strings(value) {
  return Array.isArray(value) ? value.filter((v) => typeof v === 'string') : [];
}

function trimSlashes(value) {
  return value.replace(/^\/+|\/+$/g, '');
}

/**
 * second-brain's config, resolved the way engine/config.ts resolves it.
 * Never throws: problems are reported in `error` and leave `vault` empty.
 */
function loadKbConfig({ env = process.env, home = os.homedir(), fsImpl = fs } = {}) {
  const configFile =
    (env.SECOND_BRAIN_CONFIG && env.SECOND_BRAIN_CONFIG.trim()) ||
    path.join(home, '.config', 'second-brain', 'config.json');
  const cacheDir = path.join(home, '.cache', 'second-brain');
  const base = {
    configFile,
    cacheDir,
    dbPath: path.join(cacheDir, 'index.db'),
    portFile: path.join(cacheDir, 'daemon.port'),
    vault: '',
    wikiDir: DEFAULT_WIKI_DIR,
    discoveredDir: DEFAULT_DISCOVERED_DIR,
    roots: [],
    jev: null,
    boost: { [`${DEFAULT_WIKI_DIR}/`]: 3 },
    caFile: null,
    error: undefined,
  };

  let raw;
  try {
    if (!fsImpl.existsSync(configFile)) return { ...base, error: `no config at ${configFile}` };
    raw = JSON.parse(fsImpl.readFileSync(configFile, 'utf8'));
  } catch (err) {
    return { ...base, error: `${configFile}: ${err.message}` };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...base, error: `${configFile} is not a JSON object` };
  }

  const layout = raw.layout && typeof raw.layout === 'object' ? raw.layout : {};
  const wikiDir = typeof layout.wiki === 'string' ? trimSlashes(layout.wiki) : DEFAULT_WIKI_DIR;
  const discoveredDir =
    typeof layout.discovered === 'string' ? trimSlashes(layout.discovered) : DEFAULT_DISCOVERED_DIR;
  const boost = { [`${wikiDir}/`]: 3 };
  if (raw.boost && typeof raw.boost === 'object') {
    for (const [key, weight] of Object.entries(raw.boost)) {
      if (typeof weight === 'number' && weight > 0) boost[key] = weight;
    }
  }
  const jev =
    raw.jev &&
    typeof raw.jev === 'object' &&
    (typeof raw.jev.keyFile === 'string' || typeof raw.jev.jwtFile === 'string')
      ? {
          keyFile: typeof raw.jev.keyFile === 'string' ? expandHome(raw.jev.keyFile, home) : null,
          jwtFile: typeof raw.jev.jwtFile === 'string' ? expandHome(raw.jev.jwtFile, home) : null,
        }
      : null;

  const caPath = typeof raw.caFile === 'string' ? expandHome(raw.caFile, home) : '';
  const caFile = caPath && fsImpl.existsSync(caPath) ? caPath : null;

  const vaultPath =
    typeof raw.vault === 'string' && raw.vault.trim() ? expandHome(raw.vault.trim(), home) : '';
  const vault = vaultPath && fsImpl.existsSync(vaultPath) ? vaultPath : '';
  const error = !vaultPath
    ? `"vault" missing in ${configFile}`
    : !vault
      ? `vault not found: ${vaultPath}`
      : undefined;

  const roots = [];
  if (vault) {
    roots.push({
      id: 'vault',
      path: vault,
      label: 'second-brain vault',
      exclude: [...BASE_EXCLUDE, ...strings(raw.exclude)],
      isVault: true,
    });
    for (const entry of Array.isArray(raw.roots) ? raw.roots : []) {
      if (!entry || typeof entry !== 'object') continue;
      const id = typeof entry.id === 'string' ? entry.id : '';
      const rootPath = typeof entry.path === 'string' ? expandHome(entry.path, home) : '';
      if (!id || !rootPath || !fsImpl.existsSync(rootPath)) continue;
      roots.push({
        id,
        path: rootPath,
        label: typeof entry.label === 'string' ? entry.label : id,
        exclude: [...BASE_EXCLUDE, ...strings(entry.exclude)],
        isVault: false,
      });
    }
  }

  return { ...base, vault, wikiDir, discoveredDir, roots, jev, boost, caFile, error };
}

/** Ranking weight for a path: the largest configured boost whose substring it contains. */
function tierBoost(entryPath, boost) {
  let best = 1;
  for (const [needle, weight] of Object.entries(boost || {})) {
    if (entryPath.includes(needle) && weight > best) best = weight;
  }
  return best;
}

/**
 * Where an index entry lives. Index paths are vault-relative for the vault and
 * absolute for extra roots (engine/indexer.ts).
 */
function classifyEntry(entryPath, config) {
  if (!path.isAbsolute(entryPath)) {
    const layer = entryPath.startsWith(`${config.wikiDir}/`)
      ? 'wiki'
      : entryPath.startsWith(`${config.discoveredDir}/`)
        ? 'discovered'
        : 'note';
    return {
      rootId: 'vault',
      absPath: config.vault ? path.join(config.vault, entryPath) : entryPath,
      relPath: entryPath,
      layer,
    };
  }
  let best = null;
  for (const root of config.roots) {
    if (root.isVault) continue;
    if (isInside(entryPath, root.path) && (!best || root.path.length > best.path.length)) {
      best = root;
    }
  }
  return {
    rootId: best ? best.id : 'other',
    absPath: entryPath,
    relPath: best ? toSlashes(entryPath.slice(best.path.length + 1)) : entryPath,
    layer: 'note',
  };
}

/** Frontmatter block, its `key: value` fields, and the body after it. */
function parseFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) return { block: '', fields: {}, body: text };
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const m = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (m) fields[m[1]] = m[2].trim();
  }
  return { block: match[1], fields, body: text.slice(match[0].length) };
}

function uncomment(value) {
  const at = value.indexOf(' #');
  return (at === -1 ? value : value.slice(0, at)).trim();
}

/** A frontmatter list written inline (`[a, b]`) or as `- item` lines. */
function frontmatterList(fields, block, key) {
  const value = fields[key];
  if (!value) {
    const lines = block.split(/\r?\n/);
    const start = lines.findIndex((line) => line.trimEnd() === `${key}:`);
    if (start === -1) return [];
    const items = [];
    for (const line of lines.slice(start + 1)) {
      const item = /^[ \t]*-[ \t]*(\S.*)$/.exec(line);
      if (!item) break;
      items.push(uncomment(item[1]).replace(/^["']|["']$/g, ''));
    }
    return items.filter(Boolean);
  }
  const open = value.indexOf('[');
  const close = value.lastIndexOf(']');
  const inner = open === -1 ? value : value.slice(open + 1, close > open ? close : undefined);
  return inner
    .split(',')
    .map((v) => uncomment(v).replace(/^["']|["']$/g, ''))
    .filter(Boolean);
}

/** Body text with fenced and inline code removed, so links in examples are not followed. */
function stripCode(text) {
  return text.replace(/^(```|~~~)[\s\S]*?^\1[^\n]*$/gm, '').replace(/`[^`\n]*`/g, '');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Every outgoing reference in a note, unresolved:
 * frontmatter `sources:` and `related:`, body `[[wikilinks]]`, relative markdown
 * links and plain-text `<discovered-folder>/<file>.md` citations.
 */
function extractLinks(text, { discoveredDir = DEFAULT_DISCOVERED_DIR } = {}) {
  const { block, fields, body } = parseFrontmatter(text);
  const links = [];
  for (const raw of frontmatterList(fields, block, 'sources')) links.push({ kind: 'source', raw });
  for (const raw of frontmatterList(fields, block, 'related')) links.push({ kind: 'related', raw });

  const prose = stripCode(body);
  for (const m of prose.matchAll(/!?\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g)) {
    if (m[0].startsWith('!')) continue;
    links.push({ kind: 'wikilink', raw: m[1].trim() });
  }
  for (const m of prose.matchAll(/(?<!!)\[[^\]\n]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
    if (isNoteLinkTarget(m[1])) links.push({ kind: 'link', raw: m[1] });
  }
  const marker = `${path.posix.basename(discoveredDir)}/`;
  const citation = new RegExp(`${escapeRegExp(marker)}[\\w.-]+\\.md`, 'g');
  for (const m of text.matchAll(citation)) links.push({ kind: 'cite', raw: m[0] });
  return links.filter((link) => !URL_SCHEME.test(link.raw));
}

const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** Markdown link targets that can name an indexed note: `.md` files or extensionless paths. */
function isNoteLinkTarget(target) {
  if (URL_SCHEME.test(target) || target.startsWith('#')) return false;
  const filePart = target.split('#')[0].split('?')[0];
  if (!filePart || filePart.endsWith('/')) return false;
  const ext = path.posix.extname(filePart).toLowerCase();
  return ext === '' || ext === '.md';
}

function noteName(raw) {
  return raw
    .replace(/^\[\[|\]\]$/g, '')
    .split('|')[0]
    .split('#')[0]
    .trim()
    .replace(/\.md$/i, '');
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Resolves raw references to entry ids. `entries` carry `{ id, absPath,
 * realpath, rootId, layer }`; wikilinks resolve by note name (same root first,
 * then wiki articles, then the shortest path), paths resolve on disk identity.
 */
function createResolver(entries, config, home = os.homedir()) {
  const byPath = new Map();
  const byName = new Map();
  for (const entry of entries) {
    byPath.set(path.normalize(entry.absPath), entry.id);
    if (entry.realpath) byPath.set(path.normalize(entry.realpath), entry.id);
    const name = path.basename(entry.absPath, '.md').toLowerCase();
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(entry);
  }
  const rootPaths = new Map(config.roots.map((root) => [root.id, root.path]));

  function byNoteName(raw, from) {
    const name = noteName(raw);
    if (!name) return null;
    const lower = name.toLowerCase();
    let candidates = byName.get(path.basename(lower)) || [];
    if (lower.includes('/')) {
      candidates = candidates.filter((entry) =>
        toSlashes(entry.absPath).toLowerCase().endsWith(`/${lower}.md`),
      );
    }
    if (candidates.length === 0) return null;
    const rank = (entry) =>
      (entry.rootId === from.rootId ? 0 : 2) + (entry.layer === 'wiki' ? 0 : 1);
    return [...candidates].sort(
      (a, b) => rank(a) - rank(b) || a.absPath.length - b.absPath.length,
    )[0].id;
  }

  function firstExisting(candidates) {
    for (const candidate of candidates) {
      const id = byPath.get(path.normalize(candidate));
      if (id) return id;
    }
    return null;
  }

  function byFilePath(raw, from) {
    let target = safeDecode(raw.split('#')[0].split('?')[0]).trim();
    if (!target) return null;
    if (!path.extname(target)) target += '.md';
    if (!target.toLowerCase().endsWith('.md')) return null;
    const expanded = target.startsWith('~/') ? path.join(home, target.slice(2)) : target;
    if (path.isAbsolute(expanded)) {
      // Repo docs often link from the repository root (`/docs/x.md`), above the indexed root.
      const rootPath = rootPaths.get(from.rootId);
      const ancestors = [];
      for (let dir = path.dirname(from.absPath); dir !== path.dirname(dir); dir = path.dirname(dir)) {
        ancestors.push(path.join(dir, expanded));
      }
      return firstExisting([
        expanded,
        ...(rootPath ? [path.join(rootPath, expanded)] : []),
        ...ancestors,
      ]);
    }
    return firstExisting([path.join(path.dirname(from.absPath), expanded)]);
  }

  function bySourceSpec(raw, from) {
    if (raw.startsWith('[[')) return byNoteName(raw, from);
    const spec = path.extname(raw) ? raw : `${raw}.md`;
    const expanded = spec.startsWith('~/') ? path.join(home, spec.slice(2)) : spec;
    if (path.isAbsolute(expanded)) return firstExisting([expanded]);
    const candidates = [path.join(path.dirname(from.absPath), expanded)];
    if (config.vault) {
      candidates.push(
        path.join(config.vault, path.posix.dirname(config.wikiDir), expanded),
        path.join(config.vault, expanded),
        path.join(config.vault, config.wikiDir, expanded),
        path.join(config.vault, path.posix.dirname(config.discoveredDir), expanded),
      );
    }
    return firstExisting(candidates) || (spec.includes('/') ? null : byNoteName(spec, from));
  }

  return function resolve(link, from) {
    if (link.kind === 'wikilink' || link.kind === 'related') {
      return link.raw.includes('/') && link.kind === 'related'
        ? bySourceSpec(link.raw, from)
        : byNoteName(link.raw, from);
    }
    if (link.kind === 'link') return byFilePath(link.raw, from);
    return bySourceSpec(link.raw, from);
  };
}

/** Raw links resolved against the index, each with its target id or null; duplicates dropped. */
function resolveLinks(links, entry, resolver) {
  const seen = new Set();
  const out = [];
  for (const link of links) {
    const key = `${link.kind}\0${link.raw}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...link, target: resolver(link, entry) });
  }
  return out;
}

/**
 * The link graph over every entry. `loadLinks(entry)` resolves to the entry's
 * raw links (see extractLinks) or rejects when the file is unreadable; one edge
 * is kept per (from, to) pair, of the most specific kind.
 */
async function buildLinkGraph(
  entries,
  loadLinks,
  config,
  { concurrency = 24, home, onProgress } = {},
) {
  const startedAt = Date.now();
  const resolver = createResolver(entries, config, home);
  const best = new Map();
  const unresolved = {};
  const unreadable = [];
  let cursor = 0;
  let done = 0;

  async function worker() {
    while (cursor < entries.length) {
      const entry = entries[cursor++];
      let links;
      try {
        links = await loadLinks(entry);
      } catch {
        unreadable.push(entry.id);
        continue;
      } finally {
        done++;
        if (onProgress) onProgress(done, entries.length);
      }
      for (const link of resolveLinks(links, entry, resolver)) {
        if (!link.target) {
          if (link.kind !== 'cite') (unresolved[entry.id] ||= []).push(link.raw);
          continue;
        }
        if (link.target === entry.id) continue;
        const key = `${entry.id}\0${link.target}`;
        const previous = best.get(key);
        if (!previous || LINK_KINDS.indexOf(link.kind) < LINK_KINDS.indexOf(previous)) {
          best.set(key, link.kind);
        }
      }
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  const edges = [...best.entries()].map(([key, kind]) => {
    const [from, to] = key.split('\0');
    return { from, to, kind };
  });
  return { edges, unresolved, unreadable, ms: Date.now() - startedAt };
}

// --- Keyword terms (core.ts extractTerms) -----------------------------------

const MIN_TERM_LEN = 4;
const MAX_TERMS = 8;
const STOPWORDS = new Set(
  (
    'the and for are but not you your with this that then from have has had was were will would ' +
    'should could can what when where which while into onto about there their them they its ' +
    "it's how why who whom does did done doing using use used make made get got let need want " +
    'please help code file files also just like some any all one two new old clean sorted ' +
    'continue work working stuff thing things good great fine ok yes yeah nice thanks still back ' +
    'other more much lot bit way kind sort type part side case look looking try trying seems ' +
    'maybe might sure even already yet now here today really quite pretty okay carry thats whats ' +
    'hows heres theres dont cant wont isnt doesnt didnt wasnt couldnt shouldnt wouldnt im ive ' +
    'youre youve theyre weve lets gonna wanna'
  ).split(' '),
);

/** Keyword terms for the daemon's FTS leg, exactly as second-brain derives them. */
function extractTerms(prompt) {
  const seen = new Set();
  const terms = [];
  const push = (term) => {
    if (!seen.has(term)) {
      seen.add(term);
      terms.push(term);
    }
  };
  for (const [, phrase] of prompt.matchAll(/"([^"]{4,80})"/g)) push(phrase.toLowerCase());
  for (const [ident] of prompt.matchAll(
    /\b(?:[A-Za-z][\w-]*(?:[_.][\w-]+)+|[a-z]+[A-Z]\w+)\b/g,
  )) {
    push(ident.toLowerCase());
  }
  for (const raw of prompt.toLowerCase().split(/[^a-z0-9_-]+/)) {
    const term = raw.trim();
    if (term.length < MIN_TERM_LEN || STOPWORDS.has(term)) continue;
    push(term);
    if (terms.length >= MAX_TERMS) break;
  }
  return terms.slice(0, MAX_TERMS);
}

module.exports = {
  BASE_EXCLUDE,
  LINK_KINDS,
  buildLinkGraph,
  classifyEntry,
  createResolver,
  extractLinks,
  extractTerms,
  frontmatterList,
  loadKbConfig,
  parseFrontmatter,
  resolveLinks,
  stripCode,
  tierBoost,
};
