// Git-aware session cards: polls `get-git-summary` for the working directory of
// every session with a live PTY (worktree sessions have their own projectPath,
// so parallel agents on one repo read independently), parses via the pure
// git-summary module, and paints a branch/+/− chip on grid card headers.
// Clicking the chip lists the changed files.

const gitSummaryCache = new Map(); // projectPath → { at, summary, files }
let gitPollTimer = null;
const GIT_POLL_INTERVAL_MS = 20000;

function gitPathsToPoll() {
  const paths = new Map(); // projectPath → sample sessionId
  for (const sid of activePtyIds) {
    const session = sessionMap.get(sid) || openSessions.get(sid)?.session;
    const path = session?.projectPath;
    if (path && !paths.has(path)) paths.set(path, sid);
  }
  return paths;
}

async function refreshGitSummaries() {
  if (document.hidden || !windowFocused) return;
  const paths = gitPathsToPoll();
  const now = Date.now();
  const jobs = [];
  for (const [path] of paths) {
    const cached = gitSummaryCache.get(path);
    if (!shouldPollGit({ hasLivePty: true, lastPollAt: cached?.at ?? null, now, minIntervalMs: GIT_POLL_INTERVAL_MS })) continue;
    // Stamp before the fetch so overlapping refresh calls don't double-poll.
    gitSummaryCache.set(path, { ...(cached || {}), at: now });
    jobs.push(
      window.api.getGitSummary(path).then((res) => {
        if (!res || !res.ok) {
          gitSummaryCache.set(path, { at: now, summary: null, files: [] });
          return;
        }
        const status = parseGitStatusPorcelain(res.status || '');
        const numstat = parseDiffNumstat(res.numstat || '');
        const summary = summarizeGitState({ branch: res.branch, status, numstat });
        const files = gitChangedFilesFromPorcelain(res.status || '');
        gitSummaryCache.set(path, { at: now, summary, files });
      }).catch(() => {
        gitSummaryCache.set(path, { at: now, summary: null, files: [] });
      })
    );
  }
  if (jobs.length > 0) {
    await Promise.all(jobs);
    if (typeof updateGridCardStatuses === 'function') updateGridCardStatuses();
    if (typeof publishSessionOverview === 'function') publishSessionOverview();
  }
}

// File paths out of porcelain output (NUL- or newline-separated), for the
// changed-files dialog. Rename entries keep the new path.
function gitChangedFilesFromPorcelain(text) {
  if (!text) return [];
  const sep = text.includes('\0') ? '\0' : '\n';
  const files = [];
  const entries = text.split(sep);
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry || entry.length < 4) continue;
    const xy = entry.slice(0, 2);
    let file = entry.slice(3);
    if (sep === '\0' && (xy[0] === 'R' || xy[0] === 'C')) i++; // skip paired old path
    if (sep === '\n' && file.includes(' -> ')) file = file.split(' -> ').pop();
    files.push({ xy, file });
  }
  return files;
}

function getGitSummaryForSession(sessionId) {
  const session = sessionMap.get(sessionId) || openSessions.get(sessionId)?.session;
  const path = session?.projectPath;
  if (!path) return null;
  return gitSummaryCache.get(path)?.summary || null;
}

// Paint (or remove) the git chip on a grid card header. Called from
// updateGridCardStatuses on every status tick — reads the cache only.
function updateGridCardGitChip(sessionId, card) {
  const summary = getGitSummaryForSession(sessionId);
  let chip = card.querySelector('.grid-card-git-chip');
  if (!summary) {
    if (chip) chip.remove();
    return;
  }
  if (!chip) {
    chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip grid-card-git-chip';
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      showGitChangedFilesDialog(sessionId);
    });
    chip.addEventListener('mousedown', (e) => e.stopPropagation());
    chip.addEventListener('pointerdown', (e) => e.stopPropagation());
    const project = card.querySelector('.grid-card-project');
    if (project) project.before(chip);
    else card.querySelector('.grid-card-header')?.appendChild(chip);
  }
  if (chip.textContent !== summary.label) chip.textContent = summary.label;
  chip.title = summary.detail;
  chip.setAttribute('aria-label', `Git: ${summary.label} — ${summary.detail}`);
  chip.classList.toggle('git-dirty', summary.level === 'dirty');
  chip.classList.toggle('git-conflict', summary.level === 'conflict');
}

async function showGitChangedFilesDialog(sessionId) {
  const session = sessionMap.get(sessionId) || openSessions.get(sessionId)?.session;
  const path = session?.projectPath;
  const cached = path ? gitSummaryCache.get(path) : null;
  if (!cached?.summary) return;
  const files = cached.files || [];
  await showControlMessage({
    title: `Git — ${cached.summary.label}`,
    message: files.length === 0
      ? 'Working tree is clean.'
      : `${cached.summary.detail}${files.length > 20 ? ` (showing first 20 of ${files.length})` : ''}`,
    details: files.length === 0 ? undefined : Object.fromEntries(
      files.slice(0, 20).map(({ xy, file }) => [file, xy.trim() || 'untracked'])
    ),
  });
}

function startGitPolling() {
  if (gitPollTimer) return;
  gitPollTimer = setInterval(refreshGitSummaries, GIT_POLL_INTERVAL_MS / 2);
  window.addEventListener('focus', refreshGitSummaries);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshGitSummaries();
  });
  refreshGitSummaries();
}
