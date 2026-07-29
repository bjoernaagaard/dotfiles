/**
 * Pure mappers: run GraphQL → summary for tools.
 */
import { mapUnionError, type UnionErrorResult } from "./errors.ts";
import { redactYamlish } from "../policy/redact.ts";
import { formatAssetKey } from "./asset.ts";

export type RunSummary = {
  runId: string;
  status: string;
  jobName?: string;
  pipelineName?: string;
  startTime?: number | null;
  endTime?: number | null;
  creationTime?: number | null;
  mode?: string;
  canTerminate?: boolean;
  permissions?: {
    reexecute?: boolean;
    terminate?: boolean;
    delete?: boolean;
  };
  rootRunId?: string | null;
  parentRunId?: string | null;
  tags?: Array<{ key: string; value: string }>;
  assetSelection?: string[];
  runConfigYamlRedacted?: string;
  stepStats?: Array<{
    stepKey: string;
    status?: string | null;
    startTime?: number | null;
    endTime?: number | null;
  }>;
};

export type RunInspectResult =
  | { ok: true; run: RunSummary }
  | { ok: false; error: UnionErrorResult };

export function mapRun(node: Record<string, unknown>, extraRedactPatterns?: string[]): RunSummary {
  const tags = ((node.tags as Array<{ key: string; value: string }> | undefined) ?? []).map(
    (t) => ({ key: t.key, value: t.value }),
  );
  const assetSelection = (
    (node.assetSelection as Array<{ path: string[] }> | undefined) ?? []
  ).map((k) => formatAssetKey(k.path));

  const rawConfig = typeof node.runConfigYaml === "string" ? node.runConfigYaml : "";
  const runConfigYamlRedacted = rawConfig
    ? redactYamlish(rawConfig, extraRedactPatterns)
    : undefined;

  const stepStats = (
    (node.stepStats as Array<Record<string, unknown>> | undefined) ?? []
  ).map((s) => ({
    stepKey: String(s.stepKey ?? ""),
    status: (s.status as string | null | undefined) ?? null,
    startTime: (s.startTime as number | null | undefined) ?? null,
    endTime: (s.endTime as number | null | undefined) ?? null,
  }));

  return {
    runId: String(node.runId ?? ""),
    status: String(node.status ?? "UNKNOWN"),
    jobName: node.jobName as string | undefined,
    pipelineName: node.pipelineName as string | undefined,
    startTime: (node.startTime as number | null | undefined) ?? null,
    endTime: (node.endTime as number | null | undefined) ?? null,
    creationTime: (node.creationTime as number | null | undefined) ?? null,
    mode: node.mode as string | undefined,
    canTerminate: Boolean(node.canTerminate),
    permissions: {
      reexecute: Boolean(node.hasReExecutePermission),
      terminate: Boolean(node.hasTerminatePermission),
      delete: Boolean(node.hasDeletePermission),
    },
    rootRunId: (node.rootRunId as string | null | undefined) ?? null,
    parentRunId: (node.parentRunId as string | null | undefined) ?? null,
    tags,
    assetSelection,
    runConfigYamlRedacted,
    stepStats,
  };
}

export function mapRunOrError(
  payload: { runOrError?: Record<string, unknown> },
  extraRedactPatterns?: string[],
): RunInspectResult {
  const node = payload.runOrError;
  if (!node) {
    return {
      ok: false,
      error: { kind: "Other", typename: "Missing", message: "No runOrError in response" },
    };
  }
  if (node.__typename === "Run" || (node.runId && !String(node.__typename ?? "").includes("Error") && node.__typename !== "PythonError")) {
    if (node.__typename && node.__typename !== "Run") {
      return { ok: false, error: mapUnionError(node as { __typename?: string; message?: string }) };
    }
    return { ok: true, run: mapRun(node, extraRedactPatterns) };
  }
  return { ok: false, error: mapUnionError(node as { __typename?: string; message?: string; stack?: string[] }) };
}

export function formatRunSummary(run: RunSummary): string {
  const lines = [
    `runId: ${run.runId}`,
    `status: ${run.status}`,
    run.jobName ? `job: ${run.jobName}` : null,
    run.startTime != null ? `start: ${run.startTime}` : null,
    run.endTime != null ? `end: ${run.endTime}` : null,
    `canTerminate: ${run.canTerminate ? "yes" : "no"}`,
    run.tags?.length
      ? `tags: ${run.tags
          .slice(0, 20)
          .map((t) => `${t.key}=${t.value}`)
          .join(", ")}`
      : null,
    run.assetSelection?.length
      ? `assets (${run.assetSelection.length}): ${run.assetSelection.slice(0, 15).join(", ")}`
      : null,
  ].filter(Boolean) as string[];

  if (run.stepStats?.length) {
    const failed = run.stepStats.filter((s) => s.status && /FAIL/i.test(s.status));
    lines.push(`steps: ${run.stepStats.length}${failed.length ? ` (${failed.length} failed)` : ""}`);
    for (const s of run.stepStats.slice(0, 15)) {
      lines.push(`  - ${s.stepKey}: ${s.status ?? "?"}`);
    }
    if (run.stepStats.length > 15) lines.push(`  … +${run.stepStats.length - 15} more`);
  }

  if (run.runConfigYamlRedacted) {
    const cfg = run.runConfigYamlRedacted;
    const preview = cfg.length > 800 ? `${cfg.slice(0, 800)}\n…` : cfg;
    lines.push("runConfigYaml (redacted):");
    lines.push(preview);
  }

  return lines.join("\n");
}
