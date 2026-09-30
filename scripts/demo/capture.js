// Regenerates the README screenshots from a seeded demo environment.
//
//   node scripts/demo/capture.js                 # all shots → build/
//   node scripts/demo/capture.js hero cleanup    # only the named shots
//   SB_DEMO_OUT=/tmp/shots node scripts/demo/capture.js
//   SB_DEMO_KEEP=1 node scripts/demo/capture.js none   # just launch the demo
//
// Requires the renderer bundles (`npm run build:renderer` etc.) to be built.
const fs = require('fs');
const path = require('path');
const { seed } = require('./seed');
const { launch } = require('./launch');
const { connect } = require('./cdp');

const DEMO_HOME = process.env.SB_DEMO_HOME || undefined;
const OUT_DIR = process.env.SB_DEMO_OUT || path.resolve(__dirname, '..', '..', 'build');
const PORT = Number(process.env.SB_DEMO_PORT || 9339);
const DEMO_USAGE = {
  session: 42,
  sessionReset: '3:00 PM',
  weekAll: 61,
  weekAllReset: 'Oct 3',
  weekSonnet: 18,
  weekOpus: 73,
  weekOpusReset: 'Oct 3',
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(cdp, condition, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await cdp.evaluate(`return !!(${condition})`, 2000)) return;
    } catch {}
    await sleep(250);
  }
  throw new Error(`Timed out waiting for: ${condition}`);
}

// Renderer-side helpers shared by every shot. app.js is a classic script, so
// its top-level functions and bindings are reachable from Runtime.evaluate.
const HELPERS = `
  const $ = s => document.querySelector(s);
  const click = s => { const el = $(s); if (!el) throw new Error('missing ' + s); el.click(); };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const scrollTop = () => {
    for (const el of document.querySelectorAll('#terminals, #grid-viewer, #sidebar-content, #main *')) {
      if (el.scrollTop) el.scrollTop = 0;
    }
  };
  const gridFilter = async (status, group = 'all') => {
    if (!gridViewActive) showGridView();
    // The toolbar is rebuilt on every grid render, so give it a moment to exist.
    const chip = async (s) => {
      for (let i = 0; i < 30 && !$(s); i++) await wait(100);
      click(s);
    };
    await chip('.grid-status-filter[data-filter="' + status + '"]');
    await chip('.grid-group-filter[data-group="' + group + '"]');
    await wait(400);
    scrollTop();
  };
`;

function shots(manifest) {
  const id = (key) => manifest.sessionIds[key];
  return {
    hero: {
      file: 'screenshot.png',
      prepare: `await gridFilter('all'); focusGridCard(${JSON.stringify(id('sf-checkout'))}); await wait(600); scrollTop();`,
    },
    // Keep the focused card inside the filtered view: the grid's passive
    // end-of-render focus otherwise lands on (and marks seen) the first card.
    group: {
      file: 'screenshot-grid-group.png',
      prepare: `
        const sid = ${JSON.stringify(id('sf-checkout'))};
        focusGridCard(sid);
        await gridFilter('all', 'g1');
        const reply = [...document.querySelectorAll('.grid-card[data-session-id="' + sid + '"] .quick-actions-bar button')]
          .find(b => /reply/i.test(b.textContent));
        reply.click();
        await wait(200);
        const box = $('.quick-reply-popover textarea');
        box.value = 'When the tests pass, open a draft PR and link the checkout RFC';
        box.dispatchEvent(new Event('input', { bubbles: true }));`,
      cleanup: `closeQuickReplyComposer(); await gridFilter('all');`,
    },
    folders: {
      file: 'screenshot-folders.png',
      prepare: `
        localStorage.setItem('collapsedGridGroups', JSON.stringify(['g1', 'g2']));
        await gridFilter('all');
        focusGridCard(${JSON.stringify(id('docs-webhooks'))});
        showGridView();
        if (sidebarViewMode !== 'folder') click('#view-mode-toggle');
        await wait(800);
        scrollTop();
        const list = $('#sidebar-content');
        const folder = list.querySelector('.user-group');
        list.scrollTop = folder.getBoundingClientRect().top - list.getBoundingClientRect().top - 8;
        await wait(300);`,
      cleanup: `
        if (sidebarViewMode === 'folder') click('#view-mode-toggle');
        localStorage.removeItem('collapsedGridGroups');
        focusGridCard(${JSON.stringify(id('sf-checkout'))});
        showGridView();
        await wait(300);
        scrollTop();`,
    },
    cleanup: {
      file: 'screenshot-spring-cleaning.png',
      prepare: `click('#spring-cleaning-btn'); await wait(900);`,
      cleanup: `$('.spring-cleaning-cancel-btn')?.click();`,
    },
    palette: {
      file: 'screenshot-command-palette.png',
      prepare: `
        openCommandPalette();
        await wait(300);
        const input = document.activeElement;
        input.value = 'pay';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await wait(400);`,
      cleanup: `document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));`,
    },
    ide: {
      file: 'screenshot-ide.png',
      prepare: `
        hideGridView();
        const sid = ${JSON.stringify(id('sf-checkout'))};
        showSession(sid);
        await wait(300);
        const root = ${JSON.stringify(path.join(manifest.home, 'dev', 'storefront-web'))};
        diffMode = 'inline';
        getSessionState(sid).panelWidth = 820;
        openDiffTab(sid, 'demo-diff', {
          tabName: 'actions.ts',
          oldFilePath: root + '/app/checkout/actions.ts',
          oldContent: ${JSON.stringify(DIFF_OLD)},
          newContent: ${JSON.stringify(DIFF_NEW)},
        });
        await wait(1200);`,
      cleanup: `closeAllDiffs(${JSON.stringify(id('sf-checkout'))});`,
    },
    stats: {
      file: 'screenshot-stats.png',
      prepare: `
        click('#sidebar-tabs .sidebar-tab[data-tab="stats"]');
        for (let i = 0; i < 60 && $('.stats-spinner'); i++) await wait(250);
        buildUsageSection(${JSON.stringify(DEMO_USAGE)});
        await wait(300);`,
      cleanup: `click('#sidebar-tabs .sidebar-tab[data-tab="sessions"]');`,
    },
  };
}

