import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { DagsterRuntime } from "../../runtime.ts";
import { LAUNCH_RUN_MUTATION } from "../../clients/documents/launch.gql.ts";
import {
  buildExecutionParams,
  mapLaunchRunResult,
  resolveRepoDefaults,
} from "../../domain/mutations.ts";
import {
  assertRuntimeOpen,
  auditMutation,
  gateAndConfirm,
  mutationToolResult,
} from "./mutation-helpers.ts";
import { attachSafeRenderers } from "../../render/index.ts";

export async function launchRunCore(
  runtime: DagsterRuntime,
  params: {
    jobName?: string;
    assetSelection?: string[];
    repositoryLocationName?: string;
    repositoryName?: string;
    runConfig?: unknown;
    tags?: Record<string, string>;
    mode?: string;
    preset?: string;
    force?: boolean;
  },
  signal?: AbortSignal,
  ctx?: {
    hasUI?: boolean;
    ui?: { confirm?: (title: string, message: string) => Promise<boolean> };
  },
) {
  assertRuntimeOpen(runtime, signal);
  const profile = runtime.getActiveProfile();
  const repo = resolveRepoDefaults({
    repositoryLocationName: params.repositoryLocationName,
    repositoryName: params.repositoryName,
    profileDefaultLocation: profile?.defaultLocation,
    profileDefaultRepository: profile?.defaultRepository,
  });

  const executionParams = buildExecutionParams({
    jobName: params.jobName,
    assetSelection: params.assetSelection,
    repositoryLocationName: repo.repositoryLocationName,
    repositoryName: repo.repositoryName,
    runConfig: params.runConfig,
    tags: params.tags,
    mode: params.mode,
    preset: params.preset,
  });

  const risk = "remote_launch" as const;
  const target = params.jobName
    ? `job=${params.jobName}`
    : `assets=${(params.assetSelection ?? []).join(",")}`;

  try {
    await gateAndConfirm({
      runtime,
      risk,
      force: params.force,
      ctx,
      title: "Confirm launch run",
      message: `Launch run (${target}) on ${repo.repositoryLocationName}/${repo.repositoryName}?`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const outcome =
      msg.includes("declined") ? ("declined" as const) : ("denied" as const);
    auditMutation({
      runtime,
      tool: "dagster_launch_run",
      risk,
      outcome,
      summary: msg,
    });
    throw err;
  }

  const client = await runtime.ensureClient({ signal });
  const data = await client.request<{ launchRun: Record<string, unknown> }>({
    query: LAUNCH_RUN_MUTATION,
    variables: { executionParams },
    signal,
    operationName: "DagsterLaunchRun",
  });

  // Never echo runConfig in outcome.
  const outcome = mapLaunchRunResult(data);
  if (outcome.ok) {
    for (const id of outcome.entityIds) runtime.rememberEntity("run", id);
  }
  auditMutation({
    runtime,
    tool: "dagster_launch_run",
    risk,
    outcome: outcome.ok ? "success" : "error",
    summary: outcome.summary,
    entityIds: outcome.entityIds,
  });
  return mutationToolResult(outcome);
}

/** Lazy tool — omit promptSnippet / promptGuidelines. */
export function createLaunchRunTool(runtime: DagsterRuntime) {
  return attachSafeRenderers(defineTool({
    name: "dagster_launch_run",
    label: "Launch Run",
    description:
      "Launch a Dagster run for a job or asset selection after inspecting the target and selection. Remote launch is policy-gated; confirm in UI or pass force=true in non-UI modes when policy allows.",
    parameters: Type.Object({
      jobName: Type.Optional(Type.String({ description: "Job name; use this or assetSelection, not both." })),
      assetSelection: Type.Optional(Type.Array(Type.String(), { description: "Asset selections; use this or jobName, not both." })),
      repositoryLocationName: Type.Optional(Type.String()),
      repositoryName: Type.Optional(Type.String()),
      runConfig: Type.Optional(Type.Unknown({ description: "Optional run config; redact secrets and do not echo it into chat." })),
      tags: Type.Optional(Type.Record(Type.String(), Type.String())),
      mode: Type.Optional(Type.String()),
      preset: Type.Optional(Type.String()),
      force: Type.Optional(Type.Boolean({ description: "Required for intentional non-UI mutation under confirmMutations; ignored by readOnly blocking." })),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      return launchRunCore(runtime, params, signal ?? ctx?.signal, ctx);
    },
  }));
}
