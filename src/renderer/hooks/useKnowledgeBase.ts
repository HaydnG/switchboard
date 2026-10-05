import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildAdjacency, type KbEvalRun } from '@renderer/lib/knowledge-model';
import type { KbEntry, KbGraph, KbOverview } from '@renderer/types/knowledge';

export const KB_ACTIVATE_EVENT = 'switchboard:kb-activate';
const EVAL_RUNS_SETTING = 'knowledgeEvalRuns';
const MAX_EVAL_RUNS = 100;

export interface KbNotice {
  tone: 'info' | 'success' | 'warning' | 'danger';
  text: string;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useKnowledgeBase() {
  const [activated, setActivated] = useState(false);
  const [overview, setOverview] = useState<KbOverview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [graph, setGraph] = useState<KbGraph | null>(null);
  const [graphLoading, setGraphLoading] = useState(false);
  const [graphProgress, setGraphProgress] = useState<{ done: number; total: number } | null>(null);
  const [busy, setBusy] = useState<'daemon' | 'reindex' | null>(null);
  const [notice, setNotice] = useState<KbNotice | null>(null);
  const graphRequested = useRef(false);

  const refreshOverview = useCallback(async () => {
    setOverviewLoading(true);
    try {
      const next = await window.api.kbGetOverview();
      setOverview(next);
      return next;
    } catch (error) {
      setNotice({ tone: 'danger', text: `Could not read second-brain: ${errorText(error)}` });
      return null;
    } finally {
      setOverviewLoading(false);
    }
  }, []);

  const loadGraph = useCallback(async (force = false) => {
    graphRequested.current = true;
    setGraphLoading(true);
    try {
      const next = await window.api.kbGetGraph(force);
      if (next.ok) setGraph(next);
      else setNotice({ tone: 'warning', text: next.error || 'Link graph unavailable' });
    } catch (error) {
      setNotice({ tone: 'danger', text: `Link graph failed: ${errorText(error)}` });
    } finally {
      setGraphLoading(false);
      setGraphProgress(null);
    }
  }, []);

  useEffect(() => {
    const onActivate = () => {
      setActivated(true);
      void refreshOverview().then((next) => {
        if (next?.index.exists && !graphRequested.current) void loadGraph();
      });
    };
    window.addEventListener(KB_ACTIVATE_EVENT, onActivate);
    return () => window.removeEventListener(KB_ACTIVATE_EVENT, onActivate);
  }, [loadGraph, refreshOverview]);

  useEffect(() => window.api.onKbGraphProgress?.(setGraphProgress), []);

  const startDaemon = useCallback(async () => {
    setBusy('daemon');
    setNotice({ tone: 'info', text: 'Starting the second-brain daemon…' });
    try {
      const result = await window.api.kbStartDaemon();
      setNotice(
        result.ok
          ? {
              tone: 'success',
              text: result.alreadyRunning ? 'Daemon already running' : 'Daemon started',
            }
          : { tone: 'danger', text: result.error || 'Daemon did not start' },
      );
      await refreshOverview();
    } finally {
      setBusy(null);
    }
  }, [refreshOverview]);

  const reindex = useCallback(
    async (full = false) => {
      setBusy('reindex');
      setNotice({
        tone: 'info',
        text: full ? 'Full reindex running…' : 'Reindexing changed notes…',
      });
      try {
        const result = await window.api.kbReindex(full);
        if (!result.ok) {
          setNotice({ tone: 'danger', text: result.error || 'Reindex failed' });
          return;
        }
        const stats = result.stats ?? {};
        setNotice({
          tone: 'success',
          text: `Reindexed ${stats.indexed ?? 0} of ${stats.total ?? 0} files (${stats.pruned ?? 0} pruned) in ${Math.round((stats.ms ?? 0) / 100) / 10}s`,
        });
        const next = await refreshOverview();
        if (next?.index.exists) await loadGraph();
      } finally {
        setBusy(null);
      }
    },
    [loadGraph, refreshOverview],
  );

  const entries = useMemo(() => overview?.entries ?? [], [overview]);
  const entriesById = useMemo(
    () => new Map<string, KbEntry>(entries.map((entry) => [entry.id, entry])),
    [entries],
  );
  const adjacency = useMemo(() => buildAdjacency(graph?.edges ?? []), [graph]);

  return {
    activated,
    adjacency,
    busy,
    entries,
    entriesById,
    graph,
    graphLoading,
    graphProgress,
    loadGraph,
    notice,
    overview,
    overviewLoading,
    refreshOverview,
    reindex,
    setNotice,
    startDaemon,
  };
}

export type KnowledgeBaseState = ReturnType<typeof useKnowledgeBase>;

/** Labelled search runs, persisted in Switchboard settings (never in the vault). */
export function useEvalRuns() {
  const [runs, setRuns] = useState<KbEvalRun[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void window.api
      .getSetting<KbEvalRun[]>(EVAL_RUNS_SETTING)
      .then((stored) => {
        if (cancelled || !Array.isArray(stored)) return;
        setRuns((current) => {
          const ids = new Set(current.map((run) => run.id));
          return [...current, ...stored.filter((run) => !ids.has(run.id))];
        });
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (loaded) void window.api.setSetting(EVAL_RUNS_SETTING, runs);
  }, [loaded, runs]);

  const update = useCallback((fn: (current: KbEvalRun[]) => KbEvalRun[]) => {
    setRuns((current) => fn(current).slice(0, MAX_EVAL_RUNS));
  }, []);

  const addRun = useCallback((run: KbEvalRun) => update((current) => [run, ...current]), [update]);
  const setLabel = useCallback(
    (runId: string, index: number, relevant: boolean | null) =>
      update((current) =>
        current.map((run) => {
          if (run.id !== runId) return run;
          const labels = { ...run.labels };
          if (relevant === null) delete labels[index];
          else labels[index] = relevant;
          return { ...run, labels };
        }),
      ),
    [update],
  );
  const removeRun = useCallback(
    (runId: string) => update((current) => current.filter((run) => run.id !== runId)),
    [update],
  );
  const clearRuns = useCallback(() => update(() => []), [update]);

  return { runs, addRun, setLabel, removeRun, clearRuns };
}
