const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  buildLinkGraph,
  classifyEntry,
  createResolver,
  extractLinks,
  extractTerms,
  frontmatterList,
  loadKbConfig,
  parseFrontmatter,
  tierBoost,
} = require('../kb-links');

function tempHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-links-'));
  fs.mkdirSync(path.join(home, '.config', 'second-brain'), { recursive: true });
  return home;
}

function writeConfig(home, config) {
  fs.writeFileSync(
    path.join(home, '.config', 'second-brain', 'config.json'),
    JSON.stringify(config),
  );
}

test('loadKbConfig reports a missing config without throwing', () => {
  const home = tempHome();
  const config = loadKbConfig({ env: {}, home });
  assert.equal(config.vault, '');
  assert.match(config.error, /no config at/);
  assert.deepEqual(config.roots, []);
});

test('loadKbConfig expands ~, keeps existing roots and applies layout and boost', () => {
  const home = tempHome();
  fs.mkdirSync(path.join(home, 'Notes'));
  fs.mkdirSync(path.join(home, 'team-kb'));
  writeConfig(home, {
    vault: '~/Notes/',
    roots: [
      { id: 'team', path: '~/team-kb', label: 'team KB', exclude: ['/drafts/'] },
      { id: 'gone', path: '~/missing' },
      { path: '~/team-kb' },
    ],
    exclude: ['/Private/'],
    layout: { wiki: '/wiki/', discovered: 'raw/Found' },
    boost: { 'agent-memory/': 2, bad: -1 },
    jev: { keyFile: '~/.secrets/key' },
  });

  const config = loadKbConfig({ env: {}, home });
  assert.equal(config.error, undefined);
  assert.equal(config.vault, path.join(home, 'Notes'));
  assert.equal(config.wikiDir, 'wiki');
  assert.equal(config.discoveredDir, 'raw/Found');
  assert.deepEqual(
    config.roots.map((root) => [root.id, root.label, root.isVault]),
    [
      ['vault', 'second-brain vault', true],
      ['team', 'team KB', false],
    ],
  );
  assert.ok(config.roots[0].exclude.includes('/Private/'));
  assert.ok(config.roots[1].exclude.includes('/drafts/'));
  assert.deepEqual(config.boost, { 'wiki/': 3, 'agent-memory/': 2 });
  assert.deepEqual(config.jev, { keyFile: path.join(home, '.secrets/key'), jwtFile: null });
});

test('loadKbConfig honours SECOND_BRAIN_CONFIG and reports a missing vault', () => {
  const home = tempHome();
  const file = path.join(home, 'alt.json');
  fs.writeFileSync(file, JSON.stringify({ vault: '~/nope' }));
  const config = loadKbConfig({ env: { SECOND_BRAIN_CONFIG: file }, home });
  assert.equal(config.configFile, file);
  assert.equal(config.vault, '');
  assert.match(config.error, /vault not found/);
  assert.equal(config.jev, null);
});

test('tierBoost picks the largest matching boost', () => {
  const boost = { 'KB/main/wiki/': 3, 'agent-memory/': 2 };
  assert.equal(tierBoost('KB/main/wiki/a.md', boost), 3);
  assert.equal(tierBoost('Reference/agent-memory/x.md', boost), 2);
  assert.equal(tierBoost('notes/x.md', boost), 1);
});

test('classifyEntry maps vault-relative and absolute index paths to roots and layers', () => {
  const config = {
    vault: '/v',
    wikiDir: 'KB/main/wiki',
    discoveredDir: 'KB/main/raw/Discovered',
    roots: [
      { id: 'vault', path: '/v', isVault: true },
      { id: 'repo', path: '/p/repo', isVault: false },
      { id: 'repo-docs', path: '/p/repo/docs', isVault: false },
    ],
  };
  assert.deepEqual(classifyEntry('KB/main/wiki/a.md', config), {
    rootId: 'vault',
    absPath: path.join('/v', 'KB/main/wiki/a.md'),
    relPath: 'KB/main/wiki/a.md',
    layer: 'wiki',
  });
  assert.equal(classifyEntry('KB/main/raw/Discovered/x.md', config).layer, 'discovered');
  assert.equal(classifyEntry('/p/repo/docs/deep/b.md', config).rootId, 'repo-docs');
  assert.equal(classifyEntry('/p/repo/docs/deep/b.md', config).relPath, 'deep/b.md');
  assert.equal(classifyEntry('/elsewhere/c.md', config).rootId, 'other');
});

