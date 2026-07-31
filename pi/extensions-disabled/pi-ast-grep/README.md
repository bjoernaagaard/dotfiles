# pi-ast-grep

A strict TypeScript/ESM Pi extension for structural search, ast-grep rule development, advisory replacement previews, and direct native codemods.

## Mutation model

`ast_grep_codemod_apply` reruns a closed selector against the **current source** and invokes native ast-grep update-all mode:

- pattern selector: `ast-grep run … --rewrite … -U -- <paths>`
- inline/rule-file/project selectors: `ast-grep scan … -U -- <paths>`

The apply core validates the selector, builds one argv array, and performs exactly one cancellable subprocess call. It does not run a version probe, preview, source read, hash pass, journal, atomic rewrite layer, verification pass, or second ast-grep process.

There is deliberately no extension approval, selection, transaction, rollback, undo, or recovery API. Native ast-grep writes current files; use version control for recovery and compiler/LSP/tests for semantic verification.

## Advisory preview

`ast_grep_codemod_preview` is separate and read-only. It runs ast-grep JSON preview output, reads bounded current-source pre-images, and returns a model-facing page containing:

- exact file and source/replacement byte ranges
- exact `before` and `replacement` text
- source context
- rule id, severity, and message where available
- explicit overlap/conflict groups
- total files, replacements, pages, and findings without fixes
- normal Pi output truncation metadata

Preview data is ephemeral. The extension does not persist source snapshots, hashes, edit IDs, selections, or authorization artifacts. Apply never consumes preview output, so preview/apply is inherently TOCTOU: apply reruns the selector against whatever source exists then.

## Tools

| Tool | Behavior |
|---|---|
| `ast_grep_outline` | Read-only structural file/symbol outline. |
| `ast_grep_search` | Read-only pattern, inline-rule, rule-file, or configured-project-rule search. |
| `ast_grep_inspect` | Pattern/AST/CST query inspection. |
| `ast_grep_rule_test` | Isolated rule fixtures in a private temporary directory. |
| `ast_grep_project_rules` | Effective configured rule discovery without a source scan. |
| `ast_grep_codemod_preview` | Advisory paginated exact replacement reader. |
| `ast_grep_codemod_apply` | Direct current-source native `-U` apply in one subprocess. |

All schemas reject additional properties. Paths are project-confined, NUL bytes and irrelevant selector fields are rejected, argv is never shell-interpolated, cancellation/timeouts are preserved, and process/model output is bounded.

## Independent and optional cross-support

This extension works without CodeGraph. Its curated tool schemas, descriptions, and prompt guidelines encode the outline → inspect/test → search → preview/apply workflow. If CodeGraph is also active, its results can optionally narrow candidate paths before ast-grep matching; there is no package import or runtime dependency on CodeGraph.

Successful applies emit the shared `pi:files-mutated:v1` event. CodeGraph may consume that event to invalidate and synchronize its own index, but ast-grep never assumes that a graph exists.

Rule files and project configuration selectors are intentionally non-interactive and not trust-gated by this extension. They may influence the official ast-grep process, but cannot inject shell or arbitrary argv fields.

## Commands

- `/sg-review [selector-json]` — read an advisory preview. With no argument in TUI mode, a `SelectList` offers recent preview/apply selectors.
- `/sg-apply [selector-json]` — apply immediately. With no argument in TUI mode, a `SelectList` offers recent selectors; choosing one executes it immediately.
- `/sg-rules [filter]` — list effective configured rules.
- `/sg-status` — explicit ast-grep version/config diagnostics and optional local phase metrics.

Direct JSON arguments are retained for automation, for example:

```text
/sg-apply {"queryKind":"pattern","pattern":"foo($A)","rewrite":"bar($A)","language":"ts","paths":["src"]}
```

The tools and direct command arguments work in TUI, print, JSON, and RPC modes. Tool behavior never depends on project trust or UI availability. TUI-only list navigation is optional command UX, not an apply gate.

## Configuration

Runtime configuration is file-based only; this extension reads no extension-specific environment variables.

Global file:

```text
<agent-dir>/ast-grep.json
```

Project file:

```text
<cwd>/<Pi CONFIG_DIR_NAME>/ast-grep.json
```

Example:

```json
{
  "timeoutMs": 30000,
  "discoverSgConfig": true,
  "sgConfig": "sgconfig.yml",
  "profile": false,
  "statusStyle": "powerline",
  "limits": {
    "maxPaths": 64,
    "maxResults": 1000,
    "maxOutputBytes": 51200,
    "maxOutputLines": 2000,
    "maxProcessOutputBytes": 10485760,
    "maxProcessOutputLines": 100000
  }
}
```

Project limits may only tighten global limits. `sgConfig` is confined to the project, including symlink resolution. The executable is always resolved as `ast-grep` through normal `PATH` in production; tests inject an adapter/config explicitly. Arbitrary argv, executable overrides, and environment switches are not configuration options.

## UI composition

On session start the extension sets only its own compact footer segment with:

```ts
ctx.ui.setStatus("ast-grep", value)
```

`statusStyle` can be `powerline` (default) or `ascii`. Shutdown clears only the `ast-grep` key. The extension never calls `setFooter`, so built-in footer content and sibling extension segments remain composable.

## Mutation event

After a successful native apply returns, the extension synchronously emits `pi:files-mutated:v1`. Because ast-grep mutation output is not a stable changed-path protocol, the event carries the canonical project root with empty path arrays, meaning conservative same-root invalidation. Event delivery does not reread source, launch another process, or wait for graph synchronization. Failed, cancelled, timed-out, and no-match applies emit no success event.

## Profiling and benchmark

File configuration can explicitly enable local-only phase profiling. `src/profile.ts` uses Node's official [`node:perf_hooks`](https://nodejs.org/api/perf_hooks.html) `performance.mark()`/`performance.measure()` APIs. Disabled profiling does not construct or update a profiler in client calls. Metrics are bounded aggregates shown only by `/sg-status`; there is no telemetry.

CPU profiles and heap snapshots are intentionally out of scope. The extension does not open the inspector, capture process-wide runtime data, or write diagnostic artifacts; use Node's official local `--cpu-prof` / `--heap-prof` facilities around a dedicated Pi process when process-level investigation is required.

The release benchmark compares direct native `ast-grep -U` with `AstGrepClient.applyCodemod` through the real spawn adapter:

```bash
npm run benchmark
```

It prepares equivalent fixture trees outside timing, warms both arms, alternates order, restores fixtures outside timing, collects 21 samples per arm, checks one subprocess per sample and identical final bytes, reports raw samples/medians/p95/ratio/versions/fixture dimensions/order, and fails when:

```text
extension median - native median > max(native median * 5%, 20 ms)
```

## Development

Requires Node `>=22.5 <25` and ast-grep `0.44.1` for the currently verified JSON contracts.

```bash
npm install
npm run typecheck
npm test
npm run test:integration
npm run check
npm run benchmark
```

`npm run check` runs the deterministic typecheck and test suite. The timing gate remains an explicit release benchmark so routine checks are not failed by a single noisy host sample.
