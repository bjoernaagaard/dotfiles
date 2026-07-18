# Proposal: `pi-dagster`

**Status:** Implementation design (post adversarial review against Pi Extension API)  
**Target:** Pi Extension API `@earendil-works/pi-coding-agent@0.80.8`  
**Dagster pin:** OSS GraphQL schema at commit `ed9a1483a94831c6feefa333086c3d4efec05a4b`  
**Form:** One Pi package with filterable extension entrypoints, tool-native guidance, an explicit prompt template, and themes
**Goal:** Make Pi a high-leverage **agent surface** for self-hosted Dagster OSS — author, explore, operate, and diagnose — without reimplementing Dagit.

Verification sources for every Pi and Dagster claim live in [`SOURCES.md`](SOURCES.md) and [`sources/`](sources/).

---

## 0. Design principles

1. **Agent leverage over UI parity.** Prefer typed tools, self-describing schemas, focused workflow guidance, and small status surfaces over recreating Dagit graphs, Gantt charts, and full consoles in the TUI.
2. **Docs-faithful Pi usage.** Follow `extensions.md` contracts for dynamic tools, session replacement, modes, truncation, overrides, and package manifests. Do not invent parallel mechanisms.
3. **Additive tool loading.** Register a large catalog; keep a tiny active set; load more only through a search loader. Never thrash the active set for “policy modes.”
4. **Fail closed without UI.** Mutating and destructive operations require confirmation when `ctx.hasUI`; in `print`/`json` they require explicit flags or are blocked.
5. **Opt-in blast radius.** Remote execution, infra adapters, model providers, and telemetry sinks are **behaviorally disabled by default** and require explicit runtime configuration. Package filters may omit their entrypoints entirely.
6. **Tools teach and act.** Tool descriptions/schemas, loader metadata, command help, and a bounded state-aware prompt hook carry workflow guidance. Tools execute validated GraphQL/`dg` operations and return structured evidence.
7. **Ownership over coverage.** Subscribe only to events with a named owner, invariant, and test. Unused ExtensionAPI surface is left unused on purpose.
8. **Generics complete the schema; typed tools complete the UX.** Exhaustiveness is satisfied by typed tools **or** generic GraphQL/`dg` escape hatches, not by one tool per field.

---

## 1. Product scope

### 1.1 In scope (default package)

| Mode | User outcome |
|---|---|
| **Build** | Scaffold and validate Dagster projects via `create-dagster` / `dg`; map definitions to source; agent-assisted authoring guided by tool contracts and command help |
| **Explore** | Search assets, jobs, schedules, sensors, resources, partitions, checks; inspect lineage, health, config schemas, instance state |
| **Operate** | Launch, monitor, reexecute, terminate, backfill, reload locations; stream logs; manage schedules/sensors/automation |
| **Diagnose** | Collect failure evidence, classify, compare to last success, propose remediations, revalidate, relaunch |

Supported targets:

- Local Dagster projects (`dg`, `uv run dg`)
- Local `dg dev` instances
- Remote self-hosted Dagster webservers (HTTP GraphQL + WS subscriptions)
- Multiple named profiles in one session
- Modes: `tui`, `rpc`, `json`, `print`

### 1.2 Explicit non-goals (default package)

| Non-goal | Rationale |
|---|---|
| Pixel parity with Dagit (full interactive asset graph, Gantt, heatmaps as primary UX) | TUI cost >> agent value; deep links + structured summaries win |
| Native React pages inside Dagster web UI | Outside ExtensionAPI |
| Permanent daemon after Pi exits | Session-scoped resources only |
| Bypassing Dagster permissions or reverse-proxy auth | Client honors server `permissions` |
| Remote filesystem without an explicit bridge | Dagster has no generic remote FS API |
| Bundled private LLM gateway as default | Separate opt-in module; different product risk |
| Inference-as-Dagster-job model provider | Experimental opt-in only; not required for control plane |
| Docker/Kubernetes cluster administration as core | Installation-specific; opt-in `remote`/`infra` module |
| “Use every Pi ExtensionAPI method/event” | Vanity coupling; conflicts with composition |

### 1.3 Exhaustiveness rule

Pinned inventory ([`sources/dagster-oss/graphql/ROOT_FIELDS.md`](sources/dagster-oss/graphql/ROOT_FIELDS.md)):

- **65** query fields
- **40** mutation fields
- **3** subscription fields

**Rule:** every root field is reachable by (a) a typed tool, (b) `dagster_graphql_query` / `_mutation` / `_subscribe`, or (c) documented as intentionally unsupported with reason (e.g. UI-only NUX telemetry).

Typed tools exist for high-frequency agent workflows. Generics exist so schema growth does not block operators.

---

## 2. Architecture

