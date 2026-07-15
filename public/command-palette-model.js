(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    Object.assign(root, factory());
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const WORD_START_CHARS = new Set([' ', '-', '_', '/', '.']);

  const CONSECUTIVE_BONUS = 6;
  const WORD_START_BONUS = 8;
  const SUBSTRING_BONUS = 10;
  const GAP_PENALTY = 1;
  const BASE_MATCH_SCORE = 1;

  /**
   * Case-insensitive subsequence fuzzy score. Every char of `query` must
   * appear in `text` in order; returns 0 when it doesn't (no match).
   * Higher score = better match: rewards consecutive runs and matches that
   * start at a word/segment boundary, and gives a flat bonus for an exact
   * substring hit. Gaps between matched chars are penalized by their size.
   * Shorter `text` wins ties (favors more specific/precise results).
   * @param {string} query
   * @param {string} text
   * @returns {number}
   */
  function fuzzyScore(query, text) {
    if (!query || !text) return 0;
    const q = String(query).toLowerCase();
    const t = String(text).toLowerCase();
    if (!q.length || !t.length) return 0;

    let score = 0;
    let ti = 0;
    let lastMatchIndex = -1;
    let consecutiveRun = 0;

    for (let qi = 0; qi < q.length; qi++) {
      const ch = q[qi];
      const foundAt = t.indexOf(ch, ti);
      if (foundAt === -1) return 0;

      if (lastMatchIndex !== -1) {
        const gap = foundAt - lastMatchIndex - 1;
        if (gap === 0) {
          consecutiveRun += 1;
          score += CONSECUTIVE_BONUS * consecutiveRun;
        } else {
          consecutiveRun = 0;
          score -= gap * GAP_PENALTY;
        }
      }

      score += BASE_MATCH_SCORE;
      const prevChar = foundAt > 0 ? t[foundAt - 1] : '';
      if (foundAt === 0 || WORD_START_CHARS.has(prevChar)) {
        score += WORD_START_BONUS;
      }

      lastMatchIndex = foundAt;
      ti = foundAt + 1;
    }

    if (t.includes(q)) {
      score += SUBSTRING_BONUS;
    }

    // Shorter text wins ties: normalize by a tiny length-based tiebreaker
    // that never outweighs a real scoring difference.
    score += 1 / (t.length + 1);

    return score > 0 ? score : Number.EPSILON;
  }

  function lastPathSegments(path, count) {
    if (!path) return [];
    const segments = String(path).split('/').filter(Boolean);
    return segments.slice(-count);
  }

  function sessionToItem(session) {
    const segments = lastPathSegments(session.projectPath, 2);
    return {
      id: session.sessionId,
      kind: 'session',
      title: session.name,
      subtitle: segments.join('/'),
      keywords: [session.status, session.runtime, ...segments].filter(Boolean),
      data: session,
    };
  }

  function projectToItem(project) {
    return {
      id: project.path,
      kind: 'project',
      title: project.name,
      subtitle: project.path,
      keywords: [project.path],
      data: project,
    };
  }

  function actionToItem(action) {
    return {
      id: action.id,
      kind: 'action',
      title: action.title,
      subtitle: '',
      keywords: action.keywords || [],
      data: action,
    };
  }

  /**
   * Flattens sessions/projects/actions into a uniform palette item shape.
   * @param {{ sessions?: Array, projects?: Array, actions?: Array }} source
   * @returns {Array<{id: string, kind: string, title: string, subtitle: string, keywords: string[], data: object}>}
   */
  function buildPaletteItems({ sessions = [], projects = [], actions = [] } = {}) {
    return [
      ...sessions.map(sessionToItem),
      ...projects.map(projectToItem),
      ...actions.map(actionToItem),
    ];
  }

  function bestKeywordScore(query, item) {
    let best = 0;
    if (item.subtitle) {
      best = Math.max(best, fuzzyScore(query, item.subtitle));
    }
    for (const keyword of item.keywords || []) {
      if (!keyword) continue;
      best = Math.max(best, fuzzyScore(query, keyword));
    }
    return best;
  }

  /**
   * Ranks palette items against a query. Title matches outweigh
   * keyword/subtitle matches. Empty/whitespace query passes through the
   * first `limit` items unscored, preserving caller order (recency).
   * @param {string} query
   * @param {Array} items
   * @param {{limit?: number}} [options]
   * @returns {Array}
   */
  function rankPaletteItems(query, items, { limit = 12 } = {}) {
    const list = items || [];
    const trimmed = (query || '').trim();

    if (!trimmed) {
      return list.slice(0, limit);
    }

    const scored = list
      .map((item, index) => {
        const titleScore = fuzzyScore(trimmed, item.title || '');
        const keywordScore = bestKeywordScore(trimmed, item);
        const score = Math.max(titleScore, 0.5 * keywordScore);
        return { item, index, score };
      })
      .filter((entry) => entry.score > 0);

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.index - b.index;
    });

    return scored.slice(0, limit).map((entry) => entry.item);
  }

  return {
    fuzzyScore,
    buildPaletteItems,
    rankPaletteItems,
  };
});
