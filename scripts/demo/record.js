// Records the promo video: drives the seeded demo like a user would (real mouse
// and keyboard input over CDP), screencasts it, and encodes a 30fps MP4.
//
//   node scripts/demo/record.js      # → dist/demo/switchboard-demo.mp4 (+ -web.mp4)
//   SB_DEMO_VIDEO=/tmp/demo.mp4 node scripts/demo/record.js
//
// Requires ffmpeg (on PATH, or SB_FFMPEG=/path/to/ffmpeg) and the renderer
// bundles to be built.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { seed } = require('./seed');
const { launch } = require('./launch');
const { connect } = require('./cdp');
const { HELPERS, DEMO_USAGE, sleep, setUpDemo } = require('./capture');

const PORT = Number(process.env.SB_DEMO_PORT || 9339);
const FPS = 30;
const OUT_FILE =
  process.env.SB_DEMO_VIDEO ||
  path.resolve(__dirname, '..', '..', 'dist', 'demo', 'switchboard-demo.mp4');
const FFMPEG = process.env.SB_FFMPEG || 'ffmpeg';
const ICON_URL = 'file://' + path.resolve(__dirname, '..', '..', 'build', 'icon.png');

// The video starts with only two folders so it can create one on camera.
const VIDEO_GROUPS = ['g1', 'g2'];
const NEW_FOLDER = { name: 'Friday release', color: '#f0a050' };

