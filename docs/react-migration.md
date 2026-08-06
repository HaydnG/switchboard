# React + TypeScript migration

## Strategy

**Strangler fig** — React owns the visible application shell while the proven terminal, grid, and viewer engines remain mounted underneath until they reach component parity.

```
index.html
├── #react-shell-sidebar   ← React session browser
├── #main
│   ├── #react-shell-topbar
│   └── legacy workspace surfaces (terminal/grid/viewers)
├── #react-shell-inspector ← React session context
└── #react-root            ← dialogs, toasts, app orchestration
```

## Tooling

| Command | Purpose |
|---------|---------|
| `npm run build:renderer` | One-shot Vite build → `public/dist/react-app.js` |
| `npm run dev:renderer` | Watch mode while editing React components |
| `npm start` | Builds CodeMirror + renderer, then launches Electron |

## Suggested migration order

Port **leaf** UI first (self-contained, few legacy deps), then work inward:

1. ✅ Update toast + updater status (`UpdateToast`, `useUpdater`)
2. ✅ Status bar shell (`StatusBar` — legacy `app.js` still writes child nodes by id)
3. ✅ Dialogs / toasts (`ControlUiHost`, `ControlDialog`, `ControlToastStack`)
4. ✅ Design-system primitives, semantic tokens, command-center shell, and typed legacy events
5. ✅ Visible sidebar/session browser, dashboard, workspace top bar, and inspector
6. Settings panel form internals
7. Grid card chrome and file viewers
8. `app.js` orchestration → typed stores + router

## Conventions

```
src/renderer/
  components/     # presentational React components and integrated shell
  hooks/          # state + window.api bridges
  types/          # shared TS types (mirror preload.js)
  lib/            # pure logic ported from UMD modules
```

- **Styles:** shell styles are emitted as `public/dist/react-app.css`; legacy workspace styles remain in `public/style.css`.
- **Legacy bridge:** dispatch `CustomEvent`s or read legacy globals sparingly; prefer moving pure logic to `src/renderer/lib/` and deleting the UMD copy once tests pass.
- **IPC types:** extend `src/renderer/types/api.ts` as channels migrate; eventually share types with `preload.ts`.

## Ported so far

- **Update toast** — replaces static markup + updater handler in `app.js`
- **Status bar** — React renders `#status-bar` and children; `app.js` still owns usage/info/activity updates until those hooks migrate
- **Control UI** — `showControlDialog`, `showControlMessage`, `showControlToast` globals now backed by React; pure helpers live in `src/renderer/lib/control-dialogs.ts` (compiled to `public/lib/` for tests)
- **Design system** — semantic tokens and reusable button, chip, icon, panel-header, and empty-state components under `src/renderer/components/design-system/`.
- **Application shell** — `SwitchboardShell` owns the visible navigation, productivity dashboard, workspace top bar, runtime launcher, and session inspector.
- **Session browser** — grouped projects, local filtering, live/attention states, direct opening, and Claude/Pi/omp/terminal launch actions are rendered in React. The old sidebar remains hidden as a compatibility event target.
- **Session overview store** — `useSyncExternalStore` consumes typed session snapshots from `app.js`, including active session, health, runtime, task, group, and status.
- **Session inspector** — local notes/tags plus timeline, transcript, context-transfer, and handoff actions.
- **IPC types** — `SwitchboardApi` now mirrors the complete preload surface, including saved views, annotations, schedules, diagnostics, and MCP/file operations.

## Compatibility boundary

The xterm/PTTY lifecycle, grid card engine, settings form, and file viewers remain on the proven legacy path. The legacy sidebar DOM is retained but hidden because several old viewer and project flows still use its event handlers. React communicates through typed custom events and preload APIs. Remove each compatibility target only after behavior, accessibility, persistence, and runtime parity; xterm internals remain intentionally last.

## First ported component

`UpdateToast` replaces the static `#update-toast` markup and the updater handler block at the bottom of `app.js`. Restart still calls `saveUpdateRestartState()` in legacy `app.js` via the `switchboard:save-update-restart-state` event until session state moves to React.
