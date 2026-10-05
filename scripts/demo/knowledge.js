// A made-up second-brain knowledge base for the demo HOME, plus stand-ins for
// the second-brain daemon and the Jev relevance endpoint, so the Knowledge tab
// can be screenshotted without real notes or credentials.
const fs = require('fs');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const DAY = 24 * 60 * 60 * 1000;

function note(title, { fm = {}, body, ageDays = 3, tags = [] }) {
  return { title, fm, body, ageDays, tags };
}

const VAULT_NOTES = {
  'Wiki/index.md': note('Engineering wiki', {
    ageDays: 1,
    tags: ['index'],
    body: `Start here. Each article is compiled from discovered notes and cites them under \`sources:\`.

## Checkout
- [[checkout-flow]] — how an order moves from cart to confirmation
- [[server-actions]] and [[cart-service]]

## Payments
- [[refund-idempotency]], [[stripe-webhooks]], [[charge-latency]]

## Platform
- [[on-call-runbook]], [[staging-environments]], [[rds-gp3-migration]]

## Product surfaces
- [[dark-mode-tokens]], [[release-train]]
`,
  }),
  'Wiki/checkout/checkout-flow.md': note('Checkout flow', {
    ageDays: 2,
    tags: ['checkout', 'order', 'cart', 'payment', 'confirmation'],
    fm: {
      sources: ['Discovered/2026-09-30-flaky-cart-e2e.md'],
      related: ['[[server-actions]]', '[[cart-service]]'],
    },
    body: `An order moves cart → shipping → payment → confirmation. The storefront owns the first three steps and calls payments-api to charge.

## Steps
1. The cart is read from [[cart-service]] and priced server-side.
2. The shipping form posts to a [[server-actions]] handler that validates with zod.
3. Payment creates a charge with an \`Idempotency-Key\`, see [[refund-idempotency]].

## Failure modes
- Double submits are absorbed by the idempotency key.
- Webhook lag can leave an order "pending"; see [[stripe-webhooks]].
`,
  }),
  'Wiki/checkout/server-actions.md': note('Checkout server actions', {
    ageDays: 4,
    tags: ['checkout', 'server', 'actions', 'nextjs', 'validation', 'zod'],
    fm: { related: ['[[checkout-flow]]'] },
    body: `Checkout mutations run as Next.js server actions in \`app/checkout/actions.ts\`.

## Rules
- Parse every form with a zod schema before touching the database.
- Call \`revalidatePath('/account/orders')\` after creating an order.
- Never trust client totals; recompute from the cart.
`,
  }),
  'Wiki/checkout/cart-service.md': note('Cart service', {
    ageDays: 9,
    tags: ['cart', 'checkout', 'pricing', 'session'],
    fm: { sources: ['Discovered/2026-09-30-flaky-cart-e2e.md'] },
    body: `Carts live in Postgres keyed by session; prices are recomputed on read.

## Gotchas
- E2E tests must wait for the \`cart:updated\` event, not a fixed timeout.
- Guest carts merge into the account cart on login.
`,
  }),
  'Wiki/payments/refund-idempotency.md': note('Refund idempotency', {
    ageDays: 1,
    tags: ['refund', 'idempotency', 'payments', 'retries', 'key'],
    fm: {
      sources: ['Discovered/2026-09-12-refund-retries.md'],
      related: ['[[stripe-webhooks]]', '[[charge-latency]]'],
    },
    body: `Refund and charge requests carry an \`Idempotency-Key\` header. payments-api stores the key with the response in \`refund_requests\` (unique index) and replays it on retries.

## Decisions
- Keys expire after 24 hours.
- A retry with the same key but a different payload returns 409.
- Clients generate keys per user intent, not per HTTP attempt.

## Testing
Table-driven tests cover duplicate keys, conflicting payloads and expiry.
`,
  }),
  'Wiki/payments/stripe-webhooks.md': note('Stripe webhooks', {
    ageDays: 6,
    tags: ['stripe', 'webhooks', 'payments', 'events', 'retries'],
    fm: { related: ['[[refund-idempotency]]'] },
    body: `payments-api verifies the signature, stores the event id, and processes each event once.

## Ordering
Events can arrive out of order; handlers compare the object's \`updated\` timestamp before writing.

## Retries
Stripe retries for three days. Handlers must be idempotent — reuse the [[refund-idempotency]] table for refund events.
`,
  }),
  'Wiki/payments/charge-latency.md': note('Charge latency', {
    ageDays: 3,
    tags: ['latency', 'p99', 'charges', 'fraud', 'payments', 'performance'],
    fm: {
      sources: ['Discovered/2026-09-28-p99-charges.md'],
      related: ['[[on-call-runbook]]'],
    },
    body: `p99 on \`POST /v1/charges\` is dominated by the fraud check.

## Findings
- The fraud scorer was called synchronously with a 2 s timeout.
- Moving it behind a 300 ms budget with a cached score fallback cut p99 from 1.8 s to 420 ms.

## Watch
The \`charges.fraud.fallback\` metric should stay under 2%.
`,
  }),
  'Wiki/infra/on-call-runbook.md': note('On-call runbook', {
    ageDays: 2,
    tags: ['oncall', 'incident', 'runbook', 'latency', 'alerts', 'pager'],
    fm: { related: ['[[charge-latency]]', '[[staging-environments]]'] },
    body: `First steps for a page.

## Payments alerts
- High charge latency: check the fraud fallback rate, see [[charge-latency]].
- Webhook backlog: see [[stripe-webhooks]].

## Database
- Storage alarms on RDS: see [[rds-gp3-migration]].

## After the incident
Write a review using the template in [the handbook](../../../platform-handbook/practices/incident-review.md).
`,
  }),
  'Wiki/infra/staging-environments.md': note('Staging environments', {
    ageDays: 12,
    tags: ['staging', 'environments', 'deploy', 'infra'],
    fm: { related: ['[[rds-gp3-migration]]'] },
    body: `Each service has one shared staging environment, reset nightly from anonymised snapshots.

## Rules
- Ask in #staging before running migrations.
- Feature flags default off in staging; see the handbook's feature flag guide.
`,
  }),
  'Wiki/infra/rds-gp3-migration.md': note('RDS gp3 migration', {
    ageDays: 5,
    tags: ['rds', 'gp3', 'storage', 'iops', 'database', 'infra'],
    fm: { sources: ['Discovered/2026-10-01-gp3-iops.md'] },
    body: `Staging and production RDS volumes moved from gp2 to gp3.

## Settings
- 6,000 provisioned IOPS and 250 MB/s throughput for the orders database.
- The change applies online but triggers a storage optimisation that can take hours.
`,
  }),
  'Wiki/design/dark-mode-tokens.md': note('Dark-mode tokens', {
    ageDays: 8,
    tags: ['design', 'tokens', 'dark', 'theme', 'contrast'],
    fm: { sources: ['Discovered/2026-10-02-token-contrast.md'] },
    body: `Colour tokens come in light and dark pairs in \`tokens/color.json\`.

## Contrast
Every text token pair must reach 4.5:1 against its surface; CI checks this.
`,
  }),
  'Wiki/mobile/release-train.md': note('Mobile release train', {
    ageDays: 15,
    tags: ['mobile', 'release', 'ios', 'android', 'train'],
    body: `Releases cut every second Tuesday; hotfixes go through the same train with a single cherry-pick.

## Checklist
- Bump the build number, freeze strings, run the smoke suite on both platforms.
`,
  }),
  'Discovered/2026-09-12-refund-retries.md': note('Refund retries double-charge', {
    ageDays: 23,
    tags: ['refund', 'retries', 'idempotency', 'payments'],
    body: `Mobile retried a refund after a timeout and the customer was refunded twice. The handler had no idempotency check. Fix: store an idempotency key per refund intent.
`,
  }),
  'Discovered/2026-09-28-p99-charges.md': note('p99 latency on /v1/charges', {
    ageDays: 7,
    tags: ['latency', 'p99', 'charges', 'fraud'],
    body: `Traces show 1.4 s inside \`fraud.Score\`. The scorer has a 2 s timeout and no fallback. Proposal: 300 ms budget with cached score fallback.
`,
  }),
  'Discovered/2026-09-30-flaky-cart-e2e.md': note('Flaky cart e2e', {
    ageDays: 5,
    tags: ['cart', 'e2e', 'tests', 'flaky'],
    body: `\`cart.spec.ts\` used \`waitForTimeout(500)\`. Replaced with waiting for the \`cart:updated\` event; 200 runs green.
`,
  }),
  'Discovered/2026-10-01-gp3-iops.md': note('gp3 IOPS for the orders DB', {
    ageDays: 4,
    tags: ['rds', 'gp3', 'iops'],
    body: `Load test peaked at 4,800 IOPS. Provisioned 6,000 IOPS on gp3 to leave headroom.
`,
  }),
  'Discovered/2026-10-02-token-contrast.md': note('Dark-mode contrast misses', {
    ageDays: 3,
    tags: ['design', 'contrast', 'dark'],
    body: `Muted text on raised surfaces measured 3.9:1 in dark mode. Raised the muted token to #9a9ab0.
`,
  }),
  'Discovered/2026-10-04-webhook-backlog.md': note('Webhook backlog after deploy', {
    ageDays: 1,
    tags: ['webhooks', 'stripe', 'backlog'],
    body: `A deploy paused the webhook worker for 12 minutes; Stripe retried and the backlog drained in 4 minutes. Worth a note in [[stripe-webhooks]].
`,
  }),
  'Planning/q4-checkout-launch.md': note('Q4 checkout launch', {
    ageDays: 2,
    tags: ['checkout', 'launch', 'planning'],
    body: `Launch the new checkout to 100% by mid-November.

## Workstreams
- [[checkout-flow]] hardening and e2e coverage
- [[charge-latency]] under 500 ms p99
- Rollout behind a feature flag, see the handbook.
`,
  }),
  'Reference/glossary.md': note('Glossary', {
    ageDays: 30,
    tags: ['glossary'],
    body: `- **Idempotency key** — a client-chosen key that makes a request safe to retry. See [[refund-idempotency]].
- **gp3** — the RDS storage class with independently provisioned IOPS. See [[rds-gp3-migration]].
`,
  }),
};

