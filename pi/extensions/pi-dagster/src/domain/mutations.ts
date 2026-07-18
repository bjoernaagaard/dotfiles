/**
 * Pure mappers for mutation GraphQL unions + ExecutionParams builders.
 * Secrets must never appear in summaries (runConfig is not echoed).
 */
import { mapUnionError, type UnionErrorResult } from "./errors.ts";
import type { AssetKeyPath } from "./asset.ts";

/** Parse "a/b/c" or "a.b.c" into path segments. */
export function parseAssetKey(input: string): AssetKeyPath {
  const s = input.trim();
  if (!s) throw new Error("Empty asset key");
  if (s.includes("/")) return s.split("/").filter(Boolean);
  if (s.includes(".")) return s.split(".").filter(Boolean);
  return [s];
}

export type RepoDefaults = {
  repositoryLocationName: string;
  repositoryName: string;
};

export function resolveRepoDefaults(input: {
  repositoryLocationName?: string;
  repositoryName?: string;
  profileDefaultLocation?: string;
  profileDefaultRepository?: string;
}): RepoDefaults {
  const repositoryLocationName =
    input.repositoryLocationName?.trim() ||
    input.profileDefaultLocation?.trim() ||
    "";
  if (!repositoryLocationName) {
    throw new Error(
      "repositoryLocationName is required (pass it or set profile.defaultLocation)",
    );
  }
  const repositoryName =
    input.repositoryName?.trim() ||
    input.profileDefaultRepository?.trim() ||
    "__repository__";
  return { repositoryLocationName, repositoryName };
}

export type LaunchParams = {
  jobName?: string;
  assetSelection?: string[];
  repositoryLocationName: string;
  repositoryName: string;
  runConfig?: unknown;
  tags?: Record<string, string>;
  mode?: string;
  preset?: string;
};

export function buildExecutionParams(params: LaunchParams): Record<string, unknown> {
  if (!params.jobName && (!params.assetSelection || params.assetSelection.length === 0)) {
    throw new Error("jobName or assetSelection is required");
  }

  const selector: Record<string, unknown> = {
    repositoryName: params.repositoryName,
    repositoryLocationName: params.repositoryLocationName,
  };
  if (params.jobName) {
    selector.jobName = params.jobName;
  }
  if (params.assetSelection?.length) {
    selector.assetSelection = params.assetSelection.map((k) => ({
      path: parseAssetKey(k),
    }));
  }

  const executionParams: Record<string, unknown> = {
    selector,
  };
  if (params.mode) executionParams.mode = params.mode;
  if (params.preset) executionParams.preset = params.preset;
  if (params.runConfig !== undefined) {
    // RunConfigData scalar — pass object/string as-is (server accepts JSON)
    executionParams.runConfigData = params.runConfig;
  }
  if (params.tags && Object.keys(params.tags).length > 0) {
    executionParams.executionMetadata = {
      tags: Object.entries(params.tags).map(([key, value]) => ({ key, value })),
    };
  }
  return executionParams;
}

export type MutationOutcome =
  | {
      ok: true;
      typename: string;
      summary: string;
      entityIds: string[];
      data: Record<string, unknown>;
    }
  | {
      ok: false;
      error: UnionErrorResult;
      summary: string;
      entityIds?: string[];
      data?: Record<string, unknown>;
    };

function messageFromNode(node: Record<string, unknown>): string {
  if (typeof node.message === "string" && node.message) return node.message;
  if (typeof node.invalidStepKey === "string") {
    return `Invalid step: ${node.invalidStepKey}`;
  }
  if (typeof node.invalidOutputName === "string") {
    return `Invalid output ${node.invalidOutputName} on step ${String(node.stepKey ?? "?")}`;
  }
  if (node.__typename === "RunConfigValidationInvalid") {
    const errors = (node.errors as Array<{ message?: string }> | undefined) ?? [];
    const msgs = errors.map((e) => e.message).filter(Boolean).join("; ");
    return msgs || `Run config invalid for ${String(node.pipelineName ?? "pipeline")}`;
  }
  return String(node.__typename ?? "Unknown error");
}

