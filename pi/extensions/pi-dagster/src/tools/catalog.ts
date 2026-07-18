import type { ToolMeta } from "../policy/types.ts";

/** Always-on tool names (proposal §4.2). */
export const ALWAYS_ON_NAMES = [
  "dagster_search_tools",
  "dagster_target_status",
  "dagster_search",
  "dagster_get_context",
  "dagster_capabilities",
  "dagster_graphql_query",
] as const;

export type AlwaysOnName = (typeof ALWAYS_ON_NAMES)[number];

/**
 * All searchable lazy tools (registered, initially inactive).
 * Phase 3: mutations, subscribe, watches are real.
 */
export const LAZY_TOOL_NAMES = [
  "dagster_inspect_asset",
  "dagster_inspect_run",
  "dagster_inspect_job",
  "dagster_schema_search",
  "dagster_launch_run",
  "dagster_reexecute_run",
  "dagster_terminate_run",
  "dagster_backfill",
  "dagster_schedule_control",
  "dagster_sensor_control",
  "dagster_reload_location",
  "dagster_graphql_mutation",
  "dagster_graphql_subscribe",
  "dagster_watch_run",
  "dagster_evidence_pack",
  "dagster_compare_run",
  "dagster_dg_command",
] as const;

export type LazyToolName = (typeof LAZY_TOOL_NAMES)[number];

/** Phase 3: no remaining stubs. */
export const LAZY_STUB_NAMES = [] as const;

export type LazyStubName = (typeof LAZY_STUB_NAMES)[number];

/** @deprecated Use LAZY_TOOL_NAMES; kept alias for Phase 0 test compatibility where needed. */
export const SEARCHABLE_TOOL_NAMES = new Set<string>(LAZY_TOOL_NAMES);