// Cursor, captions, title cards and confetti, drawn above the app. Everything is
// pointer-events:none so elementFromPoint (used by drag-and-drop) ignores it.
const OVERLAY = `
  if (!window.__sb) {
    const style = document.createElement('style');
    style.textContent = \`
      .sb-ov { position: fixed; pointer-events: none; z-index: 2147483000; }
      #sb-cursor { left: 0; top: 0; width: 30px; height: 30px; transform: translate(-100px, -100px);
        filter: drop-shadow(0 3px 6px rgba(0,0,0,.55)); z-index: 2147483647; }
      .sb-ripple { width: 44px; height: 44px; margin: -22px 0 0 -22px; border-radius: 50%;
        border: 3px solid rgba(160,170,255,.95); animation: sb-ripple .55s ease-out forwards; z-index: 2147483646; }
      @keyframes sb-ripple { from { transform: scale(.3); opacity: 1; } to { transform: scale(1.5); opacity: 0; } }
      #sb-caption { left: 50%; bottom: 72px; transform: translate(-50%, 24px); opacity: 0;
        transition: opacity .45s ease, transform .45s ease; padding: 18px 34px; border-radius: 18px;
        background: rgba(14,16,30,.82); backdrop-filter: blur(14px); color: #fff; white-space: nowrap;
        font: 600 34px/1.2 -apple-system, BlinkMacSystemFont, 'Inter', sans-serif; letter-spacing: -.01em;
        border: 1px solid rgba(128,136,255,.45); box-shadow: 0 18px 60px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.04) inset; }
      #sb-caption.show { opacity: 1; transform: translate(-50%, 0); }
      #sb-caption em { font-style: normal; background: linear-gradient(90deg,#a3a9ff,#6fe3a0);
        -webkit-background-clip: text; color: transparent; }
      #sb-card { inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
        gap: 22px; opacity: 0; transition: opacity .8s ease; color: #fff; text-align: center;
        background: radial-gradient(1200px 700px at 50% 38%, #262a5a 0%, #111327 55%, #07080f 100%);
        font-family: -apple-system, BlinkMacSystemFont, 'Inter', sans-serif; z-index: 2147483500; }
      #sb-card.show { opacity: 1; }
      #sb-card img { width: 148px; height: 148px; border-radius: 34px; box-shadow: 0 20px 80px rgba(128,136,255,.45); }
      #sb-card h1 { margin: 0; font-size: 96px; font-weight: 750; letter-spacing: -.03em; }
      #sb-card p { margin: 0; font-size: 36px; color: #b9bdf0; font-weight: 500; }
      #sb-card .sb-url { font-size: 30px; color: #6fe3a0; font-weight: 600; margin-top: 10px; }
      #sb-card .sb-dots { display: flex; gap: 14px; margin-top: 6px; }
      #sb-card .sb-dots span { width: 14px; height: 14px; border-radius: 50%; }
      #sb-confetti { inset: 0; width: 100vw; height: 100vh; z-index: 2147483600; }
    \`;
    document.head.appendChild(style);

    const cursor = document.createElement('div');
    cursor.id = 'sb-cursor';
    cursor.className = 'sb-ov';
    cursor.innerHTML = '<svg viewBox="0 0 24 24" width="30" height="30"><path d="M3 2l7.5 19 2.6-7.9L21 10.5z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    document.body.appendChild(cursor);
    const moveCursor = (e) => { cursor.style.transform = 'translate(' + (e.clientX - 4) + 'px,' + (e.clientY - 3) + 'px)'; };
    document.addEventListener('pointermove', moveCursor, { capture: true, passive: true });
    document.addEventListener('pointerdown', (e) => {
      moveCursor(e);
      const r = document.createElement('div');
      r.className = 'sb-ov sb-ripple';
      r.style.left = e.clientX + 'px';
      r.style.top = e.clientY + 'px';
      document.body.appendChild(r);
      setTimeout(() => r.remove(), 600);
    }, { capture: true, passive: true });

    const caption = document.createElement('div');
    caption.id = 'sb-caption';
    caption.className = 'sb-ov';
    document.body.appendChild(caption);

    const card = document.createElement('div');
    card.id = 'sb-card';
    card.className = 'sb-ov';
    document.body.appendChild(card);

    const confetti = (origins) => {
      const canvas = document.createElement('canvas');
      canvas.id = 'sb-confetti';
      canvas.className = 'sb-ov';
      const dpr = window.devicePixelRatio || 1;
      canvas.width = innerWidth * dpr;
      canvas.height = innerHeight * dpr;
      document.body.appendChild(canvas);
      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);
      const colors = ['#8088ff', '#3ecf5a', '#f0a050', '#4fc3f7', '#e05070', '#c0a0ff', '#e0c050', '#ffffff'];
      const parts = [];
      for (const o of origins) {
        for (let i = 0; i < o.count; i++) {
          const a = o.angle + (Math.random() - 0.5) * o.spread;
          const v = o.speed * (0.55 + Math.random() * 0.6);
          parts.push({ x: o.x, y: o.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
            w: 11 + Math.random() * 11, h: 7 + Math.random() * 8, r: Math.random() * 6.28,
            vr: (Math.random() - 0.5) * 0.35, c: colors[(Math.random() * colors.length) | 0],
            round: Math.random() < 0.25, wob: Math.random() * 6.28 });
        }
      }
      const start = performance.now();
      const frame = (now) => {
        const t = (now - start) / 1000;
        ctx.clearRect(0, 0, innerWidth, innerHeight);
        for (const p of parts) {
          p.vy += 0.32; p.vx *= 0.985; p.vy *= 0.985;
          p.x += p.vx + Math.sin(p.wob += 0.08) * 0.8; p.y += p.vy; p.r += p.vr;
          ctx.save();
          ctx.globalAlpha = Math.max(0, Math.min(1, 4.2 - t));
          ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c;
          if (p.round) { ctx.beginPath(); ctx.arc(0, 0, p.h / 1.6, 0, 6.28); ctx.fill(); }
          else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.r * 1.7)) + 1);
          ctx.restore();
        }
        if (t < 4.4) requestAnimationFrame(frame); else canvas.remove();
      };
      requestAnimationFrame(frame);
    };

    window.__sb = {
      caption(html) {
        caption.classList.remove('show');
        setTimeout(() => { caption.innerHTML = html; caption.classList.add('show'); }, caption.innerHTML ? 250 : 0);
      },
      hideCaption() { caption.classList.remove('show'); },
      card(html) { card.innerHTML = html; card.classList.add('show'); },
      hideCard() { card.classList.remove('show'); },
      confetti,
    };
  }
`;

