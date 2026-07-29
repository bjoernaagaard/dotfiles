# pi-codegraph

A Pi extension that embeds the official `@colbymchenry/codegraph@1.4.1` library in-process and exposes a fixed native tool catalog for the active project.

## Runtime contract

- Node.js `>=22.5 <25` is required because the library uses `node:sqlite`.
- The CodeGraph package is an exact runtime dependency. No global executable or companion process is required.
- The extension factory opens no database, watcher, timer, or background resource.
- Startup is lazy after `session_start` / `resources_discover` or the first tool/command call.
- One active project root is canonicalized and managed at a time. Concurrent first calls share one startup.
- Shutdown calls `unwatch()` and `close()` idempotently.
- No extension-specific environment variables are read. Runtime choices use Pi flags or explicit command arguments.
- Embedded SDK logging is silent by default so background diagnostics never write into Pi's transcript; watcher failures remain visible through CodeGraph status and host notifications.

## Install

```bash
pi install /path/to/pi-codegraph
```

Production installation includes `@colbymchenry/codegraph@1.4.1` and its matching platform bundle through normal package dependencies.

## Lifecycle and freshness

For an existing index, the manager calls `CodeGraph.open`, performs an incremental `sync`, refreshes an incomplete/outdated index when necessary, then starts `watch`. For a missing index, startup reports the missing state without creating anything. The first CodeGraph tool call asks for confirmation before calling `CodeGraph.init` followed by `indexAll`. Automatic creation remains available only when explicitly enabled with `--codegraph-auto-index`.

Source mutations mark the graph stale synchronously and schedule direct `graph.sync()` without reconnecting anything. Paths coalesce by root, and an edit arriving during sync schedules a second pass. Queries are rejected while stale, syncing, or failed.

Freshness sources:

- successful built-in Pi `edit` and `write` results
- the shared `pi:files-mutated:v1` event, including conservative same-root invalidations with no known paths
- pending paths reported by the official watcher

The shared event listener accepts the established version-1 payload and a compact version-1 payload containing `source`, canonical `projectRoot`, sorted project-relative `paths`, and `emittedAt`.

## Native tools

All tools use strict TypeBox object schemas, bounded parameters, active-root confinement, abort checks, and Pi's 50 KB / 2000-line output limits.

| Tool | Purpose |
|---|---|
| `codegraph_context` | Primary exploration: official `buildContext` with relevant source |
| `codegraph_node` | Read one indexed file or symbol with line-numbered source/outline and a compact dependency trail |
| `codegraph_files` | Indexed file tree with language and symbol counts, replacing broad filesystem discovery |
| `codegraph_search` | Bounded symbol search via `searchNodes` |
| `codegraph_callers` | Deterministic symbol resolution plus official caller edges |
| `codegraph_callees` | Deterministic symbol resolution plus official callee edges |
| `codegraph_impact` | Best-effort impact nodes and affected files |
| `codegraph_stats` / `codegraph_status` | Readiness, counts, freshness, watcher health, and profiling |

Ambiguous symbols are never guessed: targeted tools return sorted candidates and accept `filePath` or an exact node id for disambiguation. These native tools cover the official MCP explore, node, search, callers, callees, impact, files, and status capabilities while adding Pi-native freshness, truncation, trust, and abort metadata. Only these owned names are activated/deactivated; tools owned by other extensions are preserved.

**Follow-up TODO:** add a bounded per-root graph pool/cache so native tools can query arbitrary already-indexed `projectPath` roots like the MCP server. The current Pi-native contract intentionally confines queries to the active project root.

### Static-analysis boundary

CodeGraph is read-only here. Caller, callee, reference, and impact edges are useful evidence but can omit dynamic dispatch, generated code, reflection, and runtime wiring. This extension intentionally provides no graph-only rename or graph-aware source mutation.

For structural changes, compose CodeGraph discovery with a syntax-aware matcher such as ast-grep when available. For semantic rename and correctness, use an LSP/compiler, typecheck, and tests. `codegraph_impact` reports affected candidates; it is not a complete rename reference set.

### Independent and optional cross-support

The extension does not import or require `pi-ast-grep`. Its curated tool schemas, descriptions, and prompt guidelines stand alone; when ast-grep is active, graph-derived project-relative paths can be passed to `ast_grep_outline` and structural search. The handoff is advisory and never makes graph edges a complete reference set.

When both extensions are loaded, ast-grep applies emit the shared `pi:files-mutated:v1` event and CodeGraph invalidates/synchronizes its watcher without importing the ast-grep package. Built-in `edit`/`write` mutations are also tracked, so either extension remains useful on its own.

## Commands and Pi flags

`/codegraph` opens a choice menu in TUI mode. Direct subcommands remain available:

| Command | Behavior |
|---|---|
| `/codegraph status` | readiness, counts, freshness, watcher, and last timing |
| `/codegraph init` | create a missing graph or full-reindex via official `recreate` + `indexAll` |
| `/codegraph sync` | incremental direct-library sync |
| `/codegraph profile-on` | enable bounded local timing aggregates |
| `/codegraph profile-off` | disable profiling and clear aggregates |
| `/codegraph profile-report` | show the local aggregate report |

| Flag | Default | Meaning |
|---|---:|---|
| `--codegraph-auto-index` | `false` | Explicitly create a missing index after session start |
| `--codegraph-profile` | `false` | Enable `perf_hooks` instrumentation |
| `--codegraph-ascii-status` | `false` | Use ASCII separators in status text |

Profiling is local and sends no telemetry. Disabled profiling does not create aggregate entries. Enabled profiling records monotonic counts, failure counts, total/min/max/last/average duration, and successful output bytes for startup, official queries, sync, and mutation-to-fresh. Rejected operations are timed and aggregated without attempting output-size calculation.

CPU profiles and heap snapshots are intentionally out of scope. The extension does not open the inspector, capture process-wide runtime data, or write diagnostic artifacts; use Node's official local `--cpu-prof` / `--heap-prof` facilities around a dedicated Pi process when process-level investigation is required.

## TUI and non-TUI behavior

The extension uses only its own `ctx.ui.setStatus("codegraph", ...)` key. The compact segment includes direct-library state, file/node counts, freshness or pending count, watcher state, and the latest timing. It never replaces the footer, so other extension segments and Pi's built-in footer compose normally. ASCII status is available for terminals without powerline glyphs. SDK background logs are suppressed by default; lifecycle failures are represented in this status and in command/tool results instead of being printed into the transcript.

Tools do not depend on UI and return the same bounded machine-readable results in TUI, print, JSON, and RPC modes. Choice dialogs and notifications are confined to commands and guarded by mode/UI availability.

## Development

```bash
npm install
npm run typecheck
npm test
npm run smoke
npm run bench
```

`npm run smoke` creates a temporary TypeScript project and exercises direct init/index/search/context/callers/callees/impact/watch/sync/close. See [`docs/benchmarks/README.md`](docs/benchmarks/README.md) for the reproducible official-method benchmark.

## License

MIT