export const TOOL_CATALOG: ToolMeta[] = [
  {
    name: "dagster_search_tools",
    risk: "read",
    entities: ["graphql", "dg", "asset", "run", "job"],
    verbs: ["search", "load", "enable"],
    keywords: ["tools", "search", "loader", "capability", "find", "enable"],
    description: "Additively search for the smallest additional Dagster tool set; try before declaring a capability missing",
    alwaysOn: true,
  },
  {
    name: "dagster_target_status",
    risk: "read",
    entities: ["instance", "project"],
    verbs: ["status", "inspect"],
    keywords: ["target", "profile", "status", "health", "connection", "policy"],
    description: "Establish active Dagster target, project trust, path, policy, and connection (no secrets)",
    alwaysOn: true,
  },
  {
    name: "dagster_search",
    risk: "read",
    entities: ["asset", "run", "job", "schedule", "sensor"],
    verbs: ["search", "list", "find"],
    keywords: ["search", "assets", "jobs", "runs", "catalog", "find"],
    description: "Read-only cross-entity search after target status",
    alwaysOn: true,
  },
  {
    name: "dagster_get_context",
    risk: "read",
    entities: ["project", "instance"],
    verbs: ["context", "inspect"],
    keywords: ["context", "profile", "cwd", "loaded", "summary"],
    description: "Compact target/project/dg context and cache-only recent entities",
    alwaysOn: true,
  },
  {
    name: "dagster_capabilities",
    risk: "read",
    entities: ["instance", "graphql"],
    verbs: ["inspect", "capabilities"],
    keywords: ["version", "permissions", "schema", "capabilities", "drift"],
    description: "Dagster version, permissions, location load, and capability notes",
    alwaysOn: true,
  },
  {
    name: "dagster_graphql_query",
    risk: "read",
    entities: ["graphql"],
    verbs: ["query"],
    graphqlFields: ["*"],
    keywords: ["graphql", "query", "gql", "raw"],
    description: "Read-only generic GraphQL query escape hatch; prefer typed tools",
    alwaysOn: true,
  },
  {
    name: "dagster_inspect_asset",
    risk: "read",
    entities: ["asset"],
    verbs: ["inspect", "describe"],
    graphqlFields: ["assetNodeOrError"],
    keywords: ["asset", "inspect", "materialization", "lineage", "key"],
    description: "Inspect an asset definition and bounded recent materializations after search",
    alwaysOn: false,
  },
  {
    name: "dagster_inspect_run",
    risk: "read",
    entities: ["run"],
    verbs: ["inspect", "describe"],
    graphqlFields: ["runOrError"],
    keywords: ["run", "inspect", "status", "logs", "pipeline"],
    description: "Inspect a run with redacted config, steps, status, and bounded evidence",
    alwaysOn: false,
  },
  {
    name: "dagster_inspect_job",
    risk: "read",
    entities: ["job"],
    verbs: ["inspect", "describe"],
    graphqlFields: ["pipelineOrError"],
    keywords: ["job", "pipeline", "inspect", "ops", "solids", "presets"],
    description: "Inspect a job/pipeline definition before launch or source changes",
    alwaysOn: false,
  },
  {
    name: "dagster_schema_search",
    risk: "read",
    entities: ["graphql"],
    verbs: ["search", "schema"],
    graphqlFields: ["*"],
    keywords: ["schema", "graphql", "root", "fields", "query", "mutation", "search"],
    description: "Search pinned Dagster GraphQL root fields when no typed tool covers a field",
    alwaysOn: false,
  },
  {
    name: "dagster_launch_run",
    risk: "remote_launch",
    entities: ["run", "job"],
    verbs: ["launch", "execute"],
    graphqlFields: ["launchRun"],
    keywords: ["launch", "run", "execute", "job", "start"],
    description: "Policy-gated launch after target and job/asset inspection; choose jobName or assetSelection",
    alwaysOn: false,
  },
  {
    name: "dagster_reexecute_run",
    risk: "remote_launch",
    entities: ["run"],
    verbs: ["reexecute", "retry", "launch"],
    graphqlFields: ["launchRunReexecution"],
    keywords: ["reexecute", "retry", "from_failure", "run"],
    description: "Policy-gated reexecute after run inspection; choose FROM_FAILURE, FROM_ASSET_FAILURE, or ALL_STEPS",
    alwaysOn: false,
  },
  {
    name: "dagster_terminate_run",
    risk: "remote_state",
    entities: ["run"],
    verbs: ["terminate", "cancel", "stop"],
    graphqlFields: ["terminateRun", "terminateRuns"],
    keywords: ["terminate", "cancel", "stop", "run", "kill"],
    description: "Policy-gated termination after status inspection; never infer a safe target",
    alwaysOn: false,
  },
  {
    name: "dagster_backfill",
    risk: "remote_launch",
    entities: ["backfill", "asset"],
    verbs: ["launch", "cancel", "resume", "backfill"],
    graphqlFields: [
      "launchPartitionBackfill",
      "cancelPartitionBackfill",
      "resumePartitionBackfill",
    ],
    keywords: ["backfill", "partition", "launch", "cancel", "resume"],
    description: "Policy-gated partition backfill launch/cancel/resume; inspect selection and action first",
    alwaysOn: false,
  },
  {
    name: "dagster_schedule_control",
    risk: "remote_state",
    entities: ["schedule"],
    verbs: ["start", "stop", "reset"],
    graphqlFields: ["startSchedule", "stopRunningSchedule", "resetSchedule"],
    keywords: ["schedule", "start", "stop", "reset", "cron"],
    description: "Policy-gated schedule start/stop/reset after inspecting target state",
    alwaysOn: false,
  },
  {
    name: "dagster_sensor_control",
    risk: "remote_state",
    entities: ["sensor"],
    verbs: ["start", "stop", "reset"],
    graphqlFields: ["startSensor", "stopSensor", "resetSensor"],
    keywords: ["sensor", "start", "stop", "reset"],
    description: "Policy-gated sensor start/stop/reset after inspecting target state",
    alwaysOn: false,
  },
  {
    name: "dagster_reload_location",
    risk: "remote_state",
    entities: ["instance"],
    verbs: ["reload"],
    graphqlFields: ["reloadRepositoryLocation"],
    keywords: ["reload", "location", "code", "repository"],
    description: "Policy-gated repository-location reload after checking load status and source changes",
    alwaysOn: false,
  },
  {
    name: "dagster_graphql_mutation",
    risk: "remote_state",
    entities: ["graphql"],
    verbs: ["mutate"],
    graphqlFields: ["*"],
    keywords: ["graphql", "mutation", "mutate", "write"],
    description: "Generic GraphQL mutation escape hatch; AST-classified and policy-gated, prefer typed mutations",
    alwaysOn: false,
  },
  {
    name: "dagster_graphql_subscribe",
    risk: "read",
    entities: ["graphql", "run"],
    verbs: ["subscribe", "stream", "watch"],
    graphqlFields: ["pipelineRunLogs", "locationStateChangeEvents", "capturedLogs"],
    keywords: ["graphql", "subscription", "subscribe", "stream", "logs"],
    description: "Bounded generic GraphQL subscription escape hatch; cap events/time and avoid unbounded log streams",
    alwaysOn: false,
  },
  {
    name: "dagster_watch_run",
    risk: "read",
    entities: ["run"],
    verbs: ["watch", "stream", "logs"],
    graphqlFields: ["pipelineRunLogs"],
    keywords: ["watch", "run", "logs", "stream", "tail"],
    description: "Session-scoped run watch; summarize status and use its log path instead of dumping full streams",
    alwaysOn: false,
  },
  {
    name: "dagster_evidence_pack",
    risk: "read",
    entities: ["run", "asset", "instance"],
    verbs: ["diagnose", "inspect", "collect"],
    graphqlFields: ["runOrError", "assetNodes", "workspaceOrError", "assetNodeDefinitionCollisions"],
    keywords: ["diagnose", "failure", "evidence", "logs", "error", "upstream", "checks", "location"],
    description: "Collect bounded redacted failure evidence before classifying or remediating a run",
    alwaysOn: false,
  },
  {
    name: "dagster_compare_run",
    risk: "read",
    entities: ["run"],
    verbs: ["compare", "diagnose", "diff"],
    graphqlFields: ["runOrError", "runsOrError"],
    keywords: ["compare", "baseline", "last success", "successful", "failure", "diff", "diagnose"],
    description: "Compare only with the latest strictly comparable successful baseline; no baseline is not success",
    alwaysOn: false,
  },
  {
    name: "dagster_dg_command",
    risk: "local_exec",
    entities: ["dg", "project"],
    verbs: ["exec", "check", "list", "scaffold", "launch"],
    dgCommands: ["check", "list", "scaffold", "launch"],
    keywords: [
      "dg",
      "cli",
      "check",
      "scaffold",
      "project",
      "local",
      "list",
      "defs",
      "components",
      "launch",
      "uv",
    ],
    description:
      "Run an allowlisted local dg command (check/list/scaffold/launch); validate source/config with dg check and use /dagster-dev, not dg dev, for lifecycle.",
    alwaysOn: false,
  },
];

