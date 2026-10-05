/** Shapes returned by the kb-* IPC channels (kb-ipc.js). */

export type KbLayer = 'wiki' | 'discovered' | 'note';
export type KbLinkKind = 'source' | 'related' | 'wikilink' | 'link' | 'cite';

export interface KbRoot {
  id: string;
  label: string;
  path: string;
  isVault: boolean;
}

export interface KbEntry {
  id: string;
  title: string;
  rootId: string;
  relPath: string;
  absPath: string;
  layer: KbLayer;
  mtimeMs: number;
  size: number;
  chunks: number;
  boost: number;
}

export interface KbDaemonHealth {
  model: string;
  files: number;
  chunks: number;
  indexed_at: number;
  unpromoted: number;
}

export interface KbOverview {
  ok: boolean;
  error?: string;
  config: {
    file: string;
    error: string | null;
    vault: string;
    wikiDir: string;
    discoveredDir: string;
    roots: KbRoot[];
  };
  jev: { configured: boolean; readable: boolean; source: 'jwtFile' | 'keyFile' | null };
  daemon: { running: boolean; port: number | null; health: KbDaemonHealth | null };
  plugin: { dir: string; version: string | null; bun: boolean } | null;
  index: {
    dbPath: string;
    exists: boolean;
    error: string | null;
    lastIndexMs: number;
    model: string | null;
  };
  entries: KbEntry[];
}

export interface KbEdge {
  from: string;
  to: string;
  kind: KbLinkKind;
}

export interface KbGraph {
  ok: boolean;
  error?: string;
  edges: KbEdge[];
  unresolved: Record<string, string[]>;
  unreadable: string[];
  ms: number;
  builtAt: number;
}

export interface KbResolvedLink {
  kind: KbLinkKind;
  raw: string;
  target: string | null;
}

export interface KbEntryContent {
  ok: boolean;
  error?: string;
  id?: string;
  content?: string;
  links?: KbResolvedLink[];
}

export interface KbSearchOptions {
  query: string;
  pool?: number;
  max?: number;
  timeoutMs?: number;
}

export interface KbCandidate {
  path: string;
  realpath: string;
  heading: string;
  excerpt: string;
  score: number;
  source: 'semantic' | 'keyword' | 'both';
  relevance: number | null;
}

export interface KbSearchResult {
  ok: boolean;
  error?: string;
  daemonDown?: boolean;
  query: string;
  terms: string[];
  pool: number;
  max: number;
  threshold: number;
  productionTimeoutMs: number;
  ranAt: number;
  timings: { searchMs: number; jevMs: number; totalMs: number };
  jev: {
    ok: boolean;
    error: string | null;
    model: string | null;
    cost: number | null;
    inputTokens: number | null;
    outputTokens: number | null;
  };
  candidates: KbCandidate[];
  selected: number[];
}

export interface KbBenchCase {
  prompt: string;
  hits: Array<{ path: string; realpath: string; heading: string; excerpt: string }>;
  relevant: number[];
}

export interface KbKnowledgeApi {
  kbGetOverview: () => Promise<KbOverview>;
  kbGetGraph: (force?: boolean) => Promise<KbGraph>;
  kbReadEntry: (id: string) => Promise<KbEntryContent>;
  kbSearch: (options: KbSearchOptions) => Promise<KbSearchResult>;
  kbReindex: (
    full?: boolean,
  ) => Promise<{ ok: boolean; error?: string; stats?: Record<string, number> }>;
  kbStartDaemon: () => Promise<{
    ok: boolean;
    error?: string;
    alreadyRunning?: boolean;
    installed?: boolean;
  }>;
  kbOpenEntry: (id: string, mode?: 'open' | 'reveal') => Promise<{ ok: boolean; error?: string }>;
  kbExportEval: (payload: {
    cases: KbBenchCase[];
  }) => Promise<{ ok: boolean; error?: string; canceled?: boolean; filePath?: string }>;
  onKbGraphProgress: (callback: (progress: { done: number; total: number }) => void) => () => void;
}
