// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KnowledgeHost } from '@renderer/components/knowledge/KnowledgeHost';
import { KB_ACTIVATE_EVENT } from '@renderer/hooks/useKnowledgeBase';
import type { SwitchboardApi } from '@renderer/types/api';
import type { KbEntry, KbOverview, KbSearchResult } from '@renderer/types/knowledge';

function entry(id: string, title: string, rootId: string, relPath: string): KbEntry {
  return {
    id,
    title,
    rootId,
    relPath,
    absPath: `/kb/${relPath}`,
    layer: relPath.startsWith('Wiki/') ? 'wiki' : 'note',
    mtimeMs: Date.now() - 3_600_000,
    size: 2048,
    chunks: 4,
    boost: 1,
  };
}

const entries = [
  entry('Wiki/gateway.md', 'Gateway', 'vault', 'Wiki/gateway.md'),
  entry('Wiki/auth.md', 'Auth tokens', 'vault', 'Wiki/auth.md'),
  entry('/repo/docs/deploy.md', 'Deploying', 'repo', 'docs/deploy.md'),
];

const overview: KbOverview = {
  ok: true,
  config: {
    file: '/home/.config/second-brain/config.json',
    error: null,
    vault: '/kb',
    wikiDir: 'Wiki',
    discoveredDir: 'Discovered',
    roots: [
      { id: 'vault', label: 'Vault', path: '/kb', isVault: true },
      { id: 'repo', label: 'Repo docs', path: '/repo', isVault: false },
    ],
  },
  jev: { configured: true, readable: true, source: 'jwtFile' },
  daemon: {
    running: true,
    port: 4123,
    health: { model: 'm', files: 3, chunks: 12, indexed_at: Date.now(), unpromoted: 0 },
  },
  plugin: { dir: '/plugin', version: '0.3.6', bun: true },
  index: {
    dbPath: '/cache/index.db',
    exists: true,
    error: null,
    lastIndexMs: Date.now(),
    model: 'm',
  },
  entries,
};

const searchResult: KbSearchResult = {
  ok: true,
  query: 'how do gateway tokens work',
  terms: ['gateway', 'tokens'],
  pool: 12,
  max: 3,
  threshold: 0.5,
  productionTimeoutMs: 1500,
  ranAt: Date.now(),
  timings: { searchMs: 40, jevMs: 900, totalMs: 940 },
  jev: { ok: true, error: null, model: 'jev', cost: 0.0004, inputTokens: 800, outputTokens: 20 },
  candidates: [
    {
      path: 'Wiki/auth.md',
      realpath: '/kb/Wiki/auth.md',
      heading: 'Tokens',
      excerpt: 'Gateway tokens are minted by…',
      score: 0.032,
      source: 'both',
      relevance: 0.91,
    },
    {
      path: '/repo/docs/deploy.md',
      realpath: '/repo/docs/deploy.md',
      heading: '',
      excerpt: 'Deploy with spinnaker',
      score: 0.016,
      source: 'keyword',
      relevance: 0.08,
    },
  ],
  selected: [0],
};

function installApi() {
  const api = {
    getSetting: vi.fn().mockResolvedValue(null),
    setSetting: vi.fn().mockResolvedValue(undefined),
    openExternal: vi.fn(),
    writeClipboard: vi.fn(),
    kbGetOverview: vi.fn().mockResolvedValue(overview),
    kbGetGraph: vi.fn().mockResolvedValue({
      ok: true,
      edges: [
        { from: 'Wiki/gateway.md', to: 'Wiki/auth.md', kind: 'wikilink' },
        { from: 'Wiki/gateway.md', to: '/repo/docs/deploy.md', kind: 'source' },
      ],
      unresolved: { 'Wiki/gateway.md': ['missing-note'] },
      unreadable: [],
      ms: 12,
      builtAt: Date.now(),
    }),
    kbReadEntry: vi.fn().mockImplementation(async (id: string) => ({
      ok: true,
      id,
      content:
        id === 'Wiki/gateway.md'
          ? '---\nsources:\n  - /repo/docs/deploy.md\n---\n# Gateway\n\nSee [[auth]] and [[missing-note]].'
          : '# Auth tokens\n\nMinted by the gateway.',
      links:
        id === 'Wiki/gateway.md'
          ? [
              { kind: 'source', raw: '/repo/docs/deploy.md', target: '/repo/docs/deploy.md' },
              { kind: 'wikilink', raw: 'auth', target: 'Wiki/auth.md' },
              { kind: 'wikilink', raw: 'missing-note', target: null },
            ]
          : [],
    })),
    kbSearch: vi.fn().mockResolvedValue(searchResult),
    kbReindex: vi.fn(),
    kbStartDaemon: vi.fn(),
    kbOpenEntry: vi.fn().mockResolvedValue({ ok: true }),
    kbExportEval: vi.fn().mockResolvedValue({ ok: true, filePath: '/tmp/bench.json' }),
    onKbGraphProgress: vi.fn().mockReturnValue(() => {}),
  };
  window.api = api as unknown as SwitchboardApi;
  return api;
}

