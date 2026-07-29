/**
 * Compact, runtime-owned guidance for the default Dagster composition root.
 * Keep this operational and bounded: tool contracts and results carry details.
 */
export const DAGSTER_CORE_GUIDANCE = [
  "Call dagster_search_tools before assuming a Dagster capability is missing.",
  "Establish target status first; prefer typed tools, using dagster_graphql_query / _mutation / _subscribe only as schema escape hatches.",
  "Mutations are policy-gated: confirmMutations needs UI confirmation, while print/json requires force=true when allowed; readOnly blocks mutations and force does not override it.",
  "For local authoring use dagster_dg_command for allowlisted dg check/list/scaffold/launch and /dagster-dev for the dg dev lifecycle; dg dev is not a dg_command action.",
  "Diagnose with bounded redacted dagster_evidence_pack evidence, compare only against a strictly comparable successful baseline, validate source/config changes with dg check, then relaunch or reexecute and summarize ids rather than raw logs.",
  "Local @asset / @job:name and #runId autocomplete is cache-only from recent search/inspect results.",
].join(" ");

export const DAGSTER_LOADER_GUIDELINES = [
  "Use dagster_search_tools when the current active tools cannot perform the task; do not declare a capability missing before trying it.",
  "Load the smallest relevant set additively. Establish target/policy first, prefer typed tools, and use generic GraphQL only for fields without a typed surface.",
];
