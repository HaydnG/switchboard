# React + TypeScript migration

Experimental branch: `feat/react-component-architecture`.

## Strategy

**Strangler fig** — React mounts into `#react-root` inside the existing `index.html`. Legacy vanilla scripts keep running until each surface is ported.

```
index.html
├── legacy scripts (sidebar.js, app.js, …)   ← shrink over time
└── public/dist/react-app.js (Vite IIFE)      ← grow over time
    └── #react-root
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
4. Settings panel
5. Sidebar (large — split into subcomponents first)
6. Grid view (largest — terminal integration last)
7. `app.js` orchestration → React context + router

## Conventions

```
src/renderer/
  components/     # presentational React components
  hooks/          # state + window.api bridges
  types/          # shared TS types (mirror preload.js)
  lib/            # pure logic ported from UMD modules
```

- **Styles:** keep using `public/style.css` until CSS is split; co-locate new component CSS only when a section moves.
- **Legacy bridge:** dispatch `CustomEvent`s or read legacy globals sparingly; prefer moving pure logic to `src/renderer/lib/` and deleting the UMD copy once tests pass.
- **IPC types:** extend `src/renderer/types/api.ts` as channels migrate; eventually share types with `preload.ts`.

## Ported so far

- **Update toast** — replaces static markup + updater handler in `app.js`
- **Status bar** — React renders `#status-bar` and children; `app.js` still owns usage/info/activity updates until those hooks migrate
- **Control UI** — `showControlDialog`, `showControlMessage`, `showControlToast` globals now backed by React; pure helpers live in `src/renderer/lib/control-dialogs.ts` (compiled to `public/lib/` for tests)

## First ported component

`UpdateToast` replaces the static `#update-toast` markup and the updater handler block at the bottom of `app.js`. Restart still calls `saveUpdateRestartState()` in legacy `app.js` via the `switchboard:save-update-restart-state` event until session state moves to React.