test('frontmatterList reads inline and dash lists and drops comments', () => {
  const text = [
    '---',
    'sources: [raw/Discovered/a.md, "raw/Discovered/b.md" # first]',
    'related:',
    '  - other.md # see also',
    '  - "[[third]]"',
    '---',
    '# Body',
  ].join('\n');
  const { block, fields, body } = parseFrontmatter(text);
  assert.equal(body, '# Body');
  assert.deepEqual(frontmatterList(fields, block, 'sources'), [
    'raw/Discovered/a.md',
    'raw/Discovered/b.md',
  ]);
  assert.deepEqual(frontmatterList(fields, block, 'related'), ['other.md', '[[third]]']);
});

test('extractLinks finds every reference kind and ignores code and external URLs', () => {
  const text = [
    '---',
    'sources: [raw/Discovered/2026-09-30-x.md]',
    'related: [peer.md]',
    '---',
    'See [[Gateway auth|auth]] and [[deploy#rollback]], ![[diagram.png]].',
    'Also [the guide](../guide/setup.md#step-2), [site](https://example.com), [top](#top).',
    'Cited inline: raw/Discovered/2026-09-30-y.md',
    'Not notes: [proto](../api.proto), [dir](./archive/), [mdx](./a.mdx), [mail](mailto:a@b.c).',
    '```',
    '[[not-a-link]] [nope](nope.md)',
    '```',
    'Inline `[[also-not]]` code.',
  ].join('\n');
  assert.deepEqual(extractLinks(text), [
    { kind: 'source', raw: 'raw/Discovered/2026-09-30-x.md' },
    { kind: 'related', raw: 'peer.md' },
    { kind: 'wikilink', raw: 'Gateway auth' },
    { kind: 'wikilink', raw: 'deploy' },
    { kind: 'link', raw: '../guide/setup.md#step-2' },
    { kind: 'cite', raw: 'Discovered/2026-09-30-x.md' },
    { kind: 'cite', raw: 'Discovered/2026-09-30-y.md' },
  ]);
});

function fixture() {
  const config = {
    vault: '/v',
    wikiDir: 'KB/main/wiki',
    discoveredDir: 'KB/main/raw/Discovered',
    roots: [
      { id: 'vault', path: '/v', isVault: true },
      { id: 'repo', path: '/p/repo', isVault: false },
    ],
  };
  const entries = [
    'KB/main/wiki/gateway.md',
    'KB/main/wiki/deploy.md',
    'KB/main/raw/Discovered/2026-09-30-x.md',
    'notes/deploy.md',
    '/p/repo/docs/deploy.md',
    '/p/repo/docs/guide/setup.md',
    '/p/repo/README.md',
  ].map((id) => ({ id, ...classifyEntry(id, config), realpath: null }));
  return { config, entries };
}