async function activate() {
  render(<KnowledgeHost />);
  await act(async () => {
    window.dispatchEvent(new CustomEvent(KB_ACTIVATE_EVENT));
  });
  const sidebar = document.getElementById('kb-content')!;
  await waitFor(() => expect(within(sidebar).getByText('3 entries')).toBeTruthy());
  return { sidebar, view: document.getElementById('kb-viewer')! };
}

describe('KnowledgeHost', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="kb-content"></div><div id="kb-viewer"></div>';
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
  });

  it('renders nothing (and calls nothing) without the legacy mount points', () => {
    document.body.innerHTML = '';
    const api = installApi();
    render(<KnowledgeHost />);
    expect(api.getSetting).not.toHaveBeenCalled();
  });

  it('loads the tree, overview and link graph on first activation', async () => {
    const api = installApi();
    const { sidebar, view } = await activate();
    expect(within(sidebar).getByText('Vault')).toBeTruthy();
    expect(within(sidebar).getByText('Repo docs')).toBeTruthy();
    expect(within(sidebar).queryByText('gateway')).toBeNull();
    fireEvent.click(within(sidebar).getByText('Wiki'));
    expect(within(sidebar).getByText('gateway')).toBeTruthy();
    await waitFor(() => expect(within(view).getByText('Most connected')).toBeTruthy());
    await waitFor(() => expect(within(view).getAllByText('Gateway').length).toBeGreaterThan(0));
    expect(api.kbGetGraph).toHaveBeenCalledTimes(1);
  });

  it('reads an entry, shows its connections and follows wikilinks', async () => {
    const api = installApi();
    const { sidebar, view } = await activate();
    fireEvent.change(within(sidebar).getByLabelText('Filter knowledge base entries'), {
      target: { value: 'gate' },
    });
    expect(within(sidebar).getByText('1 match')).toBeTruthy();
    fireEvent.click(within(sidebar).getByText('gateway'));
    await waitFor(() => expect(view.querySelector('.kb-markdown h1')?.textContent).toBe('Gateway'));
    expect(within(view).getByText('Links to')).toBeTruthy();
    expect(within(view).getByText('Outside the index')).toBeTruthy();
    expect(within(view).getByText('missing-note', { selector: 'code' })).toBeTruthy();

    fireEvent.click(view.querySelector('a[data-kb-raw="auth"]')!);
    await waitFor(() =>
      expect(view.querySelector('.kb-markdown h1')?.textContent).toBe('Auth tokens'),
    );
    expect(api.kbReadEntry).toHaveBeenLastCalledWith('Wiki/auth.md');
  });

  it('runs a search, records labels and scores search against Jev', async () => {
    const api = installApi();
    const { view } = await activate();
    fireEvent.click(within(view).getByRole('tab', { name: 'Search & eval' }));
    fireEvent.change(within(view).getByLabelText('Search query'), {
      target: { value: 'how do gateway tokens work' },
    });
    fireEvent.click(within(view).getByRole('button', { name: 'Search' }));

    await waitFor(() => expect(view.querySelectorAll('.kb-candidates tbody tr')).toHaveLength(2));
    expect(api.kbSearch).toHaveBeenCalledWith({
      query: 'how do gateway tokens work',
      pool: 12,
      max: 3,
    });

    const [first, second] = view.querySelectorAll('.kb-candidates tbody tr');
    fireEvent.click(within(first as HTMLElement).getByLabelText('Relevant'));
    fireEvent.click(within(second as HTMLElement).getByLabelText('Not relevant'));

    const table = await waitFor(() => {
      const found = view.querySelector('.kb-metric-table');
      expect(found).toBeTruthy();
      return found as HTMLElement;
    });
    const searchRow = within(table).getByText('Search alone (top N)').closest('tr')!;
    const jevRow = within(table)
      .getByText(/Jev p ≥ 0.5/)
      .closest('tr')!;
    expect(searchRow.querySelectorAll('td')[2].textContent).toBe('0.50');
    expect(jevRow.querySelectorAll('td')[2].textContent).toBe('1.00');
    await waitFor(() =>
      expect(api.setSetting).toHaveBeenLastCalledWith(
        'knowledgeEvalRuns',
        expect.arrayContaining([expect.objectContaining({ labels: { 0: true, 1: false } })]),
      ),
    );

    fireEvent.click(within(view).getByRole('button', { name: 'Export bench JSON' }));
    await waitFor(() => expect(api.kbExportEval).toHaveBeenCalled());
    expect(api.kbExportEval.mock.calls[0][0].cases[0]).toMatchObject({
      prompt: 'how do gateway tokens work',
      relevant: [0],
    });
  });
});
