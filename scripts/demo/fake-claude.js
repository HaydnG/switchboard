#!/usr/bin/env node
// Scripted stand-in for the `claude` CLI, used only by the demo/screenshot
// harness. It draws a Claude Code-style terminal UI and emits the same
// window-title and OSC 9 signals Switchboard uses to derive session status.
const fs = require('fs');
const path = require('path');
const os = require('os');

const args = process.argv.slice(2);
if (args[0] && args[0].startsWith('/')) {
  // One-shot slash commands (Switchboard runs `claude "/stats"` to refresh stats).
  process.stdout.write('Current streak: 12 days · Longest streak: 31 days\r\n');
  process.exit(0);
}
const flagValue = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
};
const sessionId = flagValue('--resume') || flagValue('--session-id') || '';

let scenarios = {};
try {
  scenarios = JSON.parse(
    fs.readFileSync(path.join(os.homedir(), '.demo', 'scenarios.json'), 'utf8'),
  );
} catch {}
const scenario = scenarios[sessionId] || {
  mode: 'idle',
  transcript: [{ k: 'say', t: 'Ready when you are.' }],
};

const ESC = '\x1b[';
const c = {
  reset: `${ESC}0m`,
  bold: `${ESC}1m`,
  dim: `${ESC}2m`,
  italic: `${ESC}3m`,
  orange: `${ESC}38;2;215;119;87m`,
  green: `${ESC}38;2;78;186;101m`,
  red: `${ESC}38;2;255;107;128m`,
  blue: `${ESC}38;2;120;170;255m`,
  grey: `${ESC}38;2;153;153;153m`,
  white: `${ESC}38;2;235;235;235m`,
  addBg: `${ESC}48;2;34;92;43m`,
  delBg: `${ESC}48;2;122;41;54m`,
};

const cwd = process.cwd().replace(os.homedir(), '~');
const spinnerGlyphs = ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢'];
const brailleGlyphs = ['⠂', '⠐', '⠠', '⠄'];

const state = {
  mode: scenario.mode,
  transcript: [...(scenario.transcript || [])],
  verb: scenario.verb || 'Working',
  elapsed: scenario.elapsed || 12,
  tokens: scenario.tokens || 1.2,
  input: '',
  frame: 0,
};