test('createResolver prefers same root, then wiki, for note names and resolves paths on disk', () => {
  const { config, entries } = fixture();
  const resolve = createResolver(entries, config, '/home');
  const byId = (id) => entries.find((entry) => entry.id === id);
  const article = byId('KB/main/wiki/gateway.md');
  const readme = byId('/p/repo/README.md');

  assert.equal(resolve({ kind: 'wikilink', raw: 'deploy' }, article), 'KB/main/wiki/deploy.md');
  assert.equal(resolve({ kind: 'wikilink', raw: 'Deploy' }, readme), '/p/repo/docs/deploy.md');
  assert.equal(resolve({ kind: 'wikilink', raw: 'notes/deploy' }, article), 'notes/deploy.md');
  assert.equal(resolve({ kind: 'related', raw: 'deploy.md' }, article), 'KB/main/wiki/deploy.md');
  assert.equal(
    resolve({ kind: 'source', raw: 'raw/Discovered/2026-09-30-x.md' }, article),
    'KB/main/raw/Discovered/2026-09-30-x.md',
  );
  assert.equal(
    resolve({ kind: 'cite', raw: 'Discovered/2026-09-30-x.md' }, article),
    'KB/main/raw/Discovered/2026-09-30-x.md',
  );
  assert.equal(
    resolve({ kind: 'link', raw: 'docs/guide/setup.md#intro' }, readme),
    '/p/repo/docs/guide/setup.md',
  );
  assert.equal(
    resolve({ kind: 'link', raw: './guide/setup' }, byId('/p/repo/docs/deploy.md')),
    '/p/repo/docs/guide/setup.md',
  );
  assert.equal(
    resolve({ kind: 'link', raw: '/docs/deploy.md' }, byId('/p/repo/docs/guide/setup.md')),
    '/p/repo/docs/deploy.md',
  );
  assert.equal(resolve({ kind: 'link', raw: 'missing.md' }, readme), null);
  assert.equal(resolve({ kind: 'link', raw: 'image.png' }, readme), null);
  assert.equal(resolve({ kind: 'wikilink', raw: 'nowhere' }, article), null);
});

test('buildLinkGraph keeps the most specific edge per pair and reports gaps', async () => {
  const { config, entries } = fixture();
  const texts = {
    'KB/main/wiki/gateway.md': [
      '---',
      'sources: [raw/Discovered/2026-09-30-x.md]',
      'related: [deploy.md, ghost.md]',
      '---',
      'Body cites raw/Discovered/2026-09-30-x.md and [[deploy]] and [[gateway]].',
    ].join('\n'),
    '/p/repo/README.md': 'See [setup](docs/guide/setup.md).',
  };
  const progress = [];
  const graph = await buildLinkGraph(
    entries,
    async (entry) => {
      if (entry.id === 'notes/deploy.md') throw new Error('EPERM');
      return extractLinks(texts[entry.id] || '', config);
    },
    config,
    { home: '/home', concurrency: 2, onProgress: (done, total) => progress.push([done, total]) },
  );
  assert.deepEqual(progress.at(-1), [entries.length, entries.length]);
  assert.deepEqual(
    graph.edges.sort((a, b) => a.to.localeCompare(b.to)),
    [
      { from: '/p/repo/README.md', to: '/p/repo/docs/guide/setup.md', kind: 'link' },
      {
        from: 'KB/main/wiki/gateway.md',
        to: 'KB/main/raw/Discovered/2026-09-30-x.md',
        kind: 'source',
      },
      { from: 'KB/main/wiki/gateway.md', to: 'KB/main/wiki/deploy.md', kind: 'related' },
    ],
  );
  assert.deepEqual(graph.unresolved, { 'KB/main/wiki/gateway.md': ['ghost.md'] });
  assert.deepEqual(graph.unreadable, ['notes/deploy.md']);
});

test('extractTerms matches second-brain keyword extraction', () => {
  assert.deepEqual(extractTerms('How does the "rodeo deploy" pipeline handle rollbacks?'), [
    'rodeo deploy',
    'rodeo',
    'deploy',
    'pipeline',
    'handle',
    'rollbacks',
  ]);
  assert.deepEqual(extractTerms('why is auth_token.refresh failing in getUserProfile'), [
    'auth_token.refresh',
    'getuserprofile',
    'auth_token',
    'refresh',
    'failing',
  ]);
  assert.deepEqual(extractTerms('do it'), []);
});
