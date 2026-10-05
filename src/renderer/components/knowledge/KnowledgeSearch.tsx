import { useMemo, useState, type FormEvent } from 'react';
import type { KnowledgeBaseState, useEvalRuns } from '@renderer/hooks/useKnowledgeBase';
import {
  evalRunFromResult,
  formatRatio,
  isLabelled,
  jevAgreement,
  jevPicks,
  median,
  relevantIndices,
  scorePicks,
  searchPicks,
  toBenchCases,
  type KbEvalRun,
} from '@renderer/lib/knowledge-model';
import type { KbSearchResult } from '@renderer/types/knowledge';
import {
  entryName,
  formatCost,
  formatCount,
  formatMs,
  chunkSection,
  rootColor,
  type KbSearchPreset,
  type KbSearchState,
} from '@renderer/components/knowledge/kb-ui';

const PRESETS: Record<
  Exclude<KbSearchPreset, 'custom'>,
  { pool: number; max: number; label: string; help: string }
> = {
  prompt: {
    pool: 12,
    max: 3,
    label: 'Prompt injection (12 → 3)',
    help: 'What the UserPromptSubmit hook does: 12 candidates, Jev keeps at most 3.',
  },
  vault: {
    pool: 24,
    max: 8,
    label: 'vault_search (24 → 8)',
    help: 'What the vault_search MCP tool does: 24 candidates, Jev keeps at most 8.',
  },
};

const THRESHOLDS = [0.3, 0.5, 0.7];

type EvalRuns = ReturnType<typeof useEvalRuns>;

interface KnowledgeSearchProps {
  kb: KnowledgeBaseState;
  evalRuns: EvalRuns;
  state: KbSearchState;
  setState: (update: (current: KbSearchState) => KbSearchState) => void;
  onOpen: (id: string) => void;
}

function TimingBar({ run }: { run: KbEvalRun }) {
  const scale = Math.max(run.timings.totalMs, run.productionTimeoutMs * 1.25);
  const pct = (ms: number) => `${(ms / scale) * 100}%`;
  const overBudget = run.timings.jevMs > run.productionTimeoutMs;
  return (
    <div className="kb-timing">
      <div className="kb-timing-bar">
        <span className="kb-timing-search" style={{ width: pct(run.timings.searchMs) }} />
        <span
          className={`kb-timing-jev${overBudget ? ' is-over' : ''}`}
          style={{ width: pct(run.timings.jevMs) }}
        />
        <span
          className="kb-timing-budget"
          style={{ left: pct(run.timings.searchMs + run.productionTimeoutMs) }}
          title={`Production Jev timeout (${formatMs(run.productionTimeoutMs)})`}
        />
      </div>
      <div className="kb-timing-legend">
        <span>
          <i className="kb-timing-search" /> Search {formatMs(run.timings.searchMs)}
        </span>
        <span>
          <i className={`kb-timing-jev${overBudget ? ' is-over' : ''}`} /> Jev{' '}
          {formatMs(run.timings.jevMs)}
          {overBudget && ' — over the production budget, the hook would have injected nothing'}
        </span>
        <span>Total {formatMs(run.timings.totalMs)}</span>
      </div>
    </div>
  );
}