function visibleLength(text) {
  return text.replace(/\x1b\[[0-9;]*m/g, '').length;
}

function clip(text, max) {
  let out = '';
  let visible = 0;
  for (const part of text.split(/(\x1b\[[0-9;]*m)/)) {
    if (part.startsWith('\x1b[')) {
      out += part;
      continue;
    }
    for (const ch of part) {
      if (visible >= max) return out;
      out += ch;
      visible += 1;
    }
  }
  return out;
}

function wrap(text, width) {
  const out = [];
  for (const paragraph of String(text).split('\n')) {
    let line = '';
    for (const word of paragraph.split(' ')) {
      if (line && (line + ' ' + word).length > width) {
        out.push(line);
        line = word;
      } else {
        line = line ? line + ' ' + word : word;
      }
    }
    out.push(line);
  }
  return out;
}

function box(lines, width, color = c.grey) {
  const inner = Math.max(10, width - 4);
  const rows = [`${color}╭${'─'.repeat(inner + 2)}╮${c.reset}`];
  for (const line of lines) {
    const pad = Math.max(0, inner - visibleLength(line));
    rows.push(`${color}│${c.reset} ${line}${' '.repeat(pad)} ${color}│${c.reset}`);
  }
  rows.push(`${color}╰${'─'.repeat(inner + 2)}╯${c.reset}`);
  return rows;
}

function renderItem(item, width) {
  const body = Math.max(20, width - 4);
  const lines = [];
  switch (item.k) {
    case 'user':
      for (const [i, line] of wrap(item.t, body).entries()) {
        lines.push(`${c.grey}${i === 0 ? '>' : ' '} ${line}${c.reset}`);
      }
      break;
    case 'say':
      for (const [i, line] of wrap(item.t, body).entries()) {
        lines.push(`${i === 0 ? `${c.white}⏺${c.reset}` : ' '} ${line}`);
      }
      break;
    case 'tool': {
      lines.push(`${c.green}⏺${c.reset} ${c.bold}${item.name}${c.reset}(${item.arg})`);
      for (const [i, out] of (item.out || []).entries()) {
        lines.push(`${c.grey}  ${i === 0 ? '⎿' : ' '}  ${out}${c.reset}`);
      }
      break;
    }
    case 'diff':
      for (const [sign, num, code] of item.lines) {
        const bg = sign === '+' ? c.addBg : sign === '-' ? c.delBg : '';
        const text = `${String(num).padStart(6)} ${sign} ${code}`;
        const pad = Math.max(0, body - text.length - 1);
        lines.push(`     ${bg}${text}${' '.repeat(pad)}${c.reset}`);
      }
      break;
    case 'todo':
      lines.push(`${c.green}⏺${c.reset} ${c.bold}Update Todos${c.reset}`);
      for (const [i, [done, text]] of item.items.entries()) {
        const mark = done ? `${c.green}☒${c.reset} ${c.dim}${text}${c.reset}` : `☐ ${text}`;
        lines.push(`${c.grey}  ${i === 0 ? '⎿' : ' '}  ${c.reset}${mark}`);
      }
      break;
    default:
      lines.push(String(item.t || ''));
  }
  lines.push('');
  return lines;
}

function renderPrompt(width) {
  const inner = width - 4;
  if (state.mode === 'permission') {
    const p = scenario.permission;
    return box(
      [
        `${c.bold}${p.title}${c.reset}`,
        '',
        ...wrap(p.command, inner - 4).map((line) => `  ${line}`),
        ...wrap(p.description, inner - 4).map((line) => `  ${c.grey}${line}${c.reset}`),
        '',
        'Do you want to proceed?',
        `${c.blue}❯ 1. Yes${c.reset}`,
        `  2. Yes, and don't ask again for ${p.tool} commands in ${cwd}`.slice(0, inner),
        '  3. No, and tell Claude what to do differently (esc)',
      ],
      width,
      c.blue,
    );
  }
  if (state.mode === 'plan') {
    const plan = scenario.plan;
    return box(
      [
        `${c.bold}Ready to code?${c.reset}`,
        '',
        "Here is Claude's plan:",
        ...plan.steps.flatMap((step, i) =>
          wrap(step, inner - 6).map((line, j) => `${j === 0 ? `  ${i + 1}. ` : '     '}${line}`),
        ),
        '',
        'Would you like to proceed?',
        `${c.blue}❯ 1. Yes, and auto-accept edits${c.reset}`,
        '  2. Yes, and manually approve edits',
        '  3. No, keep planning',
      ],
      width,
      c.blue,
    );
  }
  const rows = box([`> ${state.input}${c.dim}█${c.reset}`], width);
  const hint = scenario.footer || '? for shortcuts';
  rows.push(`  ${c.grey}${hint}${c.reset}`);
  return rows;
}

function header(width) {
  return box(
    [
      `${c.orange}✻${c.reset} Welcome to ${c.bold}Claude Code${c.reset}!`,
      '',
      `  ${c.grey}${c.italic}/help for help, /status for your current setup${c.reset}`,
      '',
      `  ${c.grey}cwd: ${cwd}${c.reset}`,
    ],
    Math.min(width, 60),
    c.orange,
  );
}

function draw() {
  const width = Math.max(30, (process.stdout.columns || 100) - 1);
  const height = Math.max(10, process.stdout.rows || 30);
  const lines = [...header(width), ''];
  for (const item of state.transcript) lines.push(...renderItem(item, width));
  if (state.mode === 'working') {
    const glyph = spinnerGlyphs[state.frame % spinnerGlyphs.length];
    const secs = Math.floor(state.elapsed + state.frame * 0.12);
    const time = secs >= 60 ? `${Math.floor(secs / 60)}m ${secs % 60}s` : `${secs}s`;
    const tokens = (state.tokens + state.frame * 0.004).toFixed(1);
    lines.push(
      `${c.orange}${glyph} ${state.verb}…${c.reset} ${c.grey}(${time} · ↓ ${tokens}k tokens · esc to interrupt)${c.reset}`,
      '',
    );
  }
  lines.push(...renderPrompt(width));
  const visible = lines.slice(-height);
  // Address every row absolutely and clip to the width so a long or wide-glyph
  // line can never wrap and scroll the screen into xterm's scrollback.
  let out = `${ESC}?25l`;
  for (let i = 0; i < height; i++) {
    out += `${ESC}${i + 1};1H${clip(visible[i] ?? '', width)}${c.reset}${ESC}K`;
  }
  process.stdout.write(out);
}

function setTitle(title) {
  process.stdout.write(`\x1b]0;${title}\x07`);
}

function notify(message) {
  process.stdout.write(`\x1b]9;${message}\x07`);
}

function enterIdle() {
  state.mode = 'idle';
  setTitle(`✳ ${scenario.title || 'Claude Code'}`);
  draw();
}

function startWorking(verb) {
  state.mode = 'working';
  if (verb) state.verb = verb;
  state.frame = 0;
  state.elapsed = 1;
  state.tokens = 0.1;
}

let ticker = null;
function tick() {
  state.frame += 1;
  if (state.mode === 'working') {
    setTitle(
      `${brailleGlyphs[state.frame % brailleGlyphs.length]} ${scenario.title || state.verb}`,
    );
    draw();
  } else if (state.frame % 4 === 0) {
    draw();
  }
  if ((state.mode === 'permission' || state.mode === 'plan') && state.frame % 50 === 0)
    notifyPrompt();
}

function notifyPrompt() {
  notify(
    state.mode === 'plan'
      ? 'Claude needs your approval for the plan'
      : `Claude needs your permission to use ${scenario.permission.tool}`,
  );
}

// Avoid ESC[2J: xterm.js scrolls the cleared screen into scrollback, which
// leaves blank pages above the UI in grid cards that preserve scroll position.
function redrawAfterResize() {
  process.stdout.write(`${ESC}3J`);
  draw();
}

function onInput(chunk) {
  const text = chunk.toString('utf8');
  if (state.mode === 'permission' || state.mode === 'plan') {
    if (text.includes('3') || text === '\x1b') {
      state.transcript.push({ k: 'user', t: 'No — let me take a look first.' });
      enterIdle();
      return;
    }
    if (/[12\r]/.test(text)) {
      state.transcript.push({ k: 'say', t: scenario.onApprove || 'Approved. Continuing.' });
      startWorking(scenario.approveVerb || 'Continuing');
      draw();
    }
    return;
  }
  for (const ch of text) {
    if (ch === '\r' || ch === '\n') {
      if (state.input.trim()) {
        state.transcript.push({ k: 'user', t: state.input.trim() });
        state.input = '';
        startWorking('Thinking');
      }
    } else if (ch === '\x7f') {
      state.input = state.input.slice(0, -1);
    } else if (ch >= ' ' && !text.startsWith('\x1b')) {
      state.input += ch;
    }
  }
  draw();
}

function start() {
  process.stdout.write(`${ESC}H${ESC}J${ESC}3J`);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.on('data', onInput);
  process.stdout.on('resize', redrawAfterResize);
  ticker = setInterval(tick, 120);

  const mode = scenario.mode;
  if (mode === 'working') {
    state.mode = 'working';
    tick();
  } else if (mode === 'ready') {
    state.mode = 'working';
    tick();
    setTimeout(() => {
      state.transcript.push(...(scenario.finale || []));
      enterIdle();
    }, scenario.readyAfterMs || 2500);
  } else if (mode === 'permission' || mode === 'plan') {
    state.mode = 'working';
    tick();
    setTimeout(() => {
      state.mode = mode;
      setTitle(`✳ ${scenario.title || 'Claude Code'}`);
      draw();
      notifyPrompt();
    }, scenario.promptAfterMs || 1800);
  } else {
    enterIdle();
  }
}

process.on('SIGTERM', () => {
  clearInterval(ticker);
  process.exit(0);
});
process.on('SIGHUP', () => process.exit(0));

start();