const DIFF_OLD = `import { db } from '@/lib/db';

export async function placeOrder(body: any) {
  const cart = await db.cart.findUnique({ where: { id: body.cartId } });
  if (!cart) throw new Error('Cart not found');
  return db.order.create({ data: { cartId: cart.id, email: body.email } });
}
`;

const DIFF_NEW = `'use server';

import { z } from 'zod';
import { db } from '@/lib/db';
import { revalidatePath } from 'next/cache';

const Order = z.object({ cartId: z.string(), email: z.string().email() });

export async function placeOrder(form: FormData) {
  const input = Order.parse(Object.fromEntries(form));
  const cart = await db.cart.findUnique({ where: { id: input.cartId } });
  if (!cart) throw new Error('Cart not found');
  const order = await db.order.create({ data: { cartId: cart.id, email: input.email } });
  revalidatePath('/account/orders');
  return order;
}
`;

// Resolves with the fullscreen viewport ({ width, height, dpr } in CSS px).
async function setUpDemo(cdp, manifest) {
  await waitFor(cdp, `innerWidth >= screen.width - 1 && innerHeight >= screen.height - 1`);
  await waitFor(
    cdp,
    `typeof sessionMap !== 'undefined' && sessionMap.size >= ${Object.keys(manifest.sessionIds).length}`,
  );
  await cdp.evaluate(`
    const m = ${JSON.stringify(manifest)};
    await window.api.setSetting('groups', m.groups);
    for (const id of m.starred) await window.api.toggleStar(id);
    await window.api.setSetting('usage:lastSuccessful', {
      fetchedAt: new Date().toISOString(),
      usage: ${JSON.stringify(DEMO_USAGE)},
    });
    setTimeout(() => location.reload(), 50);`);
  await sleep(1500);
  await waitFor(
    cdp,
    `typeof sessionMap !== 'undefined' && sessionMap.size >= ${Object.keys(manifest.sessionIds).length}`,
  );
  await cdp.evaluate(`
    const ids = ${JSON.stringify(manifest.liveSessionIds)};
    if (!gridViewActive) showGridView();
    for (const id of ids) await openSession(sessionMap.get(id));`);
  await waitFor(cdp, `attentionSessions.size >= 3 && responseReadySessions.size >= 2`, 45_000);
  await sleep(1500);
  return cdp.evaluate(`return { width: innerWidth, height: innerHeight, dpr: devicePixelRatio }`);
}

async function main() {
  const only = new Set(process.argv.slice(2));
  const manifest = seed(DEMO_HOME);
  const child = launch(manifest, { port: PORT });
  let cdp;
  try {
    cdp = await connect(PORT);
    await setUpDemo(cdp, manifest);
    if (process.env.SB_DEMO_DEBUG) {
      await cdp.send('Page.enable');
      await cdp.send('Inspector.enable');
      cdp.on('Page.frameRequestedNavigation', (p) => console.log('[nav-request]', p.reason, p.url));
      cdp.on('Page.frameNavigated', (p) => console.log('[navigated]', p.frame.url));
      cdp.on('Inspector.targetCrashed', () => console.log('[crashed]'));
      cdp.on('Inspector.detached', (p) => console.log('[detached]', p.reason));
    }
    fs.mkdirSync(OUT_DIR, { recursive: true });
    for (const [name, shot] of Object.entries(shots(manifest))) {
      if (only.size && !only.has(name)) continue;
      for (let attempt = 1; ; attempt++) {
        try {
          await cdp.evaluate(HELPERS + shot.prepare);
          await sleep(500);
          const file = path.join(OUT_DIR, shot.file);
          fs.writeFileSync(file, await cdp.screenshot());
          console.log(`saved ${path.relative(process.cwd(), file)}`);
          if (shot.cleanup) await cdp.evaluate(HELPERS + shot.cleanup);
          await sleep(300);
          break;
        } catch (err) {
          // The renderer occasionally resets mid-run; start it over once.
          if (attempt > 1 || !/navigated or closed|timed out/i.test(err.message)) throw err;
          console.warn(`${name}: ${err.message}, retrying`);
          cdp.close();
          cdp = await connect(PORT);
          await setUpDemo(cdp, manifest);
        }
      }
    }
  } finally {
    cdp?.close();
    if (process.env.SB_DEMO_KEEP === '1') {
      child.unref();
      console.log(
        `Demo left running (pid ${child.pid}, CDP port ${PORT}); close the window to exit.`,
      );
    } else {
      child.kill('SIGTERM');
    }
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { HELPERS, DEMO_USAGE, sleep, waitFor, setUpDemo };