export function mapLaunchRunResult(
  data: { launchRun?: Record<string, unknown> } | null | undefined,
): MutationOutcome {
  const node = data?.launchRun;
  if (!node || typeof node !== "object") {
    return {
      ok: false,
      error: { kind: "Other", typename: "Unknown", message: "Missing launchRun result" },
      summary: "Missing launchRun result",
    };
  }
  const typename = String(node.__typename ?? "Unknown");
  if (typename === "LaunchRunSuccess") {
    const run = (node.run as Record<string, unknown> | undefined) ?? {};
    const runId = String(run.runId ?? run.id ?? "");
    const status = String(run.status ?? "");
    const job = String(run.jobName ?? run.pipelineName ?? "");
    return {
      ok: true,
      typename,
      summary: `Launched run ${runId}${job ? ` job=${job}` : ""} status=${status}`,
      entityIds: runId ? [runId] : [],
      data: {
        runId,
        status,
        jobName: run.jobName,
        pipelineName: run.pipelineName,
      },
    };
  }
  const error = mapUnionError({
    __typename: typename,
    message: messageFromNode(node),
    stack: node.stack as string[] | undefined,
  });
  return {
    ok: false,
    error,
    summary: `${typename}: ${error.message}`,
    data: { typename },
  };
}

export function mapReexecuteResult(
  data: { launchRunReexecution?: Record<string, unknown> } | null | undefined,
): MutationOutcome {
  const node = data?.launchRunReexecution;
  if (!node || typeof node !== "object") {
    return {
      ok: false,
      error: {
        kind: "Other",
        typename: "Unknown",
        message: "Missing launchRunReexecution result",
      },
      summary: "Missing launchRunReexecution result",
    };
  }
  // Reuse launch mapper shape by wrapping
  return mapLaunchRunResult({ launchRun: node });
}

export function mapTerminateRunResult(
  data: { terminateRun?: Record<string, unknown> } | null | undefined,
): MutationOutcome {
  const node = data?.terminateRun;
  if (!node || typeof node !== "object") {
    return {
      ok: false,
      error: { kind: "Other", typename: "Unknown", message: "Missing terminateRun result" },
      summary: "Missing terminateRun result",
    };
  }
  const typename = String(node.__typename ?? "Unknown");
  if (typename === "TerminateRunSuccess") {
    const run = (node.run as Record<string, unknown> | undefined) ?? {};
    const runId = String(run.runId ?? run.id ?? "");
    const status = String(run.status ?? "");
    return {
      ok: true,
      typename,
      summary: `Terminated run ${runId} status=${status}`,
      entityIds: runId ? [runId] : [],
      data: { runId, status },
    };
  }
  if (typename === "TerminateRunFailure") {
    const run = (node.run as Record<string, unknown> | undefined) ?? {};
    const runId = String(run.runId ?? run.id ?? "");
    const message = messageFromNode(node);
    return {
      ok: false,
      error: { kind: "Other", typename, message },
      summary: `Terminate failed for ${runId || "run"}: ${message}`,
      entityIds: runId ? [runId] : [],
      data: { runId, status: run.status },
    };
  }
  const error = mapUnionError({
    __typename: typename,
    message: messageFromNode(node),
    stack: node.stack as string[] | undefined,
    runId: node.runId as string | undefined,
  });
  return {
    ok: false,
    error,
    summary: `${typename}: ${error.message}`,
    entityIds: typeof node.runId === "string" ? [node.runId] : undefined,
  };
}

