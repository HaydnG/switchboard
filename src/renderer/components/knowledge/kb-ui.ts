import type { KbEntry, KbLinkKind, KbRoot } from '@renderer/types/knowledge';

export type KbTab = 'overview' | 'reader' | 'graph' | 'search';

export type KbSearchPreset = 'prompt' | 'vault' | 'custom';

export interface KbSearchState {
  query: string;
  preset: KbSearchPreset;
  pool: number;
  max: number;
  running: boolean;
  currentRunId: string | null;
  failure: { text: string; daemonDown: boolean } | null;
}

export const INITIAL_SEARCH_STATE: KbSearchState = {
  query: '',
  preset: 'prompt',
  pool: 12,
  max: 3,
  running: false,
  currentRunId: null,
  failure: null,
};

const ROOT_COLORS = ['#8088ff', '#5ec46a', '#e6b85d', '#f08a68', '#72d9d0', '#bd93f9', '#ff79c6'];
const OTHER_COLOR = '#7a7a90';

export function rootColor(rootId: string, roots: KbRoot[]): string {
  const index = roots.findIndex((root) => root.id === rootId);
  return index === -1 ? OTHER_COLOR : ROOT_COLORS[index % ROOT_COLORS.length];
}

export function rootLabel(rootId: string, roots: KbRoot[]): string {
  return roots.find((root) => root.id === rootId)?.label ?? (rootId === 'other' ? 'Other' : rootId);
}

export const LINK_KIND_COLORS: Record<KbLinkKind, string> = {
  source: '#e6b85d',
  related: '#bd93f9',
  wikilink: '#72d9d0',
  link: '#8088ff',
  cite: '#f08a68',
};

export const LINK_KIND_HELP: Record<KbLinkKind, string> = {
  source: 'Frontmatter sources: — the raw notes an article was compiled from',
  related: 'Frontmatter related: — sibling articles',
  wikilink: '[[wikilink]] in the body',
  link: 'Relative markdown link in the body',
  cite: 'Plain-text citation of a discovered note',
};

export function timeAgo(ms: number, now = Date.now()): string {
  if (!ms) return 'never';
  const seconds = Math.max(0, Math.round((now - ms) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 60) return `${days}d ago`;
  return new Date(ms).toLocaleDateString();
}

export function formatCount(value: number): string {
  return value.toLocaleString();
}

export function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`;
}

export function formatCost(cost: number | null): string {
  if (cost === null) return '—';
  return cost < 0.01 ? `$${cost.toFixed(6)}` : `$${cost.toFixed(4)}`;
}

export function entryName(entry: KbEntry | undefined, fallback: string): string {
  if (!entry) return fallback.split('/').at(-1) ?? fallback;
  return entry.title || entry.relPath.split('/').at(-1) || entry.id;
}

/**
 * A chunk heading without the leading note title. second-brain headings are
 * "Title > H1 > Section", and the H1 usually repeats the title.
 */
export function chunkSection(heading: string, title: string): string {
  const parts = heading.split(/\s+>\s+/).map((part) => part.trim());
  while (parts.length > 0 && parts[0] === title.trim()) parts.shift();
  return parts.filter(Boolean).join(' › ');
}

export function layerLabel(entry: KbEntry): string | null {
  if (entry.layer === 'wiki') return 'Wiki article';
  if (entry.layer === 'discovered') return 'Discovered note';
  return null;
}