const HANDBOOK_NOTES = {
  'architecture/overview.md': note('Platform architecture', {
    ageDays: 20,
    tags: ['architecture', 'services', 'overview'],
    body: `storefront-web (Next.js) calls payments-api (Go) and the cart service. Events flow through a single queue.

- [payments-api](../services/payments-api.md)
- [storefront-web](../services/storefront-web.md)
`,
  }),
  'services/payments-api.md': note('payments-api', {
    ageDays: 6,
    tags: ['payments', 'service', 'charges', 'refund'],
    body: `Owns charges, refunds and Stripe webhooks.

- Runbook: [on-call](../practices/incident-review.md)
- Rollouts use [feature flags](../practices/feature-flags.md)
`,
  }),
  'services/storefront-web.md': note('storefront-web', {
    ageDays: 9,
    tags: ['storefront', 'checkout', 'service', 'nextjs'],
    body: `Customer-facing web app. Checkout lives under \`app/checkout\`.

- Architecture: [overview](../architecture/overview.md)
`,
  }),
  'practices/incident-review.md': note('Incident review template', {
    ageDays: 40,
    tags: ['incident', 'review', 'oncall'],
    body: `Timeline, impact, contributing factors, follow-ups with owners. Blameless.
`,
  }),
  'practices/feature-flags.md': note('Feature flags', {
    ageDays: 14,
    tags: ['flags', 'rollout', 'launch'],
    body: `Every risky change ships behind a flag with a kill switch. Ramp 1% → 10% → 50% → 100% with a day between steps.
`,
  }),
};

