import { describe, expect, it } from 'vitest';
import { chunkSection, timeAgo } from '@renderer/components/knowledge/kb-ui';

describe('knowledge ui helpers', () => {
  it('drops the repeated note title from chunk headings', () => {
    expect(chunkSection('Logistics Glossary > Logistics Glossary', 'Logistics Glossary')).toBe('');
    expect(chunkSection('Legacy Overview > What It Does', 'Legacy Overview')).toBe('What It Does');
    expect(chunkSection('Gateway > Gateway > Auth > Tokens', 'Gateway')).toBe('Auth › Tokens');
    expect(chunkSection('Other heading', 'Gateway')).toBe('Other heading');
    expect(chunkSection('', 'Gateway')).toBe('');
  });

  it('formats ages relative to now', () => {
    const now = Date.UTC(2026, 9, 5, 12);
    expect(timeAgo(0, now)).toBe('never');
    expect(timeAgo(now - 30_000, now)).toBe('just now');
    expect(timeAgo(now - 15 * 60_000, now)).toBe('15m ago');
    expect(timeAgo(now - 5 * 3_600_000, now)).toBe('5h ago');
    expect(timeAgo(now - 6 * 86_400_000, now)).toBe('6d ago');
  });
});
