(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    Object.assign(root, factory());
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const MINUS = '\u2212';

  /**
   * Parse `git status --porcelain=v1` output (NUL- or newline-separated) into dirty-state counts.
   * Rename records ("R  old -> new" text form, or the NUL-paired "from" field in -z form) count once.
   * @param {string} text
   * @returns {{staged: number, unstaged: number, untracked: number, conflicted: number, dirtyFiles: number}}
   */
  function parseGitStatusPorcelain(text) {
    const result = { staged: 0, unstaged: 0, untracked: 0, conflicted: 0, dirtyFiles: 0 };
    if (!text) return result;

    const zMode = text.indexOf('\0') !== -1;
    const entries = text.split(zMode ? '\0' : '\n');

    for (let i = 0; i < entries.length; i++) {
      const entry = zMode ? entries[i] : entries[i].replace(/\r$/, '');
      if (!entry) continue;

      const x = entry[0];
      const y = entry[1];
      result.dirtyFiles++;

      if (x === '?' && y === '?') {
        result.untracked++;
      } else if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) {
        result.conflicted++;
      } else {
        if (x !== ' ' && x !== '?') result.staged++;
        if (y !== ' ' && y !== '?') result.unstaged++;
      }

      // -z mode emits renames/copies as two NUL fields: "XY new" then a bare "old"
      // path with no status code. Consume that paired field so it isn't double-counted.
      if (zMode && (x === 'R' || x === 'C')) i++;
    }

    return result;
  }

  /**
   * Parse `git diff --numstat` output into insertion/deletion/file totals. Binary files
   * report '-' for both columns and count 0 lines but still count as a file.
   * @param {string} text
   * @returns {{insertions: number, deletions: number, files: number}}
   */
  function parseDiffNumstat(text) {
    const result = { insertions: 0, deletions: 0, files: 0 };
    if (!text) return result;

    for (const rawLine of text.split('\n')) {
      const line = rawLine.replace(/\r$/, '').trim();
      if (!line) continue;

      const [insField, delField] = line.split('\t');
      if (insField === undefined || delField === undefined) continue;

      result.insertions += insField === '-' ? 0 : parseInt(insField, 10) || 0;
      result.deletions += delField === '-' ? 0 : parseInt(delField, 10) || 0;
      result.files++;
    }

    return result;
  }

  /**
   * Build the chip model ({label, detail, level}) for a session's git state from
   * already-parsed status/numstat. Either input may be null (e.g. not a git repo yet).
   * @param {{branch: ?string, status: ?object, numstat: ?object}} state
   */
  function summarizeGitState({ branch, status, numstat }) {
    const branchLabel = branch && branch.trim() ? branch : 'detached';
    const dirtyFiles = status ? status.dirtyFiles : 0;
    const untracked = status ? status.untracked : 0;
    const conflicted = status ? status.conflicted : 0;
    const insertions = numstat ? numstat.insertions : 0;
    const deletions = numstat ? numstat.deletions : 0;

    if (dirtyFiles === 0 && insertions === 0 && deletions === 0) {
      return { label: branchLabel, detail: 'clean', level: 'clean' };
    }

    const label = numstat ? `${branchLabel} +${insertions} ${MINUS}${deletions}` : branchLabel;

    const changedFiles = numstat ? numstat.files : Math.max(dirtyFiles - untracked - conflicted, 0);
    const detailParts = [];
    if (changedFiles > 0) detailParts.push(`${changedFiles} file${changedFiles === 1 ? '' : 's'} changed`);
    if (untracked > 0) detailParts.push(`${untracked} untracked`);
    if (conflicted > 0) detailParts.push(`${conflicted} conflict${conflicted === 1 ? '' : 's'}`);

    return {
      label,
      detail: detailParts.length > 0 ? detailParts.join(' \u00b7 ') : 'dirty',
      level: conflicted > 0 ? 'conflict' : 'dirty',
    };
  }

  /**
   * Should this session's git state be polled now? Only sessions with a live PTY are
   * pollable, and even those are throttled to at most once per minIntervalMs.
   * @param {{hasLivePty: boolean, lastPollAt: ?number, now: number, minIntervalMs?: number}} args
   */
  function shouldPollGit({ hasLivePty, lastPollAt, now, minIntervalMs = 15000 }) {
    if (!hasLivePty) return false;
    if (lastPollAt == null) return true;
    return now - lastPollAt >= minIntervalMs;
  }

  return {
    parseGitStatusPorcelain,
    parseDiffNumstat,
    summarizeGitState,
    shouldPollGit,
  };
});