const DOTS = `<div class="sb-dots">${['#8088ff', '#e05070', '#3ecf5a', '#f0a050', '#4fc3f7']
  .map((c) => `<span style="background:${c}"></span>`)
  .join('')}</div>`;
const INTRO_CARD = `<img src="${ICON_URL}"><h1>Switchboard</h1><p>Mission control for your Claude Code agents</p>${DOTS}`;
const OUTRO_CARD = `<img src="${ICON_URL}"><h1>Switchboard</h1><p>Free and open source for macOS, Windows and Linux</p><div class="sb-url">github.com/HaydnG/switchboard</div>`;

// ---------------------------------------------------------------------------
// Screencast recorder: frames land on disk with their arrival time, then get
// resampled to a constant frame rate (the screencast only emits on repaint).

function startRecorder(cdp, framesDir, vp) {
  fs.rmSync(framesDir, { recursive: true, force: true });
  fs.mkdirSync(framesDir, { recursive: true });
  const frames = [];
  const off = cdp.on('Page.screencastFrame', (p) => {
    const file = path.join(framesDir, String(frames.length).padStart(6, '0') + '.jpg');
    frames.push({ t: Date.now(), file });
    fs.writeFile(file, Buffer.from(p.data, 'base64'), () => {});
    cdp.send('Page.screencastFrameAck', { sessionId: p.sessionId }).catch(() => {});
  });
  const started = cdp.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 92,
    maxWidth: Math.round(vp.width * vp.dpr),
    maxHeight: Math.round(vp.height * vp.dpr),
    everyNthFrame: 1,
  });
  return {
    started,
    async stop() {
      const end = Date.now();
      await cdp.send('Page.stopScreencast');
      off();
      await sleep(500);
      return { frames, end };
    },
  };
}

function encode({ frames, end }, framesDir, outFile) {
  const list = ['ffconcat version 1.0'];
  const t0 = frames[0].t;
  const total = Math.floor(((end - t0) / 1000) * FPS);
  let i = 0;
  let current = null;
  let run = 0;
  const flush = () => {
    if (!current) return;
    list.push(`file '${current}'`, `duration ${(run / FPS).toFixed(6)}`);
  };
  for (let k = 0; k < total; k++) {
    const t = t0 + (k * 1000) / FPS;
    while (i + 1 < frames.length && frames[i + 1].t <= t) i++;
    if (frames[i].file === current) {
      run++;
    } else {
      flush();
      current = frames[i].file;
      run = 1;
    }
  }
  flush();
  list.push(`file '${current}'`);
  const listFile = path.join(framesDir, 'frames.ffconcat');
  fs.writeFileSync(listFile, list.join('\n') + '\n');
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const x264 = (crf) => [
    '-c:v',
    'libx264',
    '-preset',
    'slow',
    '-crf',
    crf,
    '-profile:v',
    'high',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
  ];
  execFileSync(
    FFMPEG,
    [
      '-y',
      '-loglevel',
      'error',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      listFile,
      '-vf',
      `fps=${FPS}`,
      '-fps_mode',
      'cfr',
      ...x264('18'),
      outFile,
    ],
    { stdio: 'inherit' },
  );
  // A 1920px-wide copy small enough for social posts and GitHub attachments.
  const smallFile = outFile.replace(/\.mp4$/, '-web.mp4');
  execFileSync(
    FFMPEG,
    [
      '-y',
      '-loglevel',
      'error',
      '-i',
      outFile,
      '-vf',
      'scale=1920:-2:flags=lanczos',
      ...x264('21'),
      smallFile,
    ],
    { stdio: 'inherit' },
  );
  return { seconds: total / FPS, smallFile };
}

// ---------------------------------------------------------------------------
// Input: a moving cursor made of real mouse events, so hover states, clicks and
// the sidebar's pointer-based drag-and-drop all behave exactly as for a user.

