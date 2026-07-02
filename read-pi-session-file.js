const path = require('path');
const fs = require('fs');
const { sessionIdFromPiFilename } = require('./pi-session-path');

function contentToText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(part => {
      if (typeof part === 'string') return part;
      if (typeof part?.text === 'string') return part.text;
      return '';
    }).filter(Boolean).join('\n');
  }
  if (typeof content?.text === 'string') return content.text;
  return '';
}

function countWords(text) {
  const matches = String(text || '').trim().match(/\S+/g);
  return matches ? matches.length : 0;
}

function addUsageTotals(totals, usage) {
  if (!usage || typeof usage !== 'object') return;
  totals.inputTokens += Number(usage.input_tokens || usage.inputTokens || usage.input || 0);
  totals.outputTokens += Number(usage.output_tokens || usage.outputTokens || usage.output || 0);
  totals.cacheCreationTokens += Number(usage.cache_creation_input_tokens || usage.cacheCreationInputTokens || usage.cacheCreationTokens || 0);
  totals.cacheReadTokens += Number(usage.cache_read_input_tokens || usage.cacheReadInputTokens || usage.cacheReadTokens || 0);
}

function isUserMessage(entry) {
  if (entry.type === 'user') return true;
  if (entry.type !== 'message') return false;
  const role = entry.message?.role;
  return role === 'user';
}

function isAssistantMessage(entry) {
  if (entry.type === 'assistant') return true;
  if (entry.type !== 'message') return false;
  const role = entry.message?.role;
  return role === 'assistant';
}

function messageText(entry) {
  if (typeof entry.message === 'string') return entry.message;
  return contentToText(entry.message?.content);
}

/** Parse a Pi session .jsonl file into a Switchboard session object (or null). */
function readPiSessionFile(filePath, folder, projectPath) {
  const sessionFile = path.basename(filePath);
  let sessionId = sessionIdFromPiFilename(sessionFile);
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
      runtime: 'pi',
      summary,
      firstPrompt: summary,
      created: stat.birthtime.toISOString(),
      modified: stat.mtime.toISOString(),
      messageCount,
      textContent,
      slug: null,
      customTitle,
      aiTitle: null,
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
}

module.exports = { readPiSessionFile };
