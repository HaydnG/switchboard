const path = require('path');
const fs = require('fs');
const {
  countWords,
  addUsageTotals,
  isUserMessage,
  isAssistantMessage,
  messageText,
} = require('./jsonl-utils');
const { sessionIdFromFilename } = require('./timestamped-jsonl');

/** Factory for Pi / omp JSONL session readers (same on-disk tree format). */
function createPiLikeSessionReader(runtimeId, { titleFromEntry } = {}) {
  return function readSessionFile(filePath, folder, projectPath) {
    const sessionFile = path.basename(filePath);
    let sessionId = sessionIdFromFilename(sessionFile);
    try {
      const stat = fs.statSync(filePath);
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n').filter(Boolean);
      let summary = '';
      let messageCount = 0;
      let textContent = '';
      let customTitle = null;
      let userMessageCount = 0;
      let largestUserPromptWords = 0;
      let startedAt = null;
      let lastEntryAt = null;
      const usageTotals = {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      };

      for (const line of lines) {
        const entry = JSON.parse(line);
        if (entry.type === 'session' && entry.id) sessionId = entry.id;
        if (entry.type === 'session_name' && entry.name) customTitle = entry.name;
        if (!customTitle && titleFromEntry) {
          const title = titleFromEntry(entry);
          if (title) customTitle = title;
        }
        if (entry.timestamp) {
          const timestamp = new Date(entry.timestamp);
          if (!Number.isNaN(timestamp.getTime())) {
            const iso = timestamp.toISOString();
            if (!startedAt || timestamp < new Date(startedAt)) startedAt = iso;
            if (!lastEntryAt || timestamp > new Date(lastEntryAt)) lastEntryAt = iso;
          }
        }
        addUsageTotals(usageTotals, entry.usage);
        addUsageTotals(usageTotals, entry.message?.usage);

        if (isUserMessage(entry) || isAssistantMessage(entry)) messageCount++;

        const text = messageText(entry);
        if (isUserMessage(entry)) {
          userMessageCount++;
          largestUserPromptWords = Math.max(largestUserPromptWords, countWords(text));
        }
        if (!summary && isUserMessage(entry) && text && !text.startsWith('/')) {
          summary = text.slice(0, 120);
        }
        if (text && textContent.length < 8000) {
          textContent += text.slice(0, 500) + '\n';
        }
      }

      if (!sessionId || !summary || messageCount < 1) return null;
      const activeMinutes = startedAt && lastEntryAt
        ? Math.max(0, Math.round((new Date(lastEntryAt) - new Date(startedAt)) / 60000))
        : 0;
      return {
        sessionId,
        sessionFile,
        folder,
        projectPath,
        runtime: runtimeId,
        summary,
        firstPrompt: summary,
        created: stat.birthtime.toISOString(),
        modified: stat.mtime.toISOString(),
        messageCount,
        textContent,
        slug: null,
        customTitle,
        aiTitle: customTitle,
        userMessageCount,
        largestUserPromptWords,
        startedAt,
        lastEntryAt,
        activeMinutes,
        ...usageTotals,
      };
    } catch {
      return null;
    }
  };
}

module.exports = { createPiLikeSessionReader };
