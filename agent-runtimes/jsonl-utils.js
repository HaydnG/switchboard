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
  return entry.message?.role === 'user';
}

function isAssistantMessage(entry) {
  if (entry.type === 'assistant') return true;
  if (entry.type !== 'message') return false;
  return entry.message?.role === 'assistant';
}

function messageText(entry) {
  if (typeof entry.message === 'string') return entry.message;
  return contentToText(entry.message?.content);
}

module.exports = {
  contentToText,
  countWords,
  addUsageTotals,
  isUserMessage,
  isAssistantMessage,
  messageText,
};
