// Builds a throwaway HOME full of dummy projects, Claude session transcripts and
// a scripted `claude` binary so Switchboard can be demoed and screenshotted
// without touching real data. Usage: node scripts/demo/seed.js [demoHome]
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { encodeProjectPath } = require('../../encode-project-path');
const { groups, projects } = require('./fixtures');

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

function uuidFor(key) {
  const hex = crypto
    .createHash('sha1')
    .update('switchboard-demo:' + key)
    .digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function git(cwd, ...args) {
  execFileSync('git', args, {
    cwd,
    stdio: 'ignore',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Demo',
      GIT_AUTHOR_EMAIL: 'demo@example.com',
      GIT_COMMITTER_NAME: 'Demo',
      GIT_COMMITTER_EMAIL: 'demo@example.com',
    },
  });
}

function writeFiles(dir, files) {
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
}

function seedRepo(projectDir, project) {
  fs.mkdirSync(projectDir, { recursive: true });
  git(projectDir, 'init', '-q', '-b', 'main');
  writeFiles(projectDir, project.files);
  git(projectDir, 'add', '-A');
  git(projectDir, 'commit', '-q', '-m', 'Initial commit');
  if (project.branch && project.branch !== 'main')
    git(projectDir, 'checkout', '-q', '-b', project.branch);
  writeFiles(projectDir, project.dirty || {});
}

function buildTranscript(session, projectDir, branch, now) {
  const id = session.id;
  const endAt = now - (session.ageMinutes || 0) * MINUTE;
  const turns = session.turns || 3;
  const spanMs = (session.activeMinutes || turns * 4) * MINUTE;
  const cacheReadPerTurn = Math.round((session.cacheReadTokens || turns * 90_000) / turns);
  const lines = [];
  let parentUuid = null;
  const push = (entry) => {
    const uuid = crypto.randomUUID();
    lines.push(
      JSON.stringify({
        parentUuid,
        uuid,
        sessionId: id,
        cwd: projectDir,
        gitBranch: branch,
        version: '2.1.62',
        ...entry,
      }),
    );
    parentUuid = uuid;
  };
  if (session.slug)
    lines.push(JSON.stringify({ type: 'summary', slug: session.slug, sessionId: id }));
  const prompts = [session.prompt, ...(session.followUps || [])];
  for (let i = 0; i < turns; i++) {
    const at = endAt - spanMs + (spanMs * i) / Math.max(1, turns - 1 || 1);
    const prompt =
      prompts[i] ||
      prompts[prompts.length - 1 - (i % Math.max(1, prompts.length - 1))] ||
      'continue';
    push({
      type: 'user',
      timestamp: new Date(at).toISOString(),
      message: { role: 'user', content: prompt },
    });
    push({
      type: 'assistant',
      timestamp: new Date(at + 40_000).toISOString(),
      message: {
        role: 'assistant',
        model: 'claude-opus-4-6',
        content: [{ type: 'text', text: session.reply || 'Done — changes are ready for review.' }],
        usage: {
          input_tokens: 1200,
          output_tokens: 900,
          cache_creation_input_tokens: 4000,
          cache_read_input_tokens: cacheReadPerTurn,
        },
      },
    });
    for (let extra = 0; extra < (session.toolEntriesPerTurn || 0); extra++) {
      push({
        type: 'assistant',
        timestamp: new Date(at + 45_000 + extra * 1000).toISOString(),
        message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Read', input: {} }] },
      });
    }
  }
  if (session.customTitle) {
    lines.push(
      JSON.stringify({ type: 'custom-title', customTitle: session.customTitle, sessionId: id }),
    );
  }
  return { body: lines.join('\n') + '\n', endAt };
}

function buildStats(now) {
  const dailyActivity = [];
  const dailyModelTokens = [];
  let totalMessages = 0;
  for (let i = 364; i >= 0; i--) {
    const date = new Date(now - i * DAY);
    const weekday = date.getDay();
    const wave = Math.sin(i / 9) * 0.5 + 0.5;
    const busy = weekday === 0 || weekday === 6 ? 0.25 : 1;
    const skip = (i * 7919) % 11 === 0;
    const messageCount = skip
      ? 0
      : Math.round((40 + wave * 320) * busy * (0.6 + ((i * 37) % 10) / 10));
    const key = date.toISOString().slice(0, 10);
    totalMessages += messageCount;
    dailyActivity.push({
      date: key,
      messageCount,
      sessionCount: Math.ceil(messageCount / 45),
      toolCallCount: messageCount * 2,
    });
    dailyModelTokens.push({
      date: key,
      tokensByModel: {
        'claude-opus-4-6': messageCount * 2600,
        'claude-sonnet-4-6': messageCount * 900,
      },
    });
  }
  return {
    version: 1,
    lastComputedDate: new Date(now).toISOString().slice(0, 10),
    dailyActivity,
    dailyModelTokens,
    totalSessions: 1284,
    totalMessages,
    modelUsage: {
      'claude-opus-4-6': { inputTokens: 48_200_000, outputTokens: 9_400_000 },
      'claude-sonnet-4-6': { inputTokens: 17_900_000, outputTokens: 3_100_000 },
    },
  };
}

