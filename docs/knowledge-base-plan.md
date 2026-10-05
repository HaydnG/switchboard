# Knowledge base tab (second-brain integration)

Goal: a Switchboard tab that visualises and reads the knowledge bases connected
through [second-brain-kb](https://github.com/doordash/second-brain-kb), shows
their file trees and link graph, and exercises the second-brain search + Jev
relevance gate so its quality can be judged and labelled.

## Data sources (all read-only)

| what | where |
| --- | --- |
| config: vault, roots, layout, jev, boost | `~/.config/second-brain/config.json` (`$SECOND_BRAIN_CONFIG`) |
| every indexed entry (files, titles, chunk counts) | `~/.cache/second-brain/index.db` (SQLite, opened read-only) |
| engine health / hybrid search / reindex | daemon on `127.0.0.1:$(cat ~/.cache/second-brain/daemon.port)` |
| relevance gate | Jev Decisions via `cybertron-service.doordash.com`, same request as `src/relevance.ts` |
| links between entries | parsed from the files: frontmatter `sources:` / `related:`, `[[wikilinks]]`, relative markdown links, `raw/Discovered/<file>.md` citations |

Switchboard never writes to the vault or the index. Labels from the search
evaluation are stored in Switchboard settings and can be exported in the
`bench/relevance.ts` case format.

## Checklist

- [x] Main: `kb-links.js` — pure config, link parsing/resolution, term extraction
- [x] Main: `kb-ipc.js` — overview, graph, read entry, search + Jev, reindex, start daemon, export
- [x] Tests: `test/kb-links.test.js`, `test/kb-jev.test.js` (Jev request lives in `kb-jev.js`)
- [x] Preload + `SwitchboardApi` types
- [x] Legacy shell: sidebar tab, `#kb-content`, `#kb-viewer`, hide/show wiring, smoke test tab count
- [x] Renderer lib: tree, graph neighbourhood, connection tree, eval metrics, force layout, note markdown (+ vitest)
- [x] React: host + sidebar tree, overview, reader, graph, search & eval (+ render test)
- [x] Styles: `public/knowledge-base.css`
- [x] README section
- [x] Verify: format, lint, typecheck, node tests, renderer tests, build, smoke (default + `SWITCHBOARD_SMOKE_VIEW=kb`), live run against the real index
- [x] README screenshots: demo vault + handbook in `scripts/demo/knowledge.js`, stand-in daemon and Jev (`SWITCHBOARD_KB_JEV_URL`, loopback only), shots `knowledge`, `knowledge-graph`, `knowledge-search`