```text
Pi TUI / RPC / JSON / Print
          │
          ▼
┌──────────────────────────────────────────────────────────┐
│ pi-dagster package                                       │
│                                                          │
│  extensions/                                             │
│    core.ts        default composition root               │
│    remote.ts      SSH/ops bridges      [loaded, inactive] │
│    provider.ts    private gateway      [loaded, inactive] │
│                                                          │
│  src/modules/                                            │
│    author.ts      local dg/scaffold registration         │
│    operate.ts     runs, backfills, logs, automation      │
│    ui.ts          commands, status, overlays, complete   │
│                                                          │
│  src/                                                    │
│    clients/   GraphQL HTTP + WS, dg CLI, capability      │
│    domain/    asset/run/job/automation pure logic        │
│    policy/    risk classes, confirm, redact, audit       │
│    tools/     register + search index + active set       │
│    state/     session reconstruct, profiles, watches     │
│    render/    tool renderers, entry cards                │
│    generated/ GraphQL types from pinned schema           │
│                                                          │
│  prompts/  themes/  (tool-native guidance in src/)       │
└──────────────────────────────────────────────────────────┘
          │
          ├── Local project / dg adapter
          ├── GraphQL HTTP adapter
          ├── GraphQL subscription adapter (session-scoped)
          └── Optional remote bridge (remote.ts only)
```

### 2.1 Connection profiles

Named targets (`local-dev`, `staging`, `production`, …) stored under project config using `CONFIG_DIR_NAME` (never hardcode `.pi`):

```text
{ctx.cwd}/{CONFIG_DIR_NAME}/dagster/profiles.json
```

Profile fields:

| Field | Purpose |
|---|---|
| `projectRoot` | Workspace/project root for `dg` |
| `dgCommand` | `dg` \| `uv run dg` \| custom argv |
| `graphqlHttp` / `graphqlWs` | Endpoints |
| `pathPrefix` | Webserver path prefix |
| `browserUrl` | Deep links |
| `headersResolver` | Env / `!command` secret resolution — values never enter LLM context |
| `defaultLocation` / `defaultRepository` | Selectors |
| `policy` | `readOnly` \| `confirmMutations` \| `allowMutations` (+ destructive still always confirmed when UI) |
| `subscription` | prefer WS vs poll |
| `redaction` | extra key patterns |

Capability detection (cached briefly, revalidated before mutations):

- Dagster `version`
- `permissions` / `canBulkTerminate`
- Workspace / location load errors
- Schema introspection fingerprint vs pinned generated types
- Local `dg` availability and JSON-capable commands

### 2.2 Shared runtime (single module graph)

`core.ts` is the single default composition root. Its factory calls `createRuntime(pi)` exactly once, then passes that runtime explicitly to `registerAuthor`, `registerOperate`, and `registerUi` functions imported from `src/modules/`. Do **not** rely on a process-global or imported module singleton: Pi reload/session replacement creates a new extension runtime, and separately loaded entrypoints must not assume shared module cache state.

The runtime owns:

- Profile store + active target
- GraphQL client + subscription manager
- Policy engine
- Tool catalog + search index
- Watch registry (runs/backfills/ticks)
- `pi.events` namespaced bus: `dagster:*`

The separate opt-in `remote.ts` and `provider.ts` entrypoints communicate with core only through typed, namespaced `pi.events` contracts; they do not reach into a module singleton. On `session_shutdown` / reload: close WS, kill child `dg dev`, clear timers, drop watches. Cleanup is idempotent.

**Factory rule (from docs):** never start processes, sockets, watchers, or timers in the extension factory. Only register tools/commands/handlers. Start resources on `session_start` or first use.

---

## 3. Package decomposition and load filters

### 3.1 `package.json` shape

```json
{
  "name": "pi-dagster",
  "version": "0.1.0",
  "keywords": ["pi-package", "dagster"],
  "peerDependencies": {
    "@earendil-works/pi-ai": "*",
    "@earendil-works/pi-agent-core": "*",
    "@earendil-works/pi-coding-agent": "*",
    "@earendil-works/pi-tui": "*",
    "typebox": "*"
  },
  "dependencies": {
    "graphql": "...",
    "graphql-ws": "..."
  },
  "pi": {
    "extensions": [
      "./extensions/core.ts",
      "./extensions/remote.ts",
      "./extensions/provider.ts"
    ],
    "prompts": ["./prompts"],
    "themes": ["./themes"]
  }
}
```

`remote.ts` and `provider.ts` are in the manifest so Pi can discover and filter them, but their factories are **behaviorally inert by default**: they may register namespaced setup commands/flags and passive handlers, but they must not override built-ins, open resources, or register a provider until the user explicitly enables the capability. This avoids a package-filter trap: filters narrow the manifest's resource set; they cannot activate an entrypoint omitted from the manifest.

Users may omit either entrypoint entirely with a package filter:

```json
{
  "packages": [
    {
      "source": "git:github.com/.../pi-dagster",
      "extensions": [
        "extensions/*.ts",
        "!extensions/remote.ts",
        "!extensions/provider.ts"
      ]
    }
  ]
}
```

Runtime enablement is explicit through namespaced flags/configuration or a setup command. `pi config` may disable either discovered entrypoint.

Runtime deps must live in `dependencies` (Pi uses production installs / `omit=dev` for npm packages).

### 3.2 Entry/module responsibilities

