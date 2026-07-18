# pi-dagster

Pi `0.80.8` package for self-hosted Dagster OSS: agent-first authoring, exploration, operations, and diagnosis.

- [Proposal](PROPOSAL.md) — implementation design (post Extension API review)
- [Verification sources](SOURCES.md)
- [Vendored snapshots](sources/)

## Intent

High-leverage **agent surface** for Dagster, not a TUI reimplementation of Dagit.

Default package: profiles, dynamic tools, GraphQL + `dg`, policy, tool-native workflow guidance, the explicit `diagnose-run` prompt template, local autocomplete, safe renderers, and hardened generic GraphQL escape hatches.
Opt-in (loaded, **behaviorally inert**): remote bridges, private model providers.

## Load this package

From a trusted project directory:

```bash
# one-shot from this package directory
pi -e .

# or absolute path from elsewhere
pi -e /path/to/pi-dagster

# or install into project settings
pi install -l /path/to/pi-dagster
```

Package entrypoints (`package.json` → `pi.extensions`):

- `extensions/core.ts` — composition root (runtime, tools, session hooks, policy, autocomplete)
- `extensions/remote.ts` — loaded, **behaviorally inert** by default
- `extensions/provider.ts` — loaded, **behaviorally inert** by default

## Footer status

The core entrypoint publishes one compact `dagster` segment through Pi's generic status API. It is safe with or without `pi-statusline`; the runtime attaches the current session status sink so profile, `dg dev`, watch, and connection changes remain visible without replacing the footer.

## Phase 5 status (default package complete for core polish)

Composable UX and hardened generics on top of Phases 0–4:

- Local `@asset` / `@job:name` / `#runId` autocomplete stacked on Pi's provider (cache-only; no network while typing)
- Command argument completions for profiles, runs, watches, incident actions, launch templates
- Compact safe tool renderers + audit/incident entry cards (no secret-bearing fields)
- `/dagster-search` read-only TUI overlay picker with RPC/text fallback
- AST-based GraphQL operation validation (aliases, fragments, multi-op `operationName`)
- Deterministic generic subscription collector (max/timeout/abort/error/cleanup + redacted overflow mode `0600`)
- Offline `schema:check` comparing pinned schema, `ROOT_FIELDS.md`, and runtime index
- CI: `npm run check` (typecheck + test + schema:check)
- `extensions/remote.ts` and `extensions/provider.ts` remain behaviorally inactive

```bash
npm install
npm run typecheck
npm test
npm run schema:check
npm run check
```

Tests mock `fetch` + WS — no live Dagster required for CI.

## Connect / operate loop

```bash
pi -e /path/to/pi-dagster

# /dagster-connect name=local graphqlHttp=http://127.0.0.1:3000/graphql
# or /dagster-dev start port=3000
# /dagster-search my_asset
# Type @ or # for local entity completions after search/inspect
# dagster_search_tools query "diagnose failure evidence compare"
# dagster_evidence_pack runId=…
# dagster_compare_run runId=…
# /dagster-incident <runId> hypothesis="one explicit hypothesis"
```

## Always-on tools

| Tool | Role |
|---|---|
| `dagster_search_tools` | Loader (additive `setActiveTools`) |
| `dagster_target_status` | Profile / trust / policy / project / dg / connection |
| `dagster_search` | Cross-entity catalog search |
| `dagster_get_context` | Compact context pack |
| `dagster_capabilities` | Version / permissions / locations |
| `dagster_graphql_query` | Read-only generic query (AST-validated; rejects non-queries) |

## Lazy tools (via `dagster_search_tools`)

| Tool | Risk | Role |
|---|---|---|
| `dagster_inspect_*` | read | Asset / run / job inspect |
| `dagster_schema_search` | read | Offline pinned GraphQL roots |
| `dagster_dg_command` | local_exec | Allowlisted local `dg` |
| `dagster_launch_run` | remote_launch | Launch job/asset run |
| `dagster_reexecute_run` | remote_launch | Reexecute from failure / all steps |
| `dagster_terminate_run` | remote_state | Terminate run(s) |
| `dagster_backfill` | launch / state | Partition backfill launch/cancel/resume |
| `dagster_schedule_control` | remote_state | Start/stop/reset schedule |
| `dagster_sensor_control` | remote_state | Start/stop/reset sensor |
| `dagster_reload_location` | remote_state | Reload code location |
| `dagster_graphql_mutation` | classified | Generic mutation escape hatch (AST risk) |
| `dagster_graphql_subscribe` | read | Bounded subscription collect |
| `dagster_watch_run` | read | Session run-log watch |
| `dagster_evidence_pack` | read | Bounded redacted failure evidence |
| `dagster_compare_run` | read | Diff against latest strictly comparable success |

## Workflow guidance

Guidance is embedded in the always-on loader metadata, tool descriptions and parameter schemas, command help, and a small state-aware `before_agent_start` context note. It is intentionally not a second bundled skill channel.

- Establish `dagster_target_status` / `dagster_get_context` first; try `dagster_search_tools` before assuming a capability is missing.
- Prefer typed tools, then use generic GraphQL or `dg` only as validated escape hatches. Run `dg check` after source/config changes; use `/dagster-dev` for the `dg dev` lifecycle.
- Diagnose with bounded redacted `dagster_evidence_pack`, compare only with a strictly comparable successful baseline, classify, remediate through policy-gated tools, then relaunch/reexecute and summarize ids rather than raw logs.
- Inspect before mutations. `confirmMutations` requires UI confirmation or allowed `force=true` in non-UI modes; `readOnly` blocks mutations regardless of force. Watches write to log paths and should be summarized rather than pasted.

`prompts/diagnose-run.md` remains an explicit prompt template for callers that choose to invoke it; it is not registered as a skill.

## Slash commands

- `/dagster` — help  
- `/dagster-connect` — profile setup  
- `/dagster-target [name]` — list / switch  
- `/dagster-status` — health summary  
- `/dagster-search <query>` — read-only catalog search (TUI overlay; text fallback)
- `/dagster-dev [status\|start\|stop]` — local webserver lifecycle  
- `/dagster-launch job=… \| assets=a,b` — guided launch  
- `/dagster-run <id> \| watch \| unwatch \| watches` — inspect / watch  
- `/dagster-incident <id> [hypothesis=…] \| show \| fork [hypothesis=…] \| clear` — incident state
- `/dagster-tools [list\|reset]` — dynamic tool set  

Use `/dagster` for the same compact workflow guardrails and command examples.

## Policy note

Mutations under `confirmMutations` (default) require UI confirmation.  
In print/json/rpc (`hasUI=false`), pass `force=true` or the call is **blocked**.  
`readOnly` / `--dagster-read-only` blocks all risks above `read`.

Secrets never enter autocomplete, tool renderers, status/widgets, overlay rows, generic details, overflow files, or audit/incident cards.

## Schema reachability

Pinned inventory (65 Query / 40 Mutation / 3 Subscription):

- Query → `dagster_graphql_query` (and typed tools)
- Mutation → typed tools or `dagster_graphql_mutation` (except `logTelemetry` / `setNuxSeen`)
- Subscription → `dagster_graphql_subscribe`

Run `npm run schema:check` to verify inventories against `sources/dagster-oss/graphql/schema.graphql`.