function makeInput(cdp, vp) {
  const pos = { x: vp.width / 2, y: vp.height / 2 };
  const mouse = (type, extra = {}) =>
    cdp.send('Input.dispatchMouseEvent', { type, x: pos.x, y: pos.y, ...extra });
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  async function moveTo(x, y, ms = 700, { buttons = 0 } = {}) {
    // Progress follows the wall clock, so CDP round-trips don't stretch the move.
    const from = { ...pos };
    const start = Date.now();
    for (;;) {
      const t = Math.min(1, (Date.now() - start) / ms);
      const e = ease(t);
      pos.x = from.x + (x - from.x) * e;
      pos.y = from.y + (y - from.y) * e;
      await mouse('mouseMoved', buttons ? { buttons, button: 'left' } : {});
      if (t >= 1) return;
      await sleep(8);
    }
  }
  async function click(point, ms = 650) {
    await moveTo(point.x, point.y, ms);
    await sleep(120);
    await mouse('mousePressed', { button: 'left', buttons: 1, clickCount: 1 });
    await sleep(90);
    await mouse('mouseReleased', { button: 'left', buttons: 0, clickCount: 1 });
  }
  async function drag(from, to, ms = 1100) {
    await moveTo(from.x, from.y, 650);
    await sleep(150);
    await mouse('mousePressed', { button: 'left', buttons: 1, clickCount: 1 });
    await sleep(120);
    await moveTo(from.x + 14, from.y - 6, 120, { buttons: 1 });
    await moveTo(to.x, to.y, ms, { buttons: 1 });
    await sleep(350);
    await mouse('mouseReleased', { button: 'left', buttons: 0, clickCount: 1 });
  }
  async function wheel(point, deltaY, ms = 800) {
    await moveTo(point.x, point.y, 400);
    const start = Date.now();
    let sent = 0;
    for (;;) {
      const t = Math.min(1, (Date.now() - start) / ms);
      const target = Math.round(deltaY * ease(t));
      if (target !== sent) await mouse('mouseWheel', { deltaX: 0, deltaY: target - sent });
      sent = target;
      if (t >= 1) return;
      await sleep(12);
    }
  }
  async function type(text, perChar = 75) {
    for (const ch of text) {
      await cdp.send('Input.insertText', { text: ch });
      await sleep(perChar + Math.random() * 40);
    }
  }
  async function key(keyName, code, keyCode, modifiers = 0) {
    const base = { key: keyName, code, windowsVirtualKeyCode: keyCode, modifiers };
    await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  }
  return { pos, moveTo, click, drag, wheel, type, key };
}

// ---------------------------------------------------------------------------