export function mapTerminateRunsResult(
  data: { terminateRuns?: Record<string, unknown> } | null | undefined,
): MutationOutcome {
  const root = data?.terminateRuns;
  if (!root || typeof root !== "object") {
    return {
      ok: false,
      error: { kind: "Other", typename: "Unknown", message: "Missing terminateRuns result" },
      summary: "Missing terminateRuns result",
    };
  }
  const typename = String(root.__typename ?? "Unknown");
  if (typename === "PythonError") {
    const error = mapUnionError({
      __typename: typename,
      message: messageFromNode(root),
      stack: root.stack as string[] | undefined,
    });
    return { ok: false, error, summary: error.message };
  }
  const results =
    (root.terminateRunResults as Array<Record<string, unknown>> | undefined) ?? [];
  const entityIds: string[] = [];
  const lines: string[] = [];
  let anyFail = false;
  for (const r of results) {
    const mapped = mapTerminateRunResult({ terminateRun: r });
    if (mapped.ok) {
      entityIds.push(...mapped.entityIds);
      lines.push(mapped.summary);
    } else {
      anyFail = true;
      if (mapped.entityIds) entityIds.push(...mapped.entityIds);
      lines.push(mapped.summary);
    }
  }
  if (anyFail) {
    return {
      ok: false,
      error: {
        kind: "Other",
        typename: "TerminateRunsPartial",
        message: lines.join("; ") || "Some terminates failed",
      },
      summary: lines.join("\n") || "Some terminates failed",
      entityIds,
      data: { results: lines },
    };
  }
  return {
    ok: true,
    typename: "TerminateRunsResult",
    summary: lines.join("\n") || `Terminated ${results.length} run(s)`,
    entityIds,
    data: { count: results.length },
  };
}

export function mapBackfillLaunchResult(
  data: { launchPartitionBackfill?: Record<string, unknown> } | null | undefined,
): MutationOutcome {
  const node = data?.launchPartitionBackfill;
  if (!node || typeof node !== "object") {
    return {
      ok: false,
      error: { kind: "Other", typename: "Unknown", message: "Missing backfill result" },
      summary: "Missing backfill result",
    };
  }
  const typename = String(node.__typename ?? "Unknown");
  if (typename === "LaunchBackfillSuccess") {
    const backfillId = String(node.backfillId ?? "");
    const launchedRunIds = (node.launchedRunIds as string[] | null | undefined) ?? [];
    return {
      ok: true,
      typename,
      summary: `Launched backfill ${backfillId}${
        launchedRunIds.length ? ` runs=${launchedRunIds.length}` : ""
      }`,
      entityIds: [backfillId, ...launchedRunIds.filter(Boolean)].filter(Boolean),
      data: { backfillId, launchedRunIds },
    };
  }
  const error = mapUnionError({
    __typename: typename,
    message: messageFromNode(node),
    stack: node.stack as string[] | undefined,
  });
  return { ok: false, error, summary: `${typename}: ${error.message}` };
}

export function mapBackfillCancelResult(
  data: { cancelPartitionBackfill?: Record<string, unknown> } | null | undefined,
): MutationOutcome {
  const node = data?.cancelPartitionBackfill;
  return mapSimpleBackfillId(node, "cancelPartitionBackfill", "CancelBackfillSuccess", "Cancelled");
}

export function mapBackfillResumeResult(
  data: { resumePartitionBackfill?: Record<string, unknown> } | null | undefined,
): MutationOutcome {
  const node = data?.resumePartitionBackfill;
  return mapSimpleBackfillId(node, "resumePartitionBackfill", "ResumeBackfillSuccess", "Resumed");
}

function mapSimpleBackfillId(
  node: Record<string, unknown> | null | undefined,
  field: string,
  successTypename: string,
  verb: string,
): MutationOutcome {
  if (!node || typeof node !== "object") {
    return {
      ok: false,
      error: { kind: "Other", typename: "Unknown", message: `Missing ${field} result` },
      summary: `Missing ${field} result`,
    };
  }
  const typename = String(node.__typename ?? "Unknown");
  if (typename === successTypename) {
    const backfillId = String(node.backfillId ?? "");
    return {
      ok: true,
      typename,
      summary: `${verb} backfill ${backfillId}`,
      entityIds: backfillId ? [backfillId] : [],
      data: { backfillId },
    };
  }
  const error = mapUnionError({
    __typename: typename,
    message: messageFromNode(node),
    stack: node.stack as string[] | undefined,
  });
  return { ok: false, error, summary: `${typename}: ${error.message}` };
}

