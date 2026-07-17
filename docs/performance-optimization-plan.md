# Performance optimization plan

Goal: reduce CPU, disk, IPC, and memory use without changing Switchboard's
session-management, terminal, grid, watcher, or notification behavior.

## Baseline and safety

- [x] Capture baseline validation results and identify the hot-path tests.
- [ ] Preserve existing adaptive polling, watcher debounce, terminal write
  batching, grid interaction guards, and runtime-specific session behavior.

## Main-process and indexing work

- [x] Coalesce PTY output in the main process before renderer IPC while keeping
  output order, bounded buffering, and terminal replay behavior intact.
- [x] Deduplicate concurrent project cache reconciliations so a sidebar load
  performs one filesystem reconciliation.
- [x] Move watcher-triggered folder indexing off the Electron main thread.
- [x] Reduce idle background work: visibility-aware Git/usage refresh and
  watcher cleanup.
- [x] Cache unchanged schedule files so the minute scheduler avoids repeated
  frontmatter reads and parsing.
- [ ] Evaluate eliminating the remaining project-directory scan against a live
  battery trace before changing scheduler semantics.

## Renderer and terminal work

- [x] Avoid full sidebar/grid DOM work when the active PTY set is unchanged.
- [x] Debounce resize-driven xterm fitting and coalesce grid column updates.
- [ ] Avoid full sidebar rebuilds for single-session status/task changes where
  a safe targeted patch is possible.
- [ ] Add an explicit terminal-scrollback setting before changing the current
  10,000-line default.
- [x] Gate non-critical time-label background work when the window is hidden.
- [ ] Do not gate prompt-queue delivery: it must continue while the app is
  backgrounded to preserve queued-prompt behavior.
- [x] Release file-panel IPC listeners when a viewer panel is destroyed.

## Verification

- [ ] Add focused regression tests for new batching, deduplication, and
  scheduling behavior.
- [ ] Run formatting checks, the full test suite, typecheck, and production
  build.
- [ ] Perform a desktop runtime smoke test and report any remaining
  measurement-only follow-up work.