| Unit | Kind | Default | Owns |
|---|---|---|---|
| `extensions/core.ts` | composition root | on | Runtime creation; profiles, clients, policy, all default tool/command/event registration, session state, bus |
| `src/modules/author.ts` | registration module | on through core | Project discovery, `dg` scaffolding/check/list, source index helpers, authoring tools |
| `src/modules/operate.ts` | registration module | on through core | Typed run/asset/automation/instance tools, subscriptions, watches, follow-ups |
| `src/modules/ui.ts` | registration module | on through core | Slash commands, shortcuts, status/widget, autocomplete, overlays, entry/message renderers |
| `extensions/remote.ts` | extension entrypoint | loaded, **inactive** | Explicitly enabled built-in tool operations overrides, `user_bash` bridge, optional infra adapters |
| `extensions/provider.ts` | extension entrypoint | loaded, **inactive** | Explicitly enabled `registerProvider`, OAuth, header correlation |

Composition rule: only `remote.ts` may override built-in tools. Only core's policy registration may block via `tool_call`. UI never mutates server state except through domain tools/commands that call the runtime.

---

## 4. Dynamic tool loading (normative)

This section is the implementation contract. Normative references:

- Pi docs: Dynamic Tool Loading
- Examples: deferred-loading pattern in docs; `kimi-deferred-tools.ts`; `plan-mode` for `setActiveTools` policy

### 4.1 Lifecycle

```text
extension factory
  └─ registerTool() for EVERY dagster tool (including lazy ones)
  └─ register loader: dagster_search_tools (has promptSnippet + guidelines)

session_start
  └─ reconstruct runtime state from branch
  └─ setActiveTools(
        preserve foreign tools + builtins we didn't own,
        drop SEARCHABLE_DAGSTER_TOOLS,
        ensure ALWAYS_ON_DAGSTER_TOOLS
     )

model turn
  └─ tiny active set in prompt / tool list

dagster_search_tools.execute
  └─ rank catalog by query
  └─ pi.setActiveTools([...getActiveTools(), ...added])  // ADDITIVE ONLY
  └─ return { matches, added } in content + details

next model request
  └─ native deferred load (Anthropic Sonnet/Opus/Fable 4.5+, excluding Haiku;
     OpenAI gpt-5.4+ family)
     or full active list fallback for other models
```

### 4.2 Always-on vs searchable

**Always on** (small):

| Tool | Role |
|---|---|
| `dagster_search_tools` | Loader |
| `dagster_target_status` | Active profile, health, permissions |
| `dagster_search` | Cross-entity search (assets/jobs/runs/…) |
| `dagster_get_context` | Compact task context pack |
| `dagster_capabilities` | Version, permissions, schema drift notes |
| `dagster_graphql_query` | Read-only generic escape hatch (still policy-gated if path looks mutating — queries only) |

**Searchable (registered, initially inactive):** all typed domain tools + `dagster_graphql_mutation` + `dagster_graphql_subscribe` + `dagster_dg_command` + destructive tools.

### 4.3 Hard rules

