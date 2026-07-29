import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { DagsterRuntime } from "../../runtime.ts";
import { attachSafeRenderers } from "../../render/index.ts";
import {
  compareDiagnosticRuns,
  formatRunComparison,
  noBaselineComparison,
  sanitizeDiagnosticText,
  type RunComparison,
} from "../../domain/diagnose.ts";
import {
  loadDiagnosticRun,
  resolveBaseline,
  throwIfAborted,
  writeDiagnosticOverflow,
} from "./diagnose-helpers.ts";

const MAX_INLINE_COMPARISON_BYTES = 45_000;
const MAX_CHANGES_PER_CATEGORY = 100;

export type CompareRunDetails = {
  kind: "comparison" | "no_baseline" | "not_found" | "python_error" | "unsupported";
  runId: string;
  comparison?: RunComparison;
  message?: string;
  redacted: true;
};

export async function compareRunCore(
  runtime: DagsterRuntime,
  params: { runId: string },
  signal?: AbortSignal,
) {
  const runId = params.runId.trim();
  if (!runId) throw new Error("runId is required");
  throwIfAborted(signal);
  if (runtime.closed) throw new Error("Dagster runtime is shut down");
  const extra = runtime.getActiveProfile()?.redaction?.extraKeyPatterns ?? [];
  const client = await runtime.ensureClient({ signal });
  const current = await loadDiagnosticRun(client, runId, signal, extra);
  if (!current.ok) {
    const message = sanitizeDiagnosticText(current.message, extra);
    const details: CompareRunDetails = {
      kind: current.kind,
      runId,
      message,
      redacted: true,
    };
    return {
      content: [{ type: "text" as const, text: `Dagster run ${runId}: ${message}` }],
      details,
    };
  }

  throwIfAborted(signal);
  const resolved = await resolveBaseline(client, current.value.run, signal, extra);
  if (!resolved.baseline) {
    const comparison = noBaselineComparison(
      runId,
      sanitizeDiagnosticText(resolved.reason ?? "No comparable successful run was found.", extra),
      resolved.constraints,
    );
    runtime.rememberEntity("run", runId);
    runtime.recordIncident({
      runId,
      profileName: runtime.activeProfileName ?? undefined,
      entityIds: { runIds: [runId], assetKeys: current.value.run.assetSelection.map((x) => x.join("/")), backfillIds: [] },
    });
    const details: CompareRunDetails = { kind: "no_baseline", runId, comparison, redacted: true };
    return {
      content: [{ type: "text" as const, text: formatRunComparison(comparison) }],
      details,
    };
  }

  let comparison = compareDiagnosticRuns(
    current.value.run,
    resolved.baseline,
    resolved.matchedBy,
    extra,
  );
  const totalChanges = changeCount(comparison);
  if (
    totalChanges > MAX_CHANGES_PER_CATEGORY * 2 ||
    Buffer.byteLength(JSON.stringify(comparison), "utf8") > MAX_INLINE_COMPARISON_BYTES
  ) {
    const overflowPath = await writeDiagnosticOverflow(comparison, `comparison-${runId}`);
    comparison = truncateComparison(comparison, overflowPath);
  }

  runtime.rememberEntity("run", runId);
  runtime.rememberEntity("run", resolved.baseline.runId);
  runtime.recordIncident({
    runId,
    evidencePointer: comparison.overflowPath,
    profileName: runtime.activeProfileName ?? undefined,
    entityIds: {
      runIds: [runId, resolved.baseline.runId],
      assetKeys: current.value.run.assetSelection.map((x) => x.join("/")),
      backfillIds: [],
    },
  });
  const details: CompareRunDetails = {
    kind: "comparison",
    runId,
    comparison,
    redacted: true,
  };
  return {
    content: [{ type: "text" as const, text: formatRunComparison(comparison) }],
    details,
  };
}

export function createCompareRunTool(runtime: DagsterRuntime) {
  return attachSafeRenderers(defineTool({
    name: "dagster_compare_run",
    label: "Compare Dagster run",
    description: "Compare a Dagster run with its latest strictly comparable successful baseline after evidence review; a missing baseline is not evidence of success.",
    parameters: Type.Object({ runId: Type.String({ minLength: 1, description: "Run id from evidence/inspection; comparison remains bounded and redacted." }) }),
    async execute(_toolCallId, params, signal) {
      return compareRunCore(runtime, params, signal);
    },
  }));
}

function changeCount(value: RunComparison): number {
  return value.changes.config.length + value.changes.tags.length + value.changes.steps.length +
    value.changes.assets.length + value.changes.checks.length + (value.changes.partition ? 1 : 0);
}

function truncateComparison(value: RunComparison, overflowPath: string): RunComparison {
  return {
    ...value,
    changes: {
      ...value.changes,
      config: value.changes.config.slice(0, MAX_CHANGES_PER_CATEGORY),
      tags: value.changes.tags.slice(0, MAX_CHANGES_PER_CATEGORY),
      steps: value.changes.steps.slice(0, MAX_CHANGES_PER_CATEGORY),
      assets: value.changes.assets.slice(0, MAX_CHANGES_PER_CATEGORY),
      checks: value.changes.checks.slice(0, MAX_CHANGES_PER_CATEGORY),
    },
    truncated: true,
    overflowPath,
  };
}