export function getToolMeta(name: string): ToolMeta | undefined {
  return TOOL_CATALOG.find((t) => t.name === name);
}

export function classifyTool(name: string): ToolMeta["risk"] {
  return getToolMeta(name)?.risk ?? "read";
}

export function alwaysOnNames(): string[] {
  return [...ALWAYS_ON_NAMES];
}

export function lazyToolNames(): string[] {
  return [...LAZY_TOOL_NAMES];
}

/**
 * Rank catalog entries by keyword overlap on query tokens.
 * Searches name, description, keywords, verbs, entities.
 */
export function rankCatalog(
  query: string,
  options?: { limit?: number; onlySearchable?: boolean },
): ToolMeta[] {
  const limit = Math.min(Math.max(options?.limit ?? 5, 1), 12);
  const onlySearchable = options?.onlySearchable ?? true;
  const terms = tokenize(query);
  if (terms.length === 0) return [];

  const pool = onlySearchable
    ? TOOL_CATALOG.filter((t) => !t.alwaysOn)
    : TOOL_CATALOG;

  return pool
    .map((tool) => ({ tool, score: scoreTool(tool, terms) }))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name))
    .slice(0, limit)
    .map((m) => m.tool);
}

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter(Boolean);
}

function scoreTool(tool: ToolMeta, terms: string[]): number {
  const haystack = [
    tool.name,
    tool.description,
    ...tool.keywords,
    ...tool.verbs,
    ...tool.entities,
    ...(tool.graphqlFields ?? []),
    ...(tool.dgCommands ?? []),
  ]
    .join(" ")
    .toLowerCase();

  let score = 0;
  for (const term of terms) {
    if (tool.name.toLowerCase() === term || tool.name.toLowerCase().includes(term)) {
      score += 3;
    } else if (haystack.includes(term)) {
      score += 1;
    }
  }
  return score;
}