// The demo HOME path shows up in the UI (palette, file panel), so keep it short.
const DEFAULT_DEMO_HOME =
  process.platform === 'darwin' ? '/Users/Shared/demo' : path.join(os.tmpdir(), 'switchboard-demo');

function resetDemoHome(home) {
  if (fs.existsSync(home)) {
    if (!fs.existsSync(path.join(home, '.demo', 'manifest.json'))) {
      throw new Error(`${home} exists and is not a Switchboard demo home; refusing to delete it`);
    }
    fs.rmSync(home, { recursive: true, force: true });
  }
  fs.mkdirSync(home, { recursive: true });
}

function seed(demoHome = DEFAULT_DEMO_HOME) {
  const home = path.resolve(demoHome);
  resetDemoHome(home);

  const now = Date.now();
  const claudeDir = path.join(home, '.claude');
  const demoDir = path.join(home, '.demo');
  const binDir = path.join(demoDir, 'bin');
  fs.mkdirSync(binDir, { recursive: true });

  const fakeClaude = path.join(__dirname, 'fake-claude.js');
  fs.writeFileSync(
    path.join(binDir, 'claude'),
    `#!/bin/sh\nexec "${process.execPath}" "${fakeClaude}" "$@"\n`,
    { mode: 0o755 },
  );
  fs.writeFileSync(
    path.join(home, '.zshrc'),
    [
      `export PATH="${binDir}:$PATH"`,
      "PROMPT='%F{cyan}%~%f %F{green}❯%f '",
      'unsetopt PROMPT_SP',
      '',
    ].join('\n'),
  );
  fs.writeFileSync(path.join(home, '.bashrc'), `export PATH="${binDir}:$PATH"\n`);

  const scenarios = {};
  const sessionIds = {};
  const liveSessionIds = [];
  const assignments = {};
  const starred = [];

  for (const project of projects) {
    const projectDir = path.join(home, 'dev', project.name);
    seedRepo(projectDir, project);
    const folder = path.join(claudeDir, 'projects', encodeProjectPath(projectDir));
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(
      path.join(folder, 'CLAUDE.md'),
      project.memory || `# ${project.name}\n\nProject notes for Claude.\n`,
    );

    for (const session of project.sessions) {
      session.id = uuidFor(session.key);
      sessionIds[session.key] = session.id;
      const { body, endAt } = buildTranscript(session, projectDir, project.branch || 'main', now);
      const file = path.join(folder, session.id + '.jsonl');
      fs.writeFileSync(file, body);
      fs.utimesSync(file, new Date(endAt), new Date(endAt));
      if (session.scenario) {
        scenarios[session.id] = session.scenario;
        liveSessionIds.push(session.id);
      }
      if (session.group) assignments[session.id] = session.group;
      if (session.starred) starred.push(session.id);
    }
  }

  fs.writeFileSync(path.join(demoDir, 'scenarios.json'), JSON.stringify(scenarios, null, 2));
  fs.writeFileSync(path.join(claudeDir, 'stats-cache.json'), JSON.stringify(buildStats(now)));
  fs.writeFileSync(
    path.join(claudeDir, 'CLAUDE.md'),
    '# Global preferences\n\n- Prefer small, reviewable commits.\n- Run the test suite before declaring a task done.\n- Ask before running migrations against shared environments.\n',
  );
  fs.mkdirSync(path.join(claudeDir, 'plans'), { recursive: true });
  fs.writeFileSync(
    path.join(claudeDir, 'plans', 'refund-idempotency.md'),
    '# Refund idempotency\n\n1. Add `Idempotency-Key` header parsing middleware\n2. Persist keys in `refund_requests` with a unique index\n3. Replay the stored response on duplicate keys\n4. Table-driven tests for retries and conflicting payloads\n',
  );

  const manifest = {
    home,
    demoDir,
    dataDir: path.join(demoDir, 'data'),
    userDataDir: path.join(demoDir, 'userData'),
    sessionIds,
    liveSessionIds,
    starred,
    groups: { groups, assignments },
  };
  fs.writeFileSync(path.join(demoDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}

module.exports = { seed, DEFAULT_DEMO_HOME };

if (require.main === module) {
  const manifest = seed(process.argv[2]);
  console.log(
    `Seeded demo HOME at ${manifest.home} (${Object.keys(manifest.sessionIds).length} sessions)`,
  );
}
