// Dummy projects, sessions and scripted agent scenarios for the demo harness.
// Sessions with a `scenario` are opened live in the grid; the rest populate the
// sidebar history (and spring cleaning, via their age and size).

const groups = [
  { id: 'g1', name: 'Checkout launch', color: '#8088ff', order: 0 },
  { id: 'g2', name: 'Latency incident', color: '#e05070', order: 1 },
  { id: 'g3', name: 'Design refresh', color: '#3ecf5a', order: 2 },
  { id: 'g4', name: 'Mobile release', color: '#f0a030', order: 3 },
];

const old = (key, prompt, ageDays, extra = {}) => ({
  key,
  prompt,
  ageMinutes: Math.round(ageDays * 24 * 60),
  turns: 4,
  ...extra,
});

const abandoned = (key, prompt, ageDays) =>
  old(key, prompt, ageDays, { turns: 1, cacheReadTokens: 60_000 });

const projects = [
  {
    name: 'storefront-web',
    branch: 'feat/checkout-server-actions',
    files: {
      'package.json': '{ "name": "storefront-web", "private": true }\n',
      'app/checkout/page.tsx': 'export default function Checkout() {\n  return null;\n}\n',
      'app/checkout/actions.ts': 'export async function placeOrder() {}\n',
      'tests/cart.spec.ts': "test('cart', async () => {});\n",
    },
    dirty: {
      'app/checkout/actions.ts':
        "'use server';\n\nimport { z } from 'zod';\n\nconst Order = z.object({ cartId: z.string(), email: z.string().email() });\n\nexport async function placeOrder(form: FormData) {\n  const order = Order.parse(Object.fromEntries(form));\n  return createOrder(order);\n}\n",
      'app/checkout/page.tsx':
        "import { placeOrder } from './actions';\n\nexport default function Checkout() {\n  return <form action={placeOrder} />;\n}\n",
      'app/checkout/schema.ts': 'export const MAX_ITEMS = 50;\n',
    },
    sessions: [
      {
        key: 'sf-checkout',
        prompt: 'Migrate the checkout flow from API routes to server actions',
        followUps: [
          'Keep the Stripe webhook route as-is',
          'Now add zod validation to the form',
          'Run the checkout tests',
        ],
        turns: 46,
        activeMinutes: 310,
        cacheReadTokens: 38_000_000,
        toolEntriesPerTurn: 6,
        ageMinutes: 1,
        group: 'g1',
        starred: true,
        scenario: {
          mode: 'working',
          title: 'Checkout server actions',
          verb: 'Wiring up form validation',
          elapsed: 74,
          tokens: 3.4,
          footer: '⏵⏵ accept edits on (shift+tab to cycle)',
          transcript: [
            { k: 'user', t: 'Now add zod validation to the checkout form' },
            {
              k: 'say',
              t: "I'll validate the order payload on the server so the client can't skip it.",
            },
            { k: 'tool', name: 'Read', arg: 'app/checkout/actions.ts', out: ['Read 41 lines'] },
            {
              k: 'tool',
              name: 'Update',
              arg: 'app/checkout/actions.ts',
              out: ['Updated app/checkout/actions.ts with 6 additions and 2 removals'],
            },
            {
              k: 'diff',
              lines: [
                [' ', 3, "import { z } from 'zod';"],
                ['-', 4, 'export async function placeOrder(body: any) {'],
                [
                  '+',
                  4,
                  'const Order = z.object({ cartId: z.string(), email: z.string().email() });',
                ],
                ['+', 5, 'export async function placeOrder(form: FormData) {'],
                ['+', 6, '  const order = Order.parse(Object.fromEntries(form));'],
              ],
            },
            {
              k: 'todo',
              items: [
                [true, 'Move placeOrder into a server action'],
                [true, 'Point the checkout form at the action'],
                [false, 'Validate the payload with zod'],
                [false, 'Run checkout e2e tests'],
              ],
            },
          ],
        },
      },
      {
        key: 'sf-cart-e2e',
        prompt: 'The cart e2e test is flaky on CI — find out why',
        turns: 8,
        ageMinutes: 3,
        group: 'g1',
        scenario: {
          mode: 'permission',
          title: 'Flaky cart e2e',
          transcript: [
            { k: 'user', t: 'The cart e2e test is flaky on CI — find out why' },
            { k: 'tool', name: 'Grep', arg: '"waitForTimeout"', out: ['Found 3 files'] },
            {
              k: 'say',
              t: 'The test waits a fixed 500ms for the cart drawer. On slow CI runners the drawer animation takes longer. I replaced the sleep with an explicit wait for the drawer to be visible.',
            },
            { k: 'say', t: "Let me run the suite 20 times to confirm it's stable." },
          ],
          permission: {
            title: 'Bash command',
            tool: 'Bash',
            command: 'pnpm playwright test tests/cart.spec.ts --repeat-each=20',
            description: 'Run the cart e2e suite 20 times to check for flakes',
          },
          onApprove: 'Running the suite 20×…',
          approveVerb: 'Running playwright',
        },
      },
      old('sf-a11y', 'Audit the product page for accessibility issues', 1.2, {
        group: 'g1',
        turns: 12,
      }),
      old('sf-images', 'Switch product images to next/image with blur placeholders', 2.5, {
        turns: 9,
      }),
      old('sf-ab', 'Set up an A/B test for the new PDP layout', 5),
      old('sf-seo', 'Generate sitemap and robots.txt from the CMS', 9),
      old('sf-i18n', 'Extract hard-coded strings for translation', 16, { turns: 14 }),
      abandoned('sf-typo', 'fix typo in footer', 12),
      abandoned('sf-q', 'what does useOptimistic do', 21),
    ],
  },
  {
    name: 'payments-api',
    branch: 'fix/refund-idempotency',
    files: {
      'go.mod': 'module example.com/payments\n\ngo 1.23\n',
      'internal/refunds/handler.go': 'package refunds\n',
      'internal/charges/handler.go': 'package charges\n',
    },
    dirty: {
      'internal/refunds/handler.go':
        'package refunds\n\n// Idempotency-Key support\nfunc key() string { return "" }\n',
      'internal/refunds/store.go': 'package refunds\n\ntype Store struct{}\n',
    },
    sessions: [
      {
        key: 'pay-idem',
        prompt: 'Add idempotency keys to the refund endpoint',
        turns: 10,
        ageMinutes: 2,
        group: 'g1',
        customTitle: 'Refund idempotency',
        scenario: {
          mode: 'plan',
          title: 'Refund idempotency',
          transcript: [
            { k: 'user', t: 'Add idempotency keys to the refund endpoint' },
            {
              k: 'tool',
              name: 'Read',
              arg: 'internal/refunds/handler.go',
              out: ['Read 212 lines'],
            },
            { k: 'tool', name: 'Grep', arg: '"Idempotency-Key"', out: ['Found 0 files'] },
            { k: 'say', t: "There's no idempotency handling yet. Here's how I'd add it:" },
          ],
          plan: {
            steps: [
              'Parse the Idempotency-Key header in a middleware',
              'Store keys in refund_requests with a unique index',
              'Replay the stored response on duplicate keys',
              'Add table-driven tests for retries',
            ],
          },
          onApprove: 'Great — starting with the middleware.',
          approveVerb: 'Implementing middleware',
        },
      },
      {
        key: 'pay-p99',
        prompt: 'Investigate the p99 latency spike on POST /v1/charges since 14:00',
        turns: 14,
        ageMinutes: 1,
        group: 'g2',
        scenario: {
          mode: 'working',
          title: 'p99 latency on /v1/charges',
          verb: 'Comparing query plans',
          elapsed: 138,
          tokens: 6.8,
          transcript: [
            { k: 'user', t: 'Investigate the p99 latency spike on POST /v1/charges since 14:00' },
            {
              k: 'tool',
              name: 'Bash',
              arg: 'git log --since="14:00" --oneline -- internal/charges',
              out: ['a41f9c2 Add fraud score lookup to charge creation'],
            },
            { k: 'tool', name: 'Read', arg: 'internal/charges/fraud.go', out: ['Read 88 lines'] },
            {
              k: 'say',
              t: 'a41f9c2 adds a synchronous fraud-score lookup to every charge. The lookup filters on merchant_id, but the only index is on (merchant_id, created_at). I think it falls back to a sequential scan when the planner mis-estimates rows.',
            },
            {
              k: 'tool',
              name: 'Bash',
              arg: 'psql $REPLICA -c "EXPLAIN ANALYZE SELECT … FROM fraud_scores …"',
              out: [
                'Seq Scan on fraud_scores  (cost=0.00..48211.90 rows=1 width=16)',
                '  Execution Time: 412.338 ms',
              ],
            },
          ],
        },
      },
      old('pay-webhooks', 'Retry failed webhook deliveries with exponential backoff', 0.3, {
        group: 'g2',
        turns: 7,
      }),
      old('pay-currency', 'Support zero-decimal currencies in amount formatting', 3, {
        starred: true,
      }),
      old('pay-ledger', 'Reconcile ledger entries against the Stripe balance report', 8, {
        turns: 22,
      }),
      old('pay-lint', 'Enable golangci-lint in CI', 26),
      abandoned('pay-q', 'is context.WithoutCancel safe here?', 18),
      abandoned('pay-x', 'hi', 33),
    ],
  },
  {
    name: 'infra',
    branch: 'chore/rds-gp3',
    files: {
      'staging/rds.tf': 'resource "aws_db_instance" "main" {\n  storage_type = "gp2"\n}\n',
      'staging/variables.tf': '',
    },
    dirty: {
      'staging/rds.tf':
        'resource "aws_db_instance" "main" {\n  storage_type = "gp3"\n  iops         = 12000\n}\n',
    },
    sessions: [
      {
        key: 'infra-rds',
        prompt: 'Move the staging RDS instance to gp3 and raise IOPS',
        turns: 6,
        ageMinutes: 4,
        group: 'g2',
        scenario: {
          mode: 'permission',
          title: 'Staging RDS → gp3',
          transcript: [
            { k: 'user', t: 'Move the staging RDS instance to gp3 and raise IOPS' },
            {
              k: 'tool',
              name: 'Update',
              arg: 'staging/rds.tf',
              out: ['Updated staging/rds.tf with 2 additions and 1 removal'],
            },
            {
              k: 'diff',
              lines: [
                ['-', 2, '  storage_type = "gp2"'],
                ['+', 2, '  storage_type = "gp3"'],
                ['+', 3, '  iops         = 12000'],
              ],
            },
            {
              k: 'tool',
              name: 'Bash',
              arg: 'terraform plan -out=tfplan',
              out: ['Plan: 0 to add, 1 to change, 0 to destroy.'],
            },
          ],
          permission: {
            title: 'Bash command',
            tool: 'Bash',
            command: 'terraform apply tfplan',
            description: 'Apply the planned change to staging RDS',
          },
          onApprove: 'Applying…',
          approveVerb: 'Applying terraform',
        },
      },
      old('infra-dd', 'Rotate the Datadog API keys in all environments', 6, { turns: 5 }),
      old('infra-costs', 'Find the top 10 cost drivers in the AWS bill', 11, { turns: 9 }),
      old('infra-k8s', 'Upgrade the EKS cluster to 1.31', 38, { turns: 20 }),
      abandoned('infra-q', 'terraform import syntax?', 15),
    ],
  },
  {
    name: 'design-system',
    branch: 'feat/dark-mode-tokens',
    files: {
      'tokens/color.json': '{}\n',
      'src/Button.tsx': 'export const Button = () => null;\n',
    },
    dirty: {
      'tokens/color.json': '{ "surface": { "dark": "#111318" } }\n',
    },
    sessions: [
      {
        key: 'ds-tokens',
        prompt: 'Add dark-mode colour tokens and wire them into the Button',
        turns: 9,
        ageMinutes: 1,
        group: 'g3',
        scenario: {
          mode: 'ready',
          title: 'Dark-mode tokens',
          verb: 'Generating tokens',
          readyAfterMs: 3000,
          transcript: [
            { k: 'user', t: 'Add dark-mode colour tokens and wire them into the Button' },
            { k: 'tool', name: 'Read', arg: 'tokens/color.json', out: ['Read 64 lines'] },
            {
              k: 'tool',
              name: 'Write',
              arg: 'tokens/color.dark.json',
              out: ['Wrote 58 lines to tokens/color.dark.json'],
            },
          ],
          finale: [
            {
              k: 'tool',
              name: 'Bash',
              arg: 'pnpm test --filter Button',
              out: ['✓ 14 tests passed'],
            },
            {
              k: 'say',
              t: 'Done. Added 29 dark-mode tokens, mapped Button variants to them, and all Button tests pass. Contrast ratios are ≥ 4.5:1 for every text token.',
            },
          ],
        },
      },
      old('ds-icons', 'Replace the icon font with an SVG sprite', 4, { group: 'g3', turns: 11 }),
      old('ds-storybook', 'Upgrade Storybook to v9', 13),
      abandoned('ds-q', 'rename Chip to Tag?', 9),
    ],
  },
  {
    name: 'mobile-app',
    branch: 'main',
    files: { 'package.json': '{ "name": "mobile-app" }\n' },
    dirty: {},
    sessions: [
      {
        key: 'mobile-rn',
        prompt: 'Upgrade React Native to 0.79 and fix the build',
        group: 'g4',
        turns: 18,
        ageMinutes: 6,
        scenario: {
          mode: 'ready',
          title: 'RN 0.79 upgrade',
          readyAfterMs: 2200,
          transcript: [
            { k: 'user', t: 'Upgrade React Native to 0.79 and fix the build' },
            {
              k: 'tool',
              name: 'Bash',
              arg: 'npx react-native upgrade 0.79.2',
              out: ['Upgraded 14 files'],
            },
            {
              k: 'tool',
              name: 'Bash',
              arg: 'cd ios && pod install',
              out: ['Pod installation complete!'],
            },
          ],
          finale: [
            {
              k: 'say',
              t: 'iOS and Android both build now. I had to bump react-native-reanimated to 3.18 and drop a Flipper patch that no longer applies. Want me to open a PR?',
            },
          ],
        },
      },
      old('mobile-push', 'Handle push notification taps when the app is cold-started', 2, {
        group: 'g4',
        turns: 8,
      }),
      old('mobile-deeplinks', 'Add universal links for order tracking', 19),
      abandoned('mobile-q', 'why is metro so slow', 10),
      abandoned('mobile-y', 'test', 27),
    ],
  },
  {
    name: 'docs-site',
    branch: 'main',
    files: { 'docs/webhooks.md': '# Webhooks\n' },
    dirty: {},
    sessions: [
      {
        key: 'docs-webhooks',
        prompt: 'Document the new webhooks API with examples',
        turns: 5,
        ageMinutes: 25,
        scenario: {
          mode: 'idle',
          title: 'Webhooks docs',
          transcript: [
            { k: 'user', t: 'Document the new webhooks API with examples' },
            {
              k: 'tool',
              name: 'Write',
              arg: 'docs/webhooks.md',
              out: ['Wrote 184 lines to docs/webhooks.md'],
            },
            {
              k: 'say',
              t: 'Added docs for event types, signature verification (Node, Go, Python) and retry semantics.',
            },
          ],
        },
      },
      old('docs-search', 'Add Algolia DocSearch to the docs site', 7),
      old('docs-changelog', 'Generate the changelog from merged PRs', 31, { turns: 6 }),
      abandoned('docs-q', 'mdx vs markdoc?', 14),
    ],
  },
];

module.exports = { groups, projects };
