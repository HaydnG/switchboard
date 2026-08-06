# Privacy and security

Switchboard is local-first. Session transcripts, notes, tags, saved views, schedule history, and search indexes stay on the machine.

## Data locations

- Agent transcripts remain in each runtime's own session directory.
- Switchboard metadata and the search cache live in `~/.switchboard/switchboard.db`.
- Destructive database migrations create a consistent snapshot in `~/.switchboard/backups/` before changing the schema.
- Session notes and tags are stored only in Switchboard's database; they are not inserted into agent prompts unless the user explicitly creates a context transfer.

## External access

Switchboard does not provide cloud sync or accounts. The Claude usage indicator calls Anthropic's usage API with the user's existing Claude credentials. Opening a web link delegates it to the operating system after restricting the URL to HTTP or HTTPS.

## Process and file boundaries

- Electron runs with context isolation and without renderer Node integration.
- The preload bridge exposes an explicit API rather than raw `ipcRenderer`.
- Sensitive IPC handlers reject calls from frames other than the main application document.
- File preview and MCP operations are restricted to canonical paths inside known project roots. Traversal, symlink escapes, and common credential files are rejected and logged.
- Pre-launch command prefixes are parsed into arguments and shell-quoted; they are not interpreted as arbitrary shell scripts.
- MCP servers bind to localhost, require per-session authentication, and write owner-only lock files.

The renderer sandbox remains disabled because the supported drag-and-drop bridge uses Electron's native `webUtils.getPathForFile`. This boundary is documented and covered by an isolated Electron startup smoke test; it should be re-evaluated if that bridge changes.

## Diagnostics export

The Global Settings diagnostics action writes a local JSON file after the user chooses a destination. It contains:

- application, Electron, Node, platform, and runtime versions;
- aggregate project/session counts and index health;
- up to 200 recent, redacted log lines.

It excludes transcripts, prompts, notes, tags, environment variables, and credentials. Home-directory paths and common token formats are redacted. The file is created with owner-only permissions where supported.

## Reporting issues

Include a diagnostics export when reporting a runtime problem, but review it before sharing. Never attach `~/.claude/.credentials.json`, shell environment files, or the raw Switchboard database.