/** Queries the capture script runs, with the notes a reader would call relevant. */
const DEMO_QUERIES = [
  {
    query: 'how do we make refund retries safe',
    relevant: ['Wiki/payments/refund-idempotency.md', 'Discovered/2026-09-12-refund-retries.md'],
  },
  {
    query: 'charges endpoint is slow, what did we find last time',
    relevant: ['Wiki/payments/charge-latency.md', 'Discovered/2026-09-28-p99-charges.md'],
  },
  {
    query: 'flaky cart e2e test keeps timing out',
    relevant: ['Discovered/2026-09-30-flaky-cart-e2e.md', 'Wiki/checkout/cart-service.md'],
  },
];

function frontmatter(fm) {
  const lines = [];
  for (const [key, value] of Object.entries(fm)) {
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) lines.push(`  - "${item}"`);
    } else lines.push(`${key}: ${value}`);
  }
  return lines.length ? `---\n${lines.join('\n')}\n---\n` : '';
}

function noteText(n) {
  return `${frontmatter(n.fm)}# ${n.title}\n\n${n.body}`;
}

/** Chunks the way second-brain heads them: "Title > H1" for the intro, then "Title > H1 > H2". */
function chunksOf(n) {
  const chunks = [];
  let heading = `${n.title} > ${n.title}`;
  let line = 1;
  let buffer = [];
  const flush = () => {
    const text = buffer.join('\n').trim();
    if (text) chunks.push({ heading, line, text });
  };
  n.body.split('\n').forEach((row, i) => {
    const h2 = /^##\s+(.+)$/.exec(row);
    if (h2) {
      flush();
      heading = `${n.title} > ${n.title} > ${h2[1]}`;
      line = i + 3;
      buffer = [];
    } else buffer.push(row);
  });
  flush();
  return chunks;
}