async function main() {
  const manifest = seed();
  const assignments = Object.fromEntries(
    Object.entries(manifest.groups.assignments).filter(([, g]) => VIDEO_GROUPS.includes(g)),
  );
  const videoManifest = {
    ...manifest,
    groups: {
      groups: manifest.groups.groups.filter((g) => VIDEO_GROUPS.includes(g.id)),
      assignments,
    },
  };
  const id = (key) => manifest.sessionIds[key];
  const child = launch(manifest, { port: PORT });
  let cdp;
  try {
    cdp = await connect(PORT);
    const vp = await setUpDemo(cdp, videoManifest);
    // Scene positions are fractions of the screen so any display size works.
    const P = (fx, fy) => ({ x: vp.width * fx, y: vp.height * fy });
    const run = (js, timeoutMs) => cdp.evaluate(HELPERS + js, timeoutMs);
    // Centre of the first visible element matching a selector (or a JS expression
    // returning an element), optionally offset within its box.
    const at = async (selector, { fx = 0.5, fy = 0.5, expr = false } = {}) => {
      const point = await run(`
        const el = ${expr ? selector : `[...document.querySelectorAll(${JSON.stringify(selector)})].find(e => e.getBoundingClientRect().height > 0)`};
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return { x: b.left + b.width * ${fx}, y: b.top + b.height * ${fy} };`);
      if (!point) throw new Error(`No visible element for ${selector}`);
      return point;
    };
    const caption = (html) => run(`__sb.caption(${JSON.stringify(html)})`);
    const input = makeInput(cdp, vp);

    await run(`
      localStorage.removeItem('collapsedGridGroups');
      localStorage.removeItem('collapsedGroups');
      if (sidebarViewMode === 'folder') click('#view-mode-toggle');
      await gridFilter('all');
      focusGridCard(${JSON.stringify(id('sf-checkout'))});
      await wait(600);
      scrollTop();
      ${OVERLAY}
      __sb.card(${JSON.stringify(INTRO_CARD)});
      await wait(900);`);
    await input.moveTo(vp.width * 0.61, vp.height * 0.57, 1);

    const framesDir = path.join(manifest.demoDir, 'frames');
    const recorder = startRecorder(cdp, framesDir, vp);
    await recorder.started;
    await sleep(2600);

    // 1. The grid.
    await run(`__sb.hideCard()`);
    await sleep(700);
    await caption('Every agent. <em>Live.</em> One grid.');
    await input.moveTo(vp.width * 0.78, vp.height * 0.35, 1300);
    await input.moveTo(vp.width * 0.47, vp.height * 0.67, 1200);
    await input.wheel(P(0.57, 0.59), 520, 1100);
    await sleep(900);
    await input.wheel(P(0.57, 0.59), -520, 900);
    await sleep(400);

    // 2. Approve a waiting plan straight from its card.
    await caption('Approve agents <em>without switching tabs</em>');
    const approve = `[...document.querySelectorAll('.grid-card[data-session-id="${id('pay-idem')}"] .quick-actions-bar button')].find(b => /approve/i.test(b.textContent))`;
    await input.click(await at(approve, { expr: true }), 1000);
    await sleep(2200);

    // 3. Folder-first sidebar.
    await caption('Folders, <em>first-class</em>');
    await input.click(await at('#view-mode-toggle'), 900);
    await sleep(900);
    const scrollBy = await run(`
      const list = $('#sidebar-content');
      const folder = list.querySelector('.user-group');
      return Math.round(folder.getBoundingClientRect().top - list.getBoundingClientRect().top - 6);`);
    await input.wheel({ x: 170, y: vp.height * 0.59 }, scrollBy, 900);
    await sleep(500);
    for (const g of VIDEO_GROUPS) {
      await input.click(
        await at(`#sidebar-content .user-group[data-group-id="${g}"] > .user-group-header`, {
          fx: 0.4,
        }),
        600,
      );
      await sleep(450);
    }
    await sleep(500);

    // 4. Create a folder from a session's folder button.
    await caption('Create a folder <em>in seconds</em>');
    const row = (key) => `#sidebar-content .session-item[data-session-id="${id(key)}"]`;
    await input.moveTo(...Object.values(await at(row('ds-tokens'), { fx: 0.5 })), 900);
    await sleep(350);
    await input.click(await at(`${row('ds-tokens')} .session-group-btn`), 450);
    await sleep(600);
    await input.click(await at('.group-assign-popover .group-assign-new'), 550);
    await sleep(700);
    await run(`const i = $('.group-editor-name'); i.focus(); i.select();`);
    await input.type(NEW_FOLDER.name, 85);
    await sleep(300);
    await input.click(await at(`.group-editor-swatch[title="${NEW_FOLDER.color}"]`), 650);
    await sleep(450);
    await input.click(await at('.group-editor-dialog .control-dialog-confirm'), 600);
    await sleep(1200);
    const newGroupId = await run(
      `return groupsState.groups.find(g => g.name === ${JSON.stringify(NEW_FOLDER.name)}).id`,
    );
    const folder = `#sidebar-content .user-group[data-group-id="${newGroupId}"] > .user-group-header`;

    // 5. Drag sessions into it.
    await caption('Drag and drop <em>to organise</em>');
    for (const key of ['mobile-rn', 'docs-webhooks']) {
      // Grab the row by its metadata line: the summary text and buttons don't start drags.
      const grab = await at(row(key), { fx: 0.62, fy: 0.86 });
      await input.drag(grab, await at(folder, { fx: 0.45 }), 1150);
      await sleep(1000);
    }
    await caption('Your grid <em>follows along</em>');
    const regionTop = await run(`
      const v = $('#grid-viewer');
      const region = [...document.querySelectorAll('.grid-region')].find(r => r.dataset.collapseKey === ${JSON.stringify(newGroupId)});
      return Math.round(region.getBoundingClientRect().top - v.getBoundingClientRect().top - 50);`);
    await input.wheel(P(0.6, 0.55), regionTop, 1400);
    await sleep(2200);
    await input.wheel(P(0.6, 0.55), -regionTop, 1000);
    await sleep(300);

    // 6. Spring cleaning, with confetti.
    await caption('Spring clean <em>in one click</em>');
    await input.click(await at('#spring-cleaning-btn'), 900);
    await sleep(1600);
    const ages = `[...document.querySelectorAll('.spring-cleaning-age-btn')].pop()`;
    await input.moveTo(...Object.values(await at(ages, { expr: true })), 700);
    await sleep(400);
    const archive = await at('.spring-cleaning-archive-btn');
    const archived = await run(
      `return $('.spring-cleaning-archive-btn').textContent.match(/\\d+/)?.[0] || ''`,
    );
    await input.click(archive, 900);
    await run(`__sb.confetti([
      { x: ${archive.x}, y: ${archive.y}, count: 260, angle: -Math.PI / 2, spread: 2.2, speed: 27 },
      { x: 0, y: innerHeight, count: 200, angle: -Math.PI / 3.2, spread: 0.8, speed: 38 },
      { x: innerWidth, y: innerHeight, count: 200, angle: -Math.PI + Math.PI / 3.2, spread: 0.8, speed: 38 },
    ])`);
    await caption(`${archived} stale sessions <em>swept away</em>`);
    await input.moveTo(vp.width * 0.65, vp.height * 0.5, 1200);
    await sleep(2600);

    // 7. Command palette.
    await caption('Jump anywhere with <em>⌘K</em>');
    await sleep(500);
    await input.key('k', 'KeyK', 75, 4);
    await sleep(400);
    await run(
      `if (!document.querySelector('.command-palette-input, .command-palette input')) openCommandPalette();`,
    );
    await sleep(300);
    await input.type('pay', 140);
    await sleep(1500);
    await input.key('ArrowDown', 'ArrowDown', 40);
    await sleep(350);
    await input.key('ArrowDown', 'ArrowDown', 40);
    await sleep(900);
    await input.key('Escape', 'Escape', 27);
    await sleep(300);

    // 8. Stats.
    await caption('See your usage <em>at a glance</em>');
    await input.click(await at('#sidebar-tabs .sidebar-tab[data-tab="stats"]'), 800);
    await run(`
      for (let i = 0; i < 40 && $('.stats-spinner'); i++) await wait(100);
      buildUsageSection(${JSON.stringify(DEMO_USAGE)});`);
    await input.moveTo(vp.width * 0.4, vp.height * 0.3, 1400);
    await sleep(1600);

    // Outro.
    await run(`__sb.hideCaption(); __sb.card(${JSON.stringify(OUTRO_CARD)});`);
    await sleep(3800);

    const recording = await recorder.stop();
    console.log(`captured ${recording.frames.length} frames, encoding…`);
    const { seconds, smallFile } = encode(recording, framesDir, OUT_FILE);
    console.log(
      `saved ${path.relative(process.cwd(), OUT_FILE)} (${seconds.toFixed(1)}s @ ${FPS}fps)`,
    );
    console.log(`saved ${path.relative(process.cwd(), smallFile)}`);
    fs.rmSync(framesDir, { recursive: true, force: true });
  } finally {
    cdp?.close();
    child.kill('SIGTERM');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
