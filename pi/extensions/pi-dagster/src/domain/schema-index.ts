/**
 * Offline index of pinned Dagster GraphQL root fields.
 * Source of truth: sources/dagster-oss/graphql/ROOT_FIELDS.md
 * (hand-transcribed for runtime; no live introspection — use schema:check for drift).
 */

export type RootFieldKind = "Query" | "Mutation" | "Subscription";

export type RootFieldEntry = {
  name: string;
  kind: RootFieldKind;
  note?: string;
};

/** 65 Query + 40 Mutation + 3 Subscription root fields from pinned inventory. */
export const ROOT_FIELDS: RootFieldEntry[] = [
  // Query (65)
  { name: "version", kind: "Query", note: "capabilities" },
  { name: "repositoriesOrError", kind: "Query", note: "locations/repos" },
  { name: "repositoryOrError", kind: "Query" },
  { name: "workspaceOrError", kind: "Query" },
  { name: "locationStatusesOrError", kind: "Query" },
  { name: "workspaceLocationEntryOrError", kind: "Query" },
  { name: "pipelineOrError", kind: "Query", note: "jobs" },
  { name: "resourcesOrError", kind: "Query" },
  { name: "pipelineSnapshotOrError", kind: "Query" },
  { name: "graphOrError", kind: "Query" },
  { name: "scheduler", kind: "Query", note: "instance" },
  { name: "scheduleOrError", kind: "Query" },
  { name: "schedulesOrError", kind: "Query" },
  { name: "topLevelResourceDetailsOrError", kind: "Query" },
  { name: "allTopLevelResourceDetailsOrError", kind: "Query" },
  { name: "utilizedEnvVarsOrError", kind: "Query", note: "names only to LLM" },
  { name: "sensorOrError", kind: "Query" },
  { name: "sensorsOrError", kind: "Query" },
  { name: "instigationStateOrError", kind: "Query" },
  { name: "instigationStatesOrError", kind: "Query" },
  { name: "partitionSetsOrError", kind: "Query" },
  { name: "partitionSetOrError", kind: "Query" },
  { name: "pipelineRunsOrError", kind: "Query", note: "legacy alias" },
  { name: "pipelineRunOrError", kind: "Query", note: "legacy alias" },
  { name: "runsOrError", kind: "Query", note: "primary runs list" },
  { name: "runOrError", kind: "Query", note: "primary run inspect" },
  { name: "runsFeedOrError", kind: "Query" },
  { name: "runsFeedCountOrError", kind: "Query" },
  { name: "runTagKeysOrError", kind: "Query" },
  { name: "runTagsOrError", kind: "Query" },
  { name: "runIdsOrError", kind: "Query" },
  { name: "runGroupOrError", kind: "Query", note: "reexec groups" },
  { name: "isPipelineConfigValid", kind: "Query", note: "validate" },
  { name: "executionPlanOrError", kind: "Query" },
  { name: "runConfigSchemaOrError", kind: "Query" },
  { name: "instance", kind: "Query" },
  { name: "assetsOrError", kind: "Query" },
  { name: "assetRecordsOrError", kind: "Query" },
  { name: "assetOrError", kind: "Query" },
  { name: "assetNodes", kind: "Query" },
  { name: "assetNodeOrError", kind: "Query" },
  { name: "assetNodeAdditionalRequiredKeys", kind: "Query" },
  { name: "assetNodeDefinitionCollisions", kind: "Query" },
  { name: "partitionBackfillOrError", kind: "Query" },
  { name: "assetBackfillPreview", kind: "Query" },
  { name: "partitionBackfillsOrError", kind: "Query" },
  { name: "permissions", kind: "Query", note: "policy" },
  { name: "canBulkTerminate", kind: "Query" },
  { name: "assetsLatestInfo", kind: "Query" },
  { name: "logsForRun", kind: "Query" },
  { name: "capturedLogsMetadata", kind: "Query" },
  { name: "capturedLogs", kind: "Query" },
  { name: "shouldShowNux", kind: "Query", note: "low value" },
  { name: "test", kind: "Query", note: "low value" },
  { name: "autoMaterializeAssetEvaluationsOrError", kind: "Query" },
  { name: "truePartitionsForAutomationConditionEvaluationNode", kind: "Query" },
  { name: "autoMaterializeEvaluationsForEvaluationId", kind: "Query" },
  { name: "assetConditionEvaluationForPartition", kind: "Query" },
  { name: "assetConditionEvaluationRecordsOrError", kind: "Query" },
  { name: "assetConditionEvaluationsForEvaluationId", kind: "Query" },
  { name: "autoMaterializeTicks", kind: "Query" },
  { name: "assetCheckExecutions", kind: "Query" },
  { name: "latestDefsStateInfo", kind: "Query" },
  { name: "appManagedComponentsForLocationOrError", kind: "Query" },
  { name: "componentTypesForLocationOrError", kind: "Query" },

  // Mutation (40)
  { name: "launchPipelineExecution", kind: "Mutation", note: "legacy launch" },
  { name: "launchRun", kind: "Mutation", note: "remote_launch" },
  { name: "launchMultipleRuns", kind: "Mutation" },
  { name: "launchPipelineReexecution", kind: "Mutation" },
  { name: "launchRunReexecution", kind: "Mutation" },
  { name: "startSchedule", kind: "Mutation" },
  { name: "stopRunningSchedule", kind: "Mutation" },
  { name: "resetSchedule", kind: "Mutation" },
  { name: "startSensor", kind: "Mutation" },
  { name: "setSensorCursor", kind: "Mutation" },
  { name: "stopSensor", kind: "Mutation" },
  { name: "resetSensor", kind: "Mutation" },
  { name: "sensorDryRun", kind: "Mutation" },
  { name: "scheduleDryRun", kind: "Mutation" },
  { name: "terminatePipelineExecution", kind: "Mutation" },
  { name: "terminateRun", kind: "Mutation" },
  { name: "terminateRuns", kind: "Mutation" },
  { name: "deletePipelineRun", kind: "Mutation", note: "destructive" },
  { name: "deleteRun", kind: "Mutation", note: "destructive" },
  { name: "reloadRepositoryLocation", kind: "Mutation" },
  { name: "reloadWorkspace", kind: "Mutation" },
  { name: "shutdownRepositoryLocation", kind: "Mutation", note: "destructive" },
  { name: "wipeAssets", kind: "Mutation", note: "destructive" },
  { name: "reportRunlessAssetEvents", kind: "Mutation" },
  { name: "reportAssetCheckEvaluations", kind: "Mutation" },
  { name: "launchPartitionBackfill", kind: "Mutation" },
  { name: "resumePartitionBackfill", kind: "Mutation" },
  { name: "reexecutePartitionBackfill", kind: "Mutation" },
  { name: "cancelPartitionBackfill", kind: "Mutation" },
  { name: "logTelemetry", kind: "Mutation", note: "UI telemetry" },
  { name: "setNuxSeen", kind: "Mutation" },
  { name: "addDynamicPartition", kind: "Mutation" },
  { name: "deleteDynamicPartitions", kind: "Mutation" },
  { name: "setAppManagedComponent", kind: "Mutation" },
  { name: "deleteAppManagedComponent", kind: "Mutation" },
  { name: "setAutoMaterializePaused", kind: "Mutation" },
  { name: "setConcurrencyLimit", kind: "Mutation" },
  { name: "deleteConcurrencyLimit", kind: "Mutation" },
  { name: "freeConcurrencySlotsForRun", kind: "Mutation" },
  { name: "freeConcurrencySlots", kind: "Mutation", note: "destructive free-all" },

  // Subscription (3)
  { name: "pipelineRunLogs", kind: "Subscription" },
  { name: "capturedLogs", kind: "Subscription" },
  { name: "locationStateChangeEvents", kind: "Subscription" },
];