const sql = (value) => `'${String(value).replace(/'/g, "''")}'`;

function seedKnowledge(home, now = Date.now()) {
  const vault = path.join(home, 'notes', 'second-brain');
  const handbook = path.join(home, 'notes', 'platform-handbook');
  const cacheDir = path.join(home, '.cache', 'second-brain');
  const demoDir = path.join(home, '.demo');
  fs.mkdirSync(cacheDir, { recursive: true });

  const files = [];
  const write = (root, rel, n, indexPath) => {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, noteText(n));
    const mtime = new Date(now - n.ageDays * DAY);
    fs.utimesSync(file, mtime, mtime);
    files.push({ path: indexPath, realpath: file, mtime: mtime.getTime(), n });
  };
  for (const [rel, n] of Object.entries(VAULT_NOTES)) write(vault, rel, n, rel);
  for (const [rel, n] of Object.entries(HANDBOOK_NOTES)) {
    write(handbook, rel, n, path.join(handbook, rel));
  }

  const config = {
    vault: '~/notes/second-brain',
    roots: [{ id: 'handbook', label: 'acme/platform-handbook', path: '~/notes/platform-handbook' }],
    jev: { keyFile: '~/.demo/jev.key' },
  };
  const configDir = path.join(home, '.config', 'second-brain');
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify(config, null, 2));
  fs.writeFileSync(path.join(demoDir, 'jev.key'), 'demo-not-a-real-key\n');

  const pluginDir = path.join(home, '.claude', 'plugins', 'cache', 'second-brain', 'second-brain', '0.3.7');
  fs.mkdirSync(path.join(pluginDir, 'src', 'engine'), { recursive: true });
  fs.writeFileSync(path.join(pluginDir, 'package.json'), JSON.stringify({ name: 'second-brain', version: '0.3.7' }));
  fs.writeFileSync(path.join(pluginDir, 'src', 'engine', 'daemon.ts'), '// demo stand-in\n');

  const statements = [
    'CREATE TABLE files (path TEXT PRIMARY KEY, realpath TEXT NOT NULL, mtime_ms REAL NOT NULL, size INTEGER NOT NULL, title TEXT NOT NULL);',
    'CREATE TABLE chunks (id INTEGER PRIMARY KEY AUTOINCREMENT, file_path TEXT NOT NULL, heading TEXT NOT NULL, line INTEGER NOT NULL, text TEXT NOT NULL, vec BLOB NOT NULL);',
    'CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);',
  ];
  const chunks = [];
  for (const file of files) {
    const size = fs.statSync(file.realpath).size;
    statements.push(
      `INSERT INTO files VALUES (${sql(file.path)}, ${sql(file.realpath)}, ${file.mtime}, ${size}, ${sql(file.n.title)});`,
    );
    for (const chunk of chunksOf(file.n)) {
      chunks.push({ ...chunk, path: file.path, realpath: file.realpath, tags: file.n.tags });
      statements.push(
        `INSERT INTO chunks (file_path, heading, line, text, vec) VALUES (${sql(file.path)}, ${sql(chunk.heading)}, ${chunk.line}, ${sql(chunk.text)}, x'');`,
      );
    }
  }
  statements.push(
    `INSERT INTO meta VALUES ('schema_version', '1'), ('model', 'Xenova/all-MiniLM-L6-v2'), ('dims', '384'), ('last_index_ms', '${now - 20 * 60 * 1000}');`,
  );
  const dbPath = path.join(cacheDir, 'index.db');
  fs.rmSync(dbPath, { force: true });
  execFileSync('sqlite3', [dbPath], { input: statements.join('\n') });
  fs.writeFileSync(path.join(demoDir, 'knowledge-chunks.json'), JSON.stringify(chunks));

  return { cacheDir, chunksFile: path.join(demoDir, 'knowledge-chunks.json'), queries: DEMO_QUERIES };
}

// --- Stand-in daemon and Jev -----------------------------------------------------

function words(text) {
  return text.toLowerCase().match(/[a-z0-9]+/g) || [];
}

function stem(word) {
  return word.replace(/(ing|ies|es|s|ed)$/, '');
}

/** Deterministic value in [0, 1) for a pair of strings. */
function unit(a, b) {
  return crypto.createHash('sha1').update(`${a}|${b}`).digest().readUInt32BE(0) / 2 ** 32;
}

function rank(list) {
  return new Map(list.map((item, i) => [item.key, i]));
}