export function mapScheduleMutationResult(
  data: Record<string, unknown> | null | undefined,
  field: string,
): MutationOutcome {
  const node = data?.[field] as Record<string, unknown> | undefined;
  if (!node || typeof node !== "object") {
    return {
      ok: false,
      error: { kind: "Other", typename: "Unknown", message: `Missing ${field} result` },
      summary: `Missing ${field} result`,
    };
  }
  const typename = String(node.__typename ?? "Unknown");
  if (typename === "ScheduleStateResult") {
    const state = (node.scheduleState as Record<string, unknown> | undefined) ?? {};
    const name = String(state.name ?? "");
    const status = String(state.status ?? "");
    const id = String(state.id ?? "");
    return {
      ok: true,
      typename,
      summary: `Schedule ${name} status=${status}`,
      entityIds: [name, id].filter(Boolean),
      data: {
        name,
        status,
        id,
        repositoryName: state.repositoryName,
        repositoryLocationName: state.repositoryLocationName,
      },
    };
  }
  const error = mapUnionError({
    __typename: typename,
    message: messageFromNode(node),
    stack: node.stack as string[] | undefined,
  });
  return { ok: false, error, summary: `${typename}: ${error.message}` };
}

export function mapSensorMutationResult(
  data: Record<string, unknown> | null | undefined,
  field: string,
): MutationOutcome {
  const node = data?.[field] as Record<string, unknown> | undefined;
  if (!node || typeof node !== "object") {
    return {
      ok: false,
      error: { kind: "Other", typename: "Unknown", message: `Missing ${field} result` },
      summary: `Missing ${field} result`,
    };
  }
  const typename = String(node.__typename ?? "Unknown");
  if (typename === "Sensor") {
    const name = String(node.name ?? "");
    const state = (node.sensorState as Record<string, unknown> | undefined) ?? {};
    const status = String(state.status ?? "");
    return {
      ok: true,
      typename,
      summary: `Sensor ${name} status=${status}`,
      entityIds: [name, String(state.id ?? "")].filter(Boolean),
      data: { name, status, id: state.id },
    };
  }
  if (typename === "StopSensorMutationResult") {
    const state = (node.instigationState as Record<string, unknown> | undefined) ?? {};
    const name = String(state.name ?? "");
    const status = String(state.status ?? "");
    return {
      ok: true,
      typename,
      summary: `Sensor ${name} status=${status}`,
      entityIds: [name, String(state.id ?? "")].filter(Boolean),
      data: { name, status, id: state.id },
    };
  }
  const error = mapUnionError({
    __typename: typename,
    message: messageFromNode(node),
    stack: node.stack as string[] | undefined,
  });
  return { ok: false, error, summary: `${typename}: ${error.message}` };
}

export function mapReloadLocationResult(
  data: { reloadRepositoryLocation?: Record<string, unknown> } | null | undefined,
): MutationOutcome {
  const node = data?.reloadRepositoryLocation;
  if (!node || typeof node !== "object") {
    return {
      ok: false,
      error: { kind: "Other", typename: "Unknown", message: "Missing reload result" },
      summary: "Missing reload result",
    };
  }
  const typename = String(node.__typename ?? "Unknown");
  if (typename === "WorkspaceLocationEntry") {
    const name = String(node.name ?? "");
    const loadStatus = String(node.loadStatus ?? "");
    return {
      ok: true,
      typename,
      summary: `Reloaded location ${name} loadStatus=${loadStatus}`,
      entityIds: name ? [name] : [],
      data: {
        name,
        loadStatus,
        updatedTimestamp: node.updatedTimestamp,
      },
    };
  }
  const error = mapUnionError({
    __typename: typename,
    message: messageFromNode(node),
    stack: node.stack as string[] | undefined,
  });
  return { ok: false, error, summary: `${typename}: ${error.message}` };
}

export function formatMutationOutcome(outcome: MutationOutcome): string {
  return outcome.summary;
}

export function outcomeToToolDetails(outcome: MutationOutcome): Record<string, unknown> {
  if (outcome.ok) {
    return {
      kind: "mutation_ok",
      typename: outcome.typename,
      entityIds: outcome.entityIds,
      ...outcome.data,
    };
  }
  return {
    kind: outcome.error.kind,
    typename: outcome.error.typename,
    message: outcome.error.message,
    entityIds: outcome.entityIds,
    ...(outcome.data ?? {}),
  };
}