export function searchRootFields(
  query: string,
  options?: { limit?: number; kinds?: RootFieldKind[] },
): RootFieldEntry[] {
  const limit = Math.min(Math.max(options?.limit ?? 20, 1), 50);
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter(Boolean);
  const kindFilter = options?.kinds?.length ? new Set(options.kinds) : null;

  const scored = ROOT_FIELDS.filter((f) => !kindFilter || kindFilter.has(f.kind))
    .map((f) => {
      const hay = `${f.name} ${f.kind} ${f.note ?? ""}`.toLowerCase();
      let score = 0;
      if (terms.length === 0) score = 1;
      for (const t of terms) {
        if (f.name.toLowerCase() === t) score += 5;
        else if (f.name.toLowerCase().includes(t)) score += 3;
        else if (hay.includes(t)) score += 1;
      }
      return { f, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.f.name.localeCompare(b.f.name))
    .slice(0, limit)
    .map((x) => x.f);

  return scored;
}

export function formatRootFieldHits(hits: RootFieldEntry[]): string {
  if (hits.length === 0) return "No root fields matched.";
  return hits
    .map((h) => {
      const use =
        h.kind === "Query"
          ? "use dagster_graphql_query"
          : h.kind === "Mutation"
            ? h.name === "logTelemetry" || h.name === "setNuxSeen"
              ? "intentionally unsupported (UI telemetry/NUX)"
              : "use typed tools or dagster_graphql_mutation"
            : "use dagster_graphql_subscribe";
      return `- ${h.kind}.${h.name}${h.note ? ` — ${h.note}` : ""} (${use})`;
    })
    .join("\n");
}