function searchChunks(chunks, query, k) {
  const terms = [...new Set(words(query).filter((w) => w.length > 2).map(stem))];
  const scored = chunks.map((chunk, i) => {
    const text = words(`${chunk.heading} ${chunk.text}`).map(stem);
    const tags = chunk.tags.map(stem);
    const keyword = terms.reduce((sum, t) => sum + text.filter((w) => w === t).length, 0);
    const semantic =
      terms.reduce((sum, t) => sum + (tags.some((tag) => tag.startsWith(t) || t.startsWith(tag)) ? 1 : 0), 0) +
      unit(query, chunk.path) * 0.4;
    return { key: i, chunk, keyword, semantic };
  });
  const keywordList = scored.filter((s) => s.keyword > 0).sort((a, b) => b.keyword - a.keyword);
  const semanticList = scored.filter((s) => s.semantic >= 1).sort((a, b) => b.semantic - a.semantic);
  const kr = rank(keywordList);
  const sr = rank(semanticList);
  const fused = scored
    .filter((s) => kr.has(s.key) || sr.has(s.key))
    .map((s) => ({
      ...s,
      score: (kr.has(s.key) ? 1 / (60 + kr.get(s.key)) : 0) + (sr.has(s.key) ? 1 / (60 + sr.get(s.key)) : 0),
      source: kr.has(s.key) && sr.has(s.key) ? 'both' : kr.has(s.key) ? 'keyword' : 'semantic',
    }))
    .sort((a, b) => b.score - a.score);
  const seen = new Set();
  const hits = [];
  for (const s of fused) {
    if (seen.has(s.chunk.path)) continue;
    seen.add(s.chunk.path);
    hits.push({
      path: s.chunk.path,
      realpath: s.chunk.realpath,
      heading: s.chunk.heading,
      excerpt: s.chunk.text.slice(0, 600),
      score: Number(s.score.toFixed(4)),
      source: s.source,
    });
    if (hits.length >= k) break;
  }
  return hits;
}

/** Jev-like judgement: high for the notes a demo query names as relevant, low otherwise. */
function judge(queries, request, note) {
  const known = queries.find((q) => q.query === request);
  const jitter = unit(request, note.source);
  if (known) {
    // One near-miss per query keeps the eval numbers honest-looking.
    if (known.relevant[1] === note.source) return 0.38 + jitter * 0.1;
    return known.relevant.includes(note.source) ? 0.82 + jitter * 0.15 : 0.02 + jitter * 0.22;
  }
  return 0.05 + jitter * 0.6;
}

function readJson(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch {
        resolve({});
      }
    });
  });
}

/** Starts the stand-in daemon and Jev endpoint; resolves with the Jev URL and a closer. */
function startKnowledgeServices(knowledge) {
  const chunks = JSON.parse(fs.readFileSync(knowledge.chunksFile, 'utf8'));
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const send = (res, body) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const server = http.createServer(async (req, res) => {
    if (req.url === '/health') {
      return send(res, {
        model: 'Xenova/all-MiniLM-L6-v2',
        files: new Set(chunks.map((c) => c.path)).size,
        chunks: chunks.length,
        indexed_at: Date.now() - 20 * 60 * 1000,
        unpromoted: 3,
      });
    }
    if (req.url === '/search' && req.method === 'POST') {
      const body = await readJson(req);
      await sleep(70 + unit('search', body.query || '') * 60);
      return send(res, { hits: searchChunks(chunks, body.query || '', Number(body.k) || 12) });
    }
    if (req.url === '/reindex' && req.method === 'POST') {
      return send(res, { indexed: 0, total: chunks.length, pruned: 0, ms: 120 });
    }
    if (req.url === '/v1/decisions' && req.method === 'POST') {
      const body = await readJson(req);
      const notes = body.state?.notes || [];
      await sleep(260 + unit('jev', body.state?.request || '') * 220);
      const answers = Object.fromEntries(
        notes.map((n, i) => [`q${i}`, { noul: Number(judge(knowledge.queries, body.state.request, n).toFixed(3)) }]),
      );
      const inputTokens = 900 + notes.length * 180;
      return send(res, {
        model: 'typesafe/jev-1.13-demo',
        answers,
        usage: { input_tokens: inputTokens, output_tokens: notes.length * 18, cost: inputTokens * 4e-8 },
      });
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      fs.writeFileSync(path.join(knowledge.cacheDir, 'daemon.port'), String(port));
      resolve({
        jevUrl: `http://127.0.0.1:${port}/v1/decisions`,
        close: () => server.close(),
      });
    });
  });
}

module.exports = { DEMO_QUERIES, seedKnowledge, startKnowledgeServices };