function PickList({
  title,
  picks,
  run,
  titleOf,
}: {
  title: string;
  picks: number[];
  run: KbEvalRun;
  titleOf: (index: number) => string;
}) {
  const want = new Set(relevantIndices(run));
  const labelled = isLabelled(run);
  const good = picks.filter((i) => want.has(i)).length;
  return (
    <div className="kb-picks">
      <h5>
        {title}{' '}
        {labelled && (
          <span className="kb-muted">
            {good}/{picks.length} relevant
          </span>
        )}
      </h5>
      {picks.length === 0 ? (
        <p className="kb-muted">Nothing injected.</p>
      ) : (
        <ol>
          {picks.map((i) => (
            <li
              key={i}
              className={
                labelled ? (want.has(i) ? 'is-good' : run.labels[i] === false ? 'is-bad' : '') : ''
              }
            >
              <span className="kb-muted">#{i + 1}</span> {titleOf(i)}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function Metrics({ runs }: { runs: KbEvalRun[] }) {
  const labelled = runs.filter(isLabelled);
  const rows = useMemo(
    () => [
      {
        label: 'Search alone (top N)',
        score: scorePicks(labelled, searchPicks),
        production: false,
      },
      ...THRESHOLDS.map((threshold) => ({
        label: `Jev p ≥ ${threshold}`,
        score: scorePicks(labelled, (run) => jevPicks(run, threshold)),
        production: threshold === 0.5,
      })),
    ],
    [labelled],
  );
  const searchMs = median(runs.map((run) => run.timings.searchMs));
  const jevRuns = runs.filter((run) => run.jev.ok);
  const jevMs = median(jevRuns.map((run) => run.timings.jevMs));
  const overBudget = runs.filter((run) => run.timings.jevMs > run.productionTimeoutMs).length;
  const cost = runs.reduce((sum, run) => sum + (run.jev.cost ?? 0), 0);
  const agreement = jevAgreement(labelled, 0.5);

  return (
    <div className="kb-metrics">
      <div className="kb-metric-tiles">
        <div>
          <span>Runs</span>
          <strong>{runs.length}</strong>
          <em>{labelled.length} labelled</em>
        </div>
        <div>
          <span>Median search</span>
          <strong>{searchMs === null ? '—' : formatMs(searchMs)}</strong>
          <em>daemon hybrid search</em>
        </div>
        <div>
          <span>Median Jev</span>
          <strong>{jevMs === null ? '—' : formatMs(jevMs)}</strong>
          <em>
            {overBudget} over the {formatMs(runs[0]?.productionTimeoutMs ?? 1500)} budget
          </em>
        </div>
        <div>
          <span>Jev agreement</span>
          <strong>{formatRatio(agreement)}</strong>
          <em>labels vs p ≥ 0.5</em>
        </div>
        <div>
          <span>Jev cost</span>
          <strong>{formatCost(runs.length ? cost : null)}</strong>
          <em>all runs</em>
        </div>
      </div>
      {labelled.length === 0 ? (
        <p className="kb-muted">
          Label candidates ✓ / ✗ to score precision and recall. Unlabelled candidates count as not
          relevant, so label every candidate in a run for accurate recall.
        </p>
      ) : (
        <table className="kb-table kb-metric-table">
          <thead>
            <tr>
              <th>Picker</th>
              <th title="Candidates injected across labelled runs">Injected</th>
              <th title="Relevant ÷ injected">Precision</th>
              <th title="Relevant found ÷ relevant available, capped at N per run (bench/relevance.ts)">
                Recall
              </th>
              <th title="Of the runs where nothing was relevant, how many injected nothing">
                Silent
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ label, score, production }) => (
              <tr key={label} className={production ? 'is-production' : ''}>
                <td>
                  {label}
                  {production && <span className="kb-pill">production</span>}
                </td>
                <td>{score.injected}</td>
                <td>{formatRatio(score.precision)}</td>
                <td>{formatRatio(score.recall)}</td>
                <td>{score.silentCases ? `${score.silentOk}/${score.silentCases}` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function KnowledgeSearch({ kb, evalRuns, state, setState, onOpen }: KnowledgeSearchProps) {
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const { runs, addRun, setLabel, removeRun, clearRuns } = evalRuns;
  const run = runs.find((item) => item.id === state.currentRunId) ?? null;
  const roots = kb.overview?.config.roots ?? [];
  const daemonRunning = kb.overview?.daemon.running ?? false;
  const jevReady = kb.overview?.jev.readable ?? false;

  const titleOf = (target: KbEvalRun) => (index: number) => {
    const candidate = target.candidates[index];
    if (!candidate) return `#${index + 1}`;
    const name = entryName(kb.entriesById.get(candidate.path), candidate.path);
    const section = chunkSection(candidate.heading, name);
    return section ? `${name} › ${section}` : name;
  };

  const runSearch = async (event?: FormEvent) => {
    event?.preventDefault();
    const query = state.query.trim();
    if (!query || state.running) return;
    setState((current) => ({ ...current, running: true, failure: null }));
    let result: KbSearchResult;
    try {
      result = await window.api.kbSearch({ query, pool: state.pool, max: state.max });
    } catch (error) {
      setState((current) => ({
        ...current,
        running: false,
        failure: {
          text: error instanceof Error ? error.message : String(error),
          daemonDown: false,
        },
      }));
      return;
    }
    if (!result.ok) {
      const failure = {
        text: result.error || 'Search failed',
        daemonDown: result.daemonDown === true,
      };
      setState((current) => ({ ...current, running: false, failure }));
      return;
    }
    const next = evalRunFromResult(result);
    addRun(next);
    setExpanded(new Set());
    setState((current) => ({ ...current, running: false, currentRunId: next.id }));
  };

  const exportRuns = async () => {
    const cases = toBenchCases(runs);
    if (cases.length === 0) {
      kb.setNotice({ tone: 'warning', text: 'Label at least one run before exporting' });
      return;
    }
    const result = await window.api.kbExportEval({ cases });
    if (result.ok) {
      kb.setNotice({
        tone: 'success',
        text: `Exported ${cases.length} case${cases.length === 1 ? '' : 's'} to ${result.filePath}. Score it with: bun bench/relevance.ts ${result.filePath}`,
      });
    } else if (!result.canceled)
      kb.setNotice({ tone: 'danger', text: result.error || 'Export failed' });
  };

  const choosePreset = (preset: KbSearchPreset) =>
    setState((current) =>
      preset === 'custom'
        ? { ...current, preset }
        : { ...current, preset, pool: PRESETS[preset].pool, max: PRESETS[preset].max },
    );

  const searchTop = run ? new Set(searchPicks(run)) : new Set<number>();
  const jevTop = run ? new Set(jevPicks(run)) : new Set<number>();

  return (
    <div className="kb-search">
      <form className="kb-search-bar" onSubmit={(event) => void runSearch(event)}>
        <input
          type="search"
          value={state.query}
          placeholder="Ask the knowledge base, the way you would prompt Claude…"
          aria-label="Search query"
          onChange={(event) => {
            const query = event.target.value;
            setState((current) => ({ ...current, query }));
          }}
        />
        <select
          value={state.preset}
          aria-label="Search mode"
          title={state.preset === 'custom' ? '' : PRESETS[state.preset].help}
          onChange={(event) => choosePreset(event.target.value as KbSearchPreset)}
        >
          <option value="prompt">{PRESETS.prompt.label}</option>
          <option value="vault">{PRESETS.vault.label}</option>
          <option value="custom">Custom</option>
        </select>
        {state.preset === 'custom' && (
          <>
            <label className="kb-field">
              Pool
              <input
                type="number"
                min={1}
                max={48}
                value={state.pool}
                onChange={(event) => {
                  const pool = Math.min(48, Math.max(1, Number(event.target.value) || 1));
                  setState((current) => ({ ...current, pool }));
                }}
              />
            </label>
            <label className="kb-field">
              Keep
              <input
                type="number"
                min={1}
                max={48}
                value={state.max}
                onChange={(event) => {
                  const max = Math.min(48, Math.max(1, Number(event.target.value) || 1));
                  setState((current) => ({ ...current, max }));
                }}
              />
            </label>
          </>
        )}
        <button
          type="submit"
          className="btn btn-primary"
          disabled={state.running || !state.query.trim()}
        >
          {state.running ? 'Searching…' : 'Search'}
        </button>
      </form>

      {!daemonRunning && (
        <div className="kb-callout">
          The second-brain daemon is not running, so search is unavailable.{' '}
          <button
            type="button"
            className="btn"
            disabled={kb.busy !== null}
            onClick={() => void kb.startDaemon()}
          >
            Start daemon
          </button>
        </div>
      )}
      {daemonRunning && !jevReady && (
        <div className="kb-callout">
          Jev is not configured (no readable key in the second-brain config), so results are
          search-only.
        </div>
      )}
      {state.failure && (
        <div className="kb-callout is-danger">
          {state.failure.text}
          {state.failure.daemonDown && (
            <>
              {' '}
              <button
                type="button"
                className="btn"
                disabled={kb.busy !== null}
                onClick={() => void kb.startDaemon()}
              >
                Start daemon
              </button>
            </>
          )}
        </div>
      )}

      <div className="kb-search-body">
        <section className="kb-search-run">
          {!run ? (
            <div className="kb-empty">
              <h3>Measure retrieval</h3>
              <p>
                Each search runs the daemon’s hybrid retrieval (semantic + keyword, fused with RRF),
                then asks Jev which candidates are relevant, exactly like the prompt hook. Label the
                candidates to compare search alone against the Jev gate.
              </p>
            </div>
          ) : (
            <>
              <header className="kb-run-head">
                <div>
                  <h3>“{run.query}”</h3>
                  <span className="kb-muted">
                    pool {run.pool} → keep {run.max} · threshold {run.threshold} ·{' '}
                    {new Date(run.ranAt).toLocaleString()}
                  </span>
                </div>
                <div className="kb-run-jev">
                  {run.jev.ok ? (
                    <>
                      <span>{run.jev.model}</span>
                      <span className="kb-muted">
                        {formatCost(run.jev.cost)}
                        {run.jev.inputTokens !== null &&
                          ` · ${formatCount(run.jev.inputTokens)} in / ${formatCount(run.jev.outputTokens ?? 0)} out tokens`}
                      </span>
                    </>
                  ) : (
                    <span className="kb-error">Jev: {run.jev.error || 'unavailable'}</span>
                  )}
                </div>
              </header>
              <TimingBar run={run} />
              <div className="kb-compare">
                <PickList
                  title={`Search alone · top ${run.max}`}
                  picks={searchPicks(run)}
                  run={run}
                  titleOf={titleOf(run)}
                />
                <PickList
                  title={`Jev gate · p ≥ ${run.threshold}, max ${run.max}`}
                  picks={jevPicks(run)}
                  run={run}
                  titleOf={titleOf(run)}
                />
              </div>
              <table className="kb-table kb-candidates">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Candidate</th>
                    <th title="Which retrieval leg found it">Leg</th>
                    <th title="Reciprocal-rank-fusion score">RRF</th>
                    <th title="Jev probability that the candidate is relevant">Jev p</th>
                    <th>Picked</th>
                    <th>Relevant?</th>
                  </tr>
                </thead>
                <tbody>
                  {run.candidates.map((candidate, index) => {
                    const entry = kb.entriesById.get(candidate.path);
                    const label = run.labels[index];
                    const p = candidate.relevance;
                    const open = expanded.has(index);
                    const name = entryName(entry, candidate.path);
                    const section = chunkSection(candidate.heading, name);
                    return (
                      <tr
                        key={`${candidate.path}:${candidate.heading}:${index}`}
                        className={label === true ? 'is-good' : label === false ? 'is-bad' : ''}
                      >
                        <td className="kb-muted">{index + 1}</td>
                        <td className="kb-candidate">
                          <div className="kb-candidate-title">
                            <span
                              className="kb-tree-swatch"
                              style={{ background: rootColor(entry?.rootId ?? 'other', roots) }}
                            />
                            {entry ? (
                              <button
                                type="button"
                                className="kb-link-button"
                                title={candidate.path}
                                onClick={() => onOpen(entry.id)}
                              >
                                {name}
                              </button>
                            ) : (
                              <span title={candidate.path}>{name}</span>
                            )}
                            {section && <span className="kb-muted">› {section}</span>}
                          </div>
                          <button
                            type="button"
                            className={`kb-excerpt${open ? ' is-open' : ''}`}
                            title={open ? 'Collapse' : 'Show the full excerpt'}
                            onClick={() =>
                              setExpanded((current) => {
                                const next = new Set(current);
                                if (next.has(index)) next.delete(index);
                                else next.add(index);
                                return next;
                              })
                            }
                          >
                            {candidate.excerpt}
                          </button>
                        </td>
                        <td>
                          <span className={`kb-leg leg-${candidate.source}`}>
                            {candidate.source}
                          </span>
                        </td>
                        <td className="kb-num">{candidate.score.toFixed(4)}</td>
                        <td>
                          {typeof p === 'number' ? (
                            <span className="kb-prob" title={p.toFixed(3)}>
                              <span className="kb-bar">
                                <span
                                  className={p >= run.threshold ? 'is-pass' : ''}
                                  style={{ width: `${Math.round(p * 100)}%` }}
                                />
                              </span>
                              <span className="kb-num">{p.toFixed(2)}</span>
                            </span>
                          ) : (
                            <span className="kb-muted">—</span>
                          )}
                        </td>
                        <td className="kb-badges">
                          {searchTop.has(index) && <span className="kb-pill">top {run.max}</span>}
                          {jevTop.has(index) && <span className="kb-pill is-jev">Jev</span>}
                        </td>
                        <td className="kb-label-buttons">
                          <button
                            type="button"
                            className={label === true ? 'is-on is-good' : ''}
                            aria-pressed={label === true}
                            aria-label="Relevant"
                            onClick={() => setLabel(run.id, index, label === true ? null : true)}
                          >
                            ✓
                          </button>
                          <button
                            type="button"
                            className={label === false ? 'is-on is-bad' : ''}
                            aria-pressed={label === false}
                            aria-label="Not relevant"
                            onClick={() => setLabel(run.id, index, label === false ? null : false)}
                          >
                            ✗
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {run.candidates.length > 0 && (
                <div className="kb-actions">
                  <button
                    type="button"
                    className="btn"
                    onClick={() =>
                      run.candidates.forEach((_, index) => {
                        if (run.labels[index] === undefined) setLabel(run.id, index, false);
                      })
                    }
                  >
                    Mark the rest not relevant
                  </button>
                </div>
              )}
              {run.candidates.length === 0 && (
                <p className="kb-muted">The daemon returned no candidates.</p>
              )}
            </>
          )}
        </section>

        <aside className="kb-search-history">
          <div className="kb-history-head">
            <h4>Evaluation</h4>
            <div className="kb-actions">
              <button
                type="button"
                className="btn"
                disabled={!runs.some(isLabelled)}
                onClick={() => void exportRuns()}
              >
                Export bench JSON
              </button>
              <button
                type="button"
                className="btn"
                disabled={runs.length === 0}
                onClick={() => {
                  if (window.confirm('Clear all saved search runs and labels?')) {
                    clearRuns();
                    setState((current) => ({ ...current, currentRunId: null }));
                  }
                }}
              >
                Clear
              </button>
            </div>
          </div>
          <Metrics runs={runs} />
          <h5>History</h5>
          {runs.length === 0 ? (
            <p className="kb-muted">No runs yet.</p>
          ) : (
            <ul className="kb-history">
              {runs.map((item) => {
                const labelledCount = Object.keys(item.labels).length;
                return (
                  <li key={item.id} className={item.id === state.currentRunId ? 'is-current' : ''}>
                    <button
                      type="button"
                      className="kb-history-main"
                      onClick={() =>
                        setState((current) => ({
                          ...current,
                          currentRunId: item.id,
                          query: item.query,
                        }))
                      }
                    >
                      <span className="kb-history-query">{item.query}</span>
                      <span className="kb-muted">
                        {item.pool}→{item.max} · {jevPicks(item).length} picked ·{' '}
                        {formatMs(item.timings.totalMs)} · {labelledCount}/{item.candidates.length}{' '}
                        labelled
                      </span>
                    </button>
                    <button
                      type="button"
                      className="kb-history-remove"
                      aria-label="Remove run"
                      onClick={() => {
                        removeRun(item.id);
                        if (item.id === state.currentRunId) {
                          setState((current) => ({ ...current, currentRunId: null }));
                        }
                      }}
                    >
                      ×
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="kb-muted kb-footnote">
            Runs and labels are stored in Switchboard settings, never in the vault. The export
            matches bench/relevance.ts’s case format.
          </p>
        </aside>
      </div>
    </div>
  );
}