1. **Additive activation only** for normal loading. Never remove tools inside the loader.
2. **Policy is not active-set thrash.** Read-only profiles block in `tool_call` / execute, they do not `setActiveTools(readOnlySubset)` every turn.
3. Lazy tools **omit** `promptSnippet` and `promptGuidelines` so activation does not change the rebuilt system-prompt content or bust the stable prompt prefix.
4. Loader **keeps** `promptSnippet` + named `promptGuidelines` (`Use dagster_search_tools when…`).
5. Names passed to `setActiveTools` must already be registered; unknown names are ignored by Pi — treat that as a test failure in our catalog.
6. Preserve non-Dagster active tools and deduplicate names:  
   `setActiveTools([...new Set([...current.filter(n => !OUR_LAZY.has(n)), ...alwaysOn, ...previouslyLoadedDagster])])`  
   Reconstruct `previouslyLoadedDagster` as the branch-order union of loader results’ `details.added` (and accept Pi's top-level `addedToolNames` as corroborating metadata). Pi itself annotates a purely additive loader result; `details.added` is our stable, typed replay record.
7. Optional operator command `/dagster-tools reset` may non-additively shrink back to always-on (documents cache invalidation; not used mid-loader).

### 4.4 Search index

Each registered tool declares offline metadata (not necessarily in the LLM schema):

```ts
type ToolMeta = {
  name: string;
  risk: RiskClass;
  entities: Array<"asset" | "run" | "job" | "schedule" | "sensor" | "backfill" | "instance" | "project" | "graphql" | "dg">;
  verbs: string[];       // launch, inspect, terminate, ...
  graphqlFields?: string[];
  dgCommands?: string[];
  keywords: string[];
};
```

`dagster_search_tools` ranks by keyword overlap first; later BM25/embeddings optional. Returns top N (default 5, max 12).

### 4.5 Tool implementation standards

Every tool:

| Concern | Standard |
|---|---|
| Schema | `typebox` + `StringEnum` from `@earendil-works/pi-ai` for string enums |
| Errors | **throw** to signal failure (`isError: true`); never fake errors via return shape |
| Cancel | honor `signal` / `ctx.signal` |
| Progress | `onUpdate` for long ops; single live renderer, not log spam |
| Truncation | `truncateHead` / `truncateTail` + temp file path; document limits in description |
| File mutation | `withFileMutationQueue(absPath, …)` for any write/edit |
| Paths | strip leading `@` if accepting paths |
| Compat | `prepareArguments` for resumed sessions when schemas evolve |
| Details | put reconstructable state in `details` for branch replay |
| Terminate | `terminate: true` only for explicit “final answer” style tools if added later |
| Render | optional `renderCall` / `renderResult`; `renderShell: "self"` only when default box fights live views |

---

## 5. Domain capability catalog

Capabilities below are **product requirements**. Implementation may use typed tools, generics, or `dg` — mapped in §5.5 and Appendix A.

### 5.1 Project and local `dg`

- Detect `pyproject.toml`, `dg.toml`, workspace/project roots, `definitions.py`, `defs/`, component YAML, `.env.example`
- Resolve `dg` vs `uv run dg`
- Scaffold via official `create-dagster` / `dg scaffold` (never hand-roll layouts)
- `dg check defs|yaml|toml`, `dg list defs|envs|projects|components|component-tree` (JSON when available)
- Start/stop/monitor `dg dev`; wait for GraphQL readiness; capture startup errors
- `dg launch` for local execution with abort + log files when truncated
- Compare local source revision vs connected server when possible

### 5.2 Catalog and lineage

- Search/list assets with selection syntax, groups, owners, kinds, tags, locations
- Upstream/downstream bounded traversal; critical path summaries (text/structured, not full canvas-first UX)
- Materializations, observations, checks, freshness, data/code versions, partition defs
- Deep link to Dagit browser URL for heavy visualization

### 5.3 Runs, logs, reexecution

- List/filter runs; inspect config, tags, steps, stats
- Stream structured events + compute logs (subscription or poll)
- Reexecute (full / from failure / step subset / asset+partition subset)
- Terminate one or many; delete runs only under destructive policy
- Queue/concurrency explanations from instance APIs

### 5.4 Partitions and backfills

- Partition status tables (text/structured); multidimensional keys
- Dynamic partition add/delete
- Backfill preview, launch, monitor, resume, reexecute, cancel
- Smallest failed subset suggestion for retry

### 5.5 Jobs, config, plans

- Job/graph/op inspection
- Run config schema validation (`isPipelineConfigValid`, `runConfigSchemaOrError`)
- Execution plan preview
- Launch single/multiple runs

### 5.6 Schedules, sensors, declarative automation

- List/start/stop/reset; dry-run; tick history; cursor get/set
- Automation condition evaluation trees → human explanations
- Pause/resume auto-materialize where permitted

### 5.7 Instance and locations

- Workspace/locations load status; reload; shutdown location
- Daemon/scheduler health; concurrency limits/slots
- Permissions display; migration/capability warnings

### 5.8 Diagnosis workflow

Evidence pack (tool or command):

1. Error chain + step events + compute log tails  
2. Run config (redacted) + tags + partition  
3. Upstream materializations / failed checks  
4. Location errors + recent definition collisions if relevant  
5. Diff vs last successful run when available  

Then: classify → optional session fork for hypothesis → remediation via author tools → validate (`dg check`) → relaunch → summarize.

### 5.9 Generics (always available strategy)

| Tool | Maps to |
|---|---|
| `dagster_graphql_query` | arbitrary query + variables + validation |
| `dagster_graphql_mutation` | lazy; same policy as typed mutations |
| `dagster_graphql_subscribe` | lazy; session-scoped stream into tool updates / files |
| `dagster_schema_search` | search pinned + live schema |
| `dagster_dg_command` | allowlisted `dg` subcommands with JSON when possible |
| `dagster_dg_response_schema` | discover CLI JSON shapes |
| `dagster_search_tools` | dynamic activation |
| `dagster_capabilities` | version/permissions/drift |

---

## 6. Risk classes and policy

### 6.1 Classes

| Class | Examples | Default |
|---|---|---|
| `read` | search, inspect, logs (read), schema | allow |
| `local_source` | write/scaffold project files | confirm if UI; flag in print |
| `local_exec` | `dg dev`, `dg launch`, checks | confirm first start / destructive stop |
| `remote_launch` | launch run/backfill | confirm per profile policy |
| `remote_state` | start/stop schedule/sensor, reload location, concurrency | confirm |
| `destructive` | delete run, wipe assets, shutdown location, free all slots | always confirm if UI; block in print/json without `--i-know` style explicit tool param |
| `secret` | show resolved secret values | never to LLM; separate explicit user command only |
| `infra` | docker/k8s (remote module) | confirm + module enabled |

### 6.2 Enforcement map (Pi hooks)

| Hook | Policy use |
|---|---|
| `tool_call` | Block/confirm by tool risk + profile; mutate args only with care (**no re-validation** after mutate) |
| `tool_result` | Redact secrets; truncate; attach normalized error unions |
| `user_bash` | Intercept `dg`/dangerous patterns; optional remote ops from `remote.ts` |
| Tool `execute` | Second line of defense; honor signal; throw on deny |
| Commands | Same policy helpers as tools |

**Parallelism:** do not assume sibling tool results are visible in `tool_call`. File editors use `withFileMutationQueue`.

**Read-only profile:** block classes above `read` even if tools are active.

### 6.3 Secrets

- Never put secret values in tool `content`, custom messages, or session entries meant for LLM
- Redact headers, env, config fields by key patterns
- Prefer env / `!command` resolvers; resolved values stay in process memory for HTTP headers only
- `details` may store `redacted: true` markers, not values

### 6.4 Audit

Mutations append **TUI-only** custom entries via `pi.appendEntry("dagster.audit", …)` + `registerEntryRenderer`.  
Not sent to the LLM. Optional later sink is out of default scope.

---

## 7. Session state, branching, replacement

### 7.1 State tiers

| Tier | Mechanism | LLM? | Use |
|---|---|---|---|
| A | Tool result `details` on branch | **no** (state/render metadata; mirror model-relevant facts in `content`) | Active target id, loaded tools, last run id, watch handles metadata |
| B | `pi.appendEntry` | no | Audit cards, incident timeline UI |
| C | `pi.sendMessage` custom | yes | Compact context the model must see |
| D | In-memory runtime | no | WS sockets, child processes — rebuilt/closed on session events |

**Reconstruction (docs pattern):** on `session_start`, walk `ctx.sessionManager.getBranch()`, rebuild from tool results and custom entries. Do not rely on process globals across reload/fork.

### 7.2 Session replacement footguns (normative)

When using `ctx.newSession` / `fork` / `switchSession`:

1. Capture **plain data only** before replacement (ids, profile name, summary strings).
2. Use only `withSession`’s fresh `ctx` after switch.
3. Never call old `pi` / old `sessionManager` after replacement.
4. Assume `session_shutdown` already closed watches/sockets.
5. After `ctx.reload()`, treat handler as terminal (`return` immediately).

Incident “fork hypothesis” command must follow this pattern and re-apply active profile by name in the new session.

### 7.3 Compaction

`session_before_compact` may return a **custom summary** that preserves:

- active profile name + policy
- entity ids (asset keys, run ids, backfill ids)
- mutations performed + outcomes
- open hypothesis one-liner
- pointer to audit entry ids

Do not dump raw logs into the summary. Use `reason` / `willRetry` to avoid fighting overflow recovery.

### 7.4 Labels and names

- `pi.setSessionName` → `dagster:<profile>:<object>`
- `pi.setLabel` on checkpoints before destructive ops / remediations

### 7.5 Watches and follow-ups

Session-scoped watchers (run, backfill, tick):

| Outcome | Delivery |
|---|---|
| Urgent failure while agent running | `sendMessage` / `sendUserMessage` with `deliverAs: "steer"` or `"followUp"` as appropriate |
| Completion while idle | `sendUserMessage(..., { deliverAs })` + optional `triggerTurn` only when analysis requested |
| Routine success | `notify` only (no model) when `hasUI` |

Use **`agent_settled`** (not merely `agent_end`) when deciding the agent will not auto-continue. Clean watches on `session_shutdown`.

---

## 8. Pi-native UX

### 8.1 Commands (ui.ts)

```text
/dagster                 # palette / help
/dagster-connect         # interactive profile setup
/dagster-target          # switch/list targets
/dagster-status          # health + permissions
/dagster-search          # entity search UI
/dagster-run             # inspect/watch run
/dagster-launch          # guided launch
/dagster-logs            # log viewer / tail
/dagster-dev             # local dg dev control
/dagster-incident        # evidence pack + handoff
/dagster-tools           # list/reset dynamic tools
/dagster-settings        # policy, redaction, subscriptions
```

Each mutating command shares policy helpers with tools.  
Argument completion via `getArgumentCompletions` (profiles, asset keys, run ids, jobs, locations).

Optional flags (`registerFlag`):

- `--dagster-profile <name>`
- `--dagster-read-only`
- `--dagster-graphql <url>` (ephemeral override)

### 8.2 Shortcuts

Namespaced, documented conflicts with user keybindings:

- Open status / cycle target / abort watch / focus active run  

Prefer few shortcuts; discoverability via commands first.

### 8.3 Status surfaces (default)

- `setStatus("dagster", …)` — profile, location errors, active run count  
- Optional `setWidget` for single active watch  
- **Do not** replace footer/header/editor by default (composition-hostile). No `setFooter` / `setEditorComponent` in default modules.

### 8.4 Overlays (limited)

`ctx.ui.custom` / experimental overlay **only** for:

- profile picker / settings  
- run inspector (steps + truncated logs)  
- confirmation payloads for destructive ops  

Always provide RPC text fallback (`ctx.mode !== "tui"` → `select`/`confirm`/`notify` or pure text).  
`custom()` is undefined in RPC — never require it for core operate paths.

### 8.5 Autocomplete

`ctx.ui.addAutocompleteProvider` stacking:

- `@` asset keys / jobs  
- `#` run ids  
- delegate otherwise to `current`

### 8.6 Rendering

- Live run tool: stable component via `context.lastComponent` / `context.state` + `onUpdate`  
- Destructive tools: distinct styling; `renderShell: "self"` only if needed  
- Validation: diagnostics grouped by file  
- GraphQL errors: union type + python error message + remediation hint  

### 8.7 Deep links

Prefer opening/linking Dagit for heavy graph visualization rather than reimplementing canvas navigation.

---

## 9. Agent integration (owned events only)

### 9.1 Event ownership matrix

| Event | Owner | Invariant |
|---|---|---|
| `project_trust` | core (user/global install only) | May decide trust for project Dagster config; return yes/no/undecided per docs |
| `session_start` | core | Restore state; init active tools; start no resources until needed |
| `session_shutdown` | core | Idempotent close of WS, children, watches |
| `session_before_switch` / `_fork` | core | Warn/cancel if active `dg dev` or destructive mid-flight |
| `session_before_compact` / `session_compact` | core | Dagster-aware summary |
| `session_before_tree` / `session_tree` | core | Optional branch summary; restore profile by name |
| `session_info_changed` | ui | Optional status refresh |
| `before_agent_start` | core | Inject **small** state-aware target/policy/workflow context; keep canonical workflow rules in tools/commands |
| `context` | core | Redact; replace huge logs with file refs; keep ids |
| `tool_call` / `tool_result` | core | Policy + redaction |
| `user_bash` | core (+ remote if enabled) | `dg` safety / remote ops |
| `tool_execution_*` | ui/operate | Live render coordination only if needed |
| `agent_settled` | operate | Flush non-urgent watch notifications |
| `input` | ui | Optional `@asset` / `#run` expansion |

**Not subscribed by default:** `before_provider_*`, `after_provider_response`, `model_select`, `thinking_level_select`, `message_*` rewriting — reserved for opt-in `provider.ts` or future telemetry.

### 9.2 System prompt injection

`before_agent_start` adds only:

- active profile + policy  
- cwd/project root  
- 0–3 relevant entity ids if known  
- “call `dagster_search_tools` before assuming a Dagster capability is missing”  
- never dump catalog snapshots  

Do not paste a full workflow document into the active prompt; tool descriptions, loader metadata, command help, and the explicit prompt template remain the canonical surfaces.

### 9.3 Guidance and prompts

Tool-native guidance covers project setup/check/dev, target-first exploration, policy-gated operations, bounded evidence/baseline diagnosis, and cache-only autocomplete. Lazy tools intentionally omit active prompt metadata.

The retained explicit prompt template is:

- `prompts/diagnose-run.md` — evidence → strict baseline comparison → classification → policy-gated remediation → `dg check` → relaunch summary.

Themes optional (`dagster-dark` / `dagster-light`) — cosmetic only.

---

## 10. Mode matrix

| Feature | tui | rpc | json | print |
|---|---|---|---|---|
| Read tools | yes | yes | yes | yes |
| Dynamic tool load | yes | yes | yes | yes |
| Confirm mutations | dialogs | dialogs | **block** unless explicit tool force param | **block** unless force |
| Overlays / `custom()` | yes | no (text/dialogs) | no | no |
| Status/widget | yes | best-effort protocol | no-op | no-op |
| Watches + notify | yes | notify protocol | events only | stdout summaries |
| `dg dev` child | yes | yes | yes | yes (must clean on shutdown) |
| Secret display | never default | never default | never | never |

Guard with `ctx.mode === "tui"` for terminal-only and `ctx.hasUI` for dialogs.

Trust: use `ctx.isProjectTrusted()` before reading project-local profile/secret resolver config.

---

## 11. Remote module (opt-in)

When `remote.ts` enabled:

1. Prefer **operations injection** (`createReadTool`, `createBashTool`, `ReadOperations`, …) over full reimplementation.
2. Preserve built-in result `details` shapes exactly.
3. Re-declare `promptSnippet` / `promptGuidelines` if overriding tools (not inherited).
4. Handle `user_bash` via `createLocalBashOperations()` wrap or remote ops.
5. Use `spawnHook` for env/cwd injection when staying local.
6. Register `--dagster-remote` flag pattern (see Pi `ssh.ts` example).
7. Policy still flows through core `tool_call`.

Infra adapters (compose/k8s) are optional helpers behind explicit tools, not ambient magic.

---

## 12. Provider module (opt-in)

When `provider.ts` enabled:

- `registerProvider` / `unregisterProvider` for private gateways  
- `refreshModels` for live catalogs  
- OAuth via provider `oauth` config for `/login`  
- `before_provider_headers` for correlation ids (session id, profile name) — never secrets  
- Document interaction with deferred tool loading: custom gateways need `compat.supportsToolReferences` / `supportsToolSearch` only if they truly support native protocol  

Dagster-backed inference provider remains a documented experiment, not a default deliverable.

---

## 13. Repository layout

```text
pi-dagster/
├── package.json
├── README.md
├── PROPOSAL.md
├── SOURCES.md
├── sources/                    # vendored verification snapshots
├── extensions/
│   ├── core.ts                 # default composition root
│   ├── remote.ts               # loaded, behaviorally inactive
│   └── provider.ts             # loaded, behaviorally inactive
├── src/
│   ├── runtime.ts
│   ├── modules/
│   │   ├── author.ts
│   │   ├── operate.ts
│   │   └── ui.ts
│   ├── clients/
│   ├── domain/
│   ├── policy/
│   ├── tools/
│   │   ├── catalog.ts          # metadata + registration
│   │   ├── loader.ts           # dagster_search_tools
│   │   ├── always-on/
│   │   └── lazy/
│   ├── state/
│   ├── render/
│   └── generated/
├── prompts/
├── themes/
└── tests/
```

---

## 14. Implementation plan

Phased delivery **without** abandoning domain breadth: each phase ships usable agent value and stays docs-correct.

### Phase 0 — Skeleton

- Package manifest, peerDeps, empty extensions, CI typecheck against `0.80.8`
- Runtime + profile store + `CONFIG_DIR_NAME` paths + trust checks
- Always-on tools + loader with additive `setActiveTools`
- Mode-safe logging; session_shutdown idempotent cleanup
- Tests: active set preservation, additive load, foreign tools preserved

### Phase 1 — Read path

- GraphQL client, capabilities, permissions
- Search + asset/run/job inspect tools (lazy)
- `dagster_graphql_query` + schema search
- `/dagster-connect`, `/dagster-target`, status line
- Skills: explore/operate basics

### Phase 2 — Local author

- `dg` adapter, check/list/scaffold wrappers
- `dg dev` lifecycle
- Source path helpers
- `withFileMutationQueue` for any file-writing tool
- Skill alignment with `create-dagster` / `dg scaffold`

### Phase 3 — Mutating operate

- Launch, reexec, terminate, backfill, schedule/sensor mutations
- Policy + confirm + audit entries
- Subscriptions for run logs + location changes
- Watches + `agent_settled` follow-up rules
- Print/json fail-closed tests

### Phase 4 — Diagnose

- Evidence pack tool
- Compare last success
- Incident command + safe fork handoff (`withSession` pattern)
- Compaction summary

### Phase 5 — Polish / opt-in

- Autocomplete, richer renderers, limited overlays
- Generic mutation/subscribe tools hardened
- Schema-diff CI vs pinned `schema.graphql`
- Optional `remote.ts` / `provider.ts`

---

## 15. Testing strategy (practical)

Must-pass before claiming Phase N done:

| Area | Tests |
|---|---|
| Dynamic tools | session_start active set; additive load; loader does not remove; lazy tools lack prompt metadata; foreign tools preserved; Pi records top-level `addedToolNames` |
| Policy | each risk class allow/confirm/block; no UI fail-closed; read-only profile |
| Redaction | secrets never in content/messages; adversarial GraphQL payloads |
| Truncation | >50KB and >2000 lines → temp file + notice |
| Session | reconstruct after reload; fork withSession safety; shutdown closes WS/child |
| Modes | tui/rpc/json/print matrix for launch + inspect |
| GraphQL | contract tests for typed ops against test instance; union errors |
| dg | JSON fixtures from vendored CLI surfaces |
| Parallel | file mutation queue with concurrent edit |
| Schema | CI diff pinned schema → open checklist for new roots |

Do **not** require “every ExtensionAPI method has a call site.”

---

## 16. Definition of done

`pi-dagster` default package is done when:

1. **Reachability:** every pinned GraphQL root is typed, generic, or explicitly unsupported (Appendix A).  
2. **Local loop:** project detect → check → dev → launch → inspect logs works in TUI and print.  
3. **Dynamic tools:** docs lifecycle implemented and tested (additive loader, cache-safe metadata rules).  
4. **Policy:** all non-read classes enforced via hooks + execute; fail-closed without UI.  
5. **Session safety:** replacement/reload/shutdown invariants hold; no resource leaks.  
6. **Modes:** core operate/inspect paths work without `custom()` overlays.  
7. **Composition:** default modules do not steal footer/editor/builtin tools; remote/provider remain opt-in.  
8. **Guidance:** loader/core/tool/command surfaces make the agent successful with the small always-on tool set; the explicit diagnose prompt remains separately invokable.
9. **Pins:** Pi `0.80.8` and Dagster schema commit verified via [`SOURCES.md`](SOURCES.md).

---

## 17. Boundaries (unchanged truths)

The package cannot by itself:

- Add native React pages to Dagit  
- Create server capabilities not exposed by GraphQL/CLI/bridge  
- Bypass server permissions  
- Access remote code-location files without a bridge module  
- Run after Pi exits  
- Guarantee inline images or experimental overlay behavior on all terminals  
- Guarantee stability of GraphQL fields marked evolving/internal — generics + capability detection absorb drift  

---

## Appendix A — GraphQL root field strategy

Authoritative list: [`sources/dagster-oss/graphql/ROOT_FIELDS.md`](sources/dagster-oss/graphql/ROOT_FIELDS.md).  
Strategy codes: **T** typed tool(s), **G** generic query/mutation/subscribe, **U** unsupported (document why).

### Queries (65)

| Field | Strategy | Notes |
|---|---|---|
| `version` | T | capabilities |
| `repositoriesOrError` | T | locations/repos |
| `repositoryOrError` | T/G | |
| `workspaceOrError` | T | |
| `locationStatusesOrError` | T | |
| `workspaceLocationEntryOrError` | T/G | |
| `pipelineOrError` | T | jobs |
| `resourcesOrError` | T/G | |
| `pipelineSnapshotOrError` | T/G | |
| `graphOrError` | G | |
| `scheduler` | T | instance |
| `scheduleOrError` / `schedulesOrError` | T | |
| `topLevelResourceDetailsOrError` / `allTopLevelResourceDetailsOrError` | T | |
| `utilizedEnvVarsOrError` | T | names only to LLM |
| `sensorOrError` / `sensorsOrError` | T | |
| `instigationStateOrError` / `instigationStatesOrError` | T/G | |
| `partitionSetsOrError` / `partitionSetOrError` | T/G | |
| `pipelineRunsOrError` / `pipelineRunOrError` | T | legacy aliases |
| `runsOrError` / `runOrError` | T | primary |
| `runsFeedOrError` / `runsFeedCountOrError` | T/G | |
| `runTagKeysOrError` / `runTagsOrError` / `runIdsOrError` | T/G | |
| `runGroupOrError` | T | reexec groups |
| `isPipelineConfigValid` | T | validate |
| `executionPlanOrError` | T | |
| `runConfigSchemaOrError` | T | |
| `instance` | T | |
| `assetsOrError` / `assetRecordsOrError` / `assetOrError` | T | |
| `assetNodes` / `assetNodeOrError` | T | |
| `assetNodeAdditionalRequiredKeys` / `assetNodeDefinitionCollisions` | T/G | |
| `partitionBackfillOrError` / `partitionBackfillsOrError` | T | |
| `assetBackfillPreview` | T | |
| `permissions` / `canBulkTerminate` | T | policy |
| `assetsLatestInfo` | T | |
| `logsForRun` / `capturedLogsMetadata` / `capturedLogs` | T | + subscriptions |
| `shouldShowNux` / `test` | U/G | low value for agent |
| Automation evaluation fields (auto materialize / condition*) | T/G | diagnose + automation |
| `assetCheckExecutions` | T | |
| `latestDefsStateInfo` | G | |
| `appManagedComponentsForLocationOrError` / `componentTypesForLocationOrError` | T/G | author |

### Mutations (40)

| Field | Strategy | Risk |
|---|---|---|
| `launchPipelineExecution` / `launchRun` / `launchMultipleRuns` | T | remote_launch |
| `launchPipelineReexecution` / `launchRunReexecution` | T | remote_launch |
| Schedule start/stop/reset | T | remote_state |
| Sensor start/stop/reset/cursor/dryRun | T | remote_state |
| `scheduleDryRun` | T | read-ish / local eval |
| Terminate family | T | remote_state |
| Delete run family | T | destructive |
| Reload location/workspace | T | remote_state |
| `shutdownRepositoryLocation` | T | destructive |
| `wipeAssets` | T | destructive |
| `reportRunlessAssetEvents` / `reportAssetCheckEvaluations` | T/G | remote_state |
| Backfill launch/resume/reexec/cancel | T | remote_launch / state |
| `logTelemetry` / `setNuxSeen` | U | UI telemetry |
| Dynamic partitions add/delete | T | remote_state |
| App managed component set/delete | T/G | remote_state |
| `setAutoMaterializePaused` | T | remote_state |
| Concurrency set/delete/free | T | remote_state / destructive for free-all |

### Subscriptions (3)

| Field | Strategy |
|---|---|
| `pipelineRunLogs` | T watch + G subscribe |
| `capturedLogs` | T watch + G subscribe |
| `locationStateChangeEvents` | T instance watch |

---

## Appendix B — Mapping to official Pi examples

Implement by extending patterns, not inventing new ones:

| Concern | Example / doc section |
|---|---|
| Dynamic tools | docs Dynamic Tool Loading; `kimi-deferred-tools.ts` |
| Runtime registerTool | `dynamic-tools.ts` |
| Policy gate | `permission-gate.ts`, `protected-paths.ts` |
| Destructive confirm | `confirm-destructive.ts` |
| Compaction | `custom-compaction.ts` |
| SSH/remote ops | `ssh.ts`, `gondolin/` |
| Provider | `custom-provider-anthropic/`, `custom-provider-gitlab-duo/` |
| Autocomplete | `github-issue-autocomplete.ts` |
| Follow-up messages | `send-user-message.ts` |
| Reload footgun | `reload-runtime.ts` |
| Active tool UI | `tools.ts`, `plan-mode/` |
| Truncation | `truncate-tool.ts` |
| Entry vs message render | `entry-renderer.ts`, `message-renderer.ts` |
| Trust | `project-trust.ts` |

---

## Appendix C — Changelog from prior maximal draft

Material corrections after adversarial review:

1. Replaced “use every ExtensionAPI API” with an **ownership matrix**.  
2. Specified **full dynamic tool-loading algorithm** (additive, metadata rules, foreign tool preservation).  
3. Separated **policy** from active-set thrashing.  
4. Added real **package manifest**, behaviorally default-off optional modules, and filter story.  
5. Specified **session replacement** and state tiers per docs.  
6. Added **mode matrix** and fail-closed non-UI policy.  
7. Demoted Dagit-parity UI; prefer deep links + structured tools.  
8. Made remote/provider **opt-in**.  
9. Replaced bundled skills with compact tool-native guidance and an explicit prompt-template surface.
10. Defined exhaustiveness via **typed ∪ generic ∪ unsupported**, with Appendix A.  
11. Bound claims to vendored pins in `SOURCES.md`.  
12. Added phased implementation plan that can start coding in Phase 0 immediately.
