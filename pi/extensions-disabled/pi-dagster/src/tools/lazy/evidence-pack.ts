import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { DagsterRuntime } from "../../runtime.ts";
import { attachSafeRenderers } from "../../render/index.ts";
import {
  DIAGNOSE_CAPTURED_LOGS_QUERY,
  DIAGNOSE_COLLISIONS_QUERY,
  DIAGNOSE_DEPENDENCY_KEYS_QUERY,
  DIAGNOSE_LOCATIONS_QUERY,
  DIAGNOSE_UPSTREAM_QUERY,
} from "../../clients/documents/diagnose.gql.ts";
import {
  MAX_LOGS,
  MAX_UPSTREAM_ASSETS,
  baselineHighlightsFromComparison,
  classifyEvidence,
  compareDiagnosticRuns,
  extractDependencyKeys,
  extractLogsCapturedKeys,
  formatEvidencePack,
  mapCapturedLogs,
  mapCollisionEvidence,
  mapFailureEvents,
  mapLocationEvidence,
  mapStepEvents,
  mapUpstreamEvidence,
  sanitizeDiagnosticText,
  type ComputeLogEvidence,
  type EvidencePack,
} from "../../domain/diagnose.ts";
import {
  errorMessage,
  isAbortError,
  loadDiagnosticRun,
  resolveBaseline,
  throwIfAborted,
  writeDiagnosticOverflow,
} from "./diagnose-helpers.ts";

const MAX_INLINE_EVIDENCE_BYTES = 45_000;

export type EvidencePackDetails = {
  kind: "evidence_pack" | "not_found" | "python_error" | "unsupported";
  runId: string;
  evidence?: EvidencePack;
  evidencePointer?: string;
  redacted: true;
  incident?: {
    runId: string;
    evidencePointer?: string;
    entityIds: { runIds: string[]; assetKeys: string[]; backfillIds: string[] };
  };
  message?: string;
};

export async function evidencePackCore(
  runtime: DagsterRuntime,
  params: { runId: string; includeComputeLogs?: boolean; compareLastSuccess?: boolean },
  signal?: AbortSignal,
) {
  const runId = params.runId.trim();
  if (!runId) throw new Error("runId is required");
  throwIfAborted(signal);
  if (runtime.closed) throw new Error("Dagster runtime is shut down");
  const extra = runtime.getActiveProfile()?.redaction?.extraKeyPatterns ?? [];
  const client = await runtime.ensureClient({ signal });
  const loaded = await loadDiagnosticRun(client, runId, signal, extra);
  if (!loaded.ok) {
    const details: EvidencePackDetails = {
      kind: loaded.kind,
      runId,
      message: sanitizeDiagnosticText(loaded.message, extra),
      redacted: true,
    };
    return {
      content: [{ type: "text" as const, text: `Dagster run ${runId}: ${details.message}` }],
      details,
    };
  }

  const warnings: string[] = [];
  let partial = loaded.value.eventHasMore;
  if (loaded.value.eventHasMore) {
    warnings.push(
      loaded.value.eventWindowTrimmed
        ? "Run events exceeded the bounded evidence window; retained the terminal/newest event window for failure evidence."
        : "Run events still have more pages beyond the hard scan cap; retained the newest scanned window.",
    );
  }
  const failures = mapFailureEvents(loaded.value.events, extra);
  const stepEvents = mapStepEvents(loaded.value.events, extra);
  const logKeys = extractLogsCapturedKeys(loaded.value.events);
  const computeLogs: ComputeLogEvidence[] = [];

  if (params.includeComputeLogs !== false) {
    const failedSteps = new Set(failures.map((x) => x.stepKey).filter(Boolean));
    const prioritized = [...logKeys].sort((a, b) =>
      Number(failedSteps.has(b.stepKey)) - Number(failedSteps.has(a.stepKey)) ||
      a.fileKey.localeCompare(b.fileKey),
    ).slice(0, MAX_LOGS);
    for (const key of prioritized) {
      throwIfAborted(signal);
      try {
        const data = await client.request<{ runOrError?: unknown }>({
          query: DIAGNOSE_CAPTURED_LOGS_QUERY,
          variables: { runId, fileKey: key.fileKey },
          operationName: "DagsterDiagnoseCapturedLogs",
          signal,
        });
        computeLogs.push(mapCapturedLogs(data, key, extra));
      } catch (error) {
        if (isAbortError(error, signal)) throw error;
        partial = true;
        warnings.push(`Captured log ${key.fileKey} unavailable: ${sanitizeDiagnosticText(errorMessage(error), extra)}`);
        computeLogs.push({
          stepKey: key.stepKey ?? key.stepKeys[0],
          fileKey: key.fileKey,
          availability: key.external ? "external" : "unavailable",
          note: key.external ? key.externalNote : "Captured-log query failed",
        });
      }
    }
    if (!logKeys.length) {
      computeLogs.push({ availability: "unavailable", note: "No LogsCapturedEvent file key was found in the bounded event window" });
    }
  }

  let upstream: EvidencePack["upstream"] = [];
  const selectedAssets = loaded.value.run.assetSelection.slice(0, MAX_UPSTREAM_ASSETS);
  if (selectedAssets.length) {
    try {
      throwIfAborted(signal);
      const keysPayload = await client.request<{ assetNodes?: unknown }>({
        query: DIAGNOSE_DEPENDENCY_KEYS_QUERY,
        variables: { assetKeys: selectedAssets.map((path) => ({ path })) },
        operationName: "DagsterDiagnoseDependencyKeys",
        signal,
      });
      const dependencyKeys = extractDependencyKeys(keysPayload).slice(0, MAX_UPSTREAM_ASSETS);
      if (dependencyKeys.length) {
        throwIfAborted(signal);
        const upstreamPayload = await client.request<{ assetNodes?: unknown }>({
          query: DIAGNOSE_UPSTREAM_QUERY,
          variables: { assetKeys: dependencyKeys.map((path) => ({ path })) },
          operationName: "DagsterDiagnoseUpstream",
          signal,
        });
        upstream = mapUpstreamEvidence(upstreamPayload, extra);
      }
    } catch (error) {
      if (isAbortError(error, signal)) throw error;
      partial = true;
      warnings.push(`Upstream evidence unavailable: ${sanitizeDiagnosticText(errorMessage(error), extra)}`);
    }
  } else {
    partial = true;
    warnings.push("Run has no resolvable bounded asset selection; upstream evidence was not queried.");
  }

  let locations: EvidencePack["locations"] = [];
  try {
    throwIfAborted(signal);
    const locationPayload = await client.request<{ workspaceOrError?: unknown }>({
      query: DIAGNOSE_LOCATIONS_QUERY,
      operationName: "DagsterDiagnoseLocations",
      signal,
    });
    const mapped = mapLocationEvidence(locationPayload, extra);
    locations = mapped.locations;
    if (mapped.warning) {
      partial = true;
      warnings.push(mapped.warning);
    }
  } catch (error) {
    if (isAbortError(error, signal)) throw error;
    partial = true;
    warnings.push(`Location evidence unavailable: ${sanitizeDiagnosticText(errorMessage(error), extra)}`);
  }

  let collisions: EvidencePack["collisions"] = [];
  if (selectedAssets.length) {
    try {
      throwIfAborted(signal);
      const collisionPayload = await client.request<{ assetNodeDefinitionCollisions?: unknown }>({
        query: DIAGNOSE_COLLISIONS_QUERY,
        variables: { assetKeys: selectedAssets.map((path) => ({ path })) },
        operationName: "DagsterDiagnoseCollisions",
        signal,
      });
      collisions = mapCollisionEvidence(collisionPayload);
    } catch (error) {
      if (isAbortError(error, signal)) throw error;
      partial = true;
      warnings.push(`Collision evidence unavailable: ${sanitizeDiagnosticText(errorMessage(error), extra)}`);
    }
  }

  let baseline: EvidencePack["baseline"] = {
    available: false,
    reason: "Last-success comparison was not requested",
  };
  if (params.compareLastSuccess !== false) {
    try {
      throwIfAborted(signal);
      const resolved = await resolveBaseline(client, loaded.value.run, signal, extra);
      if (resolved.baseline) {
        const comparison = compareDiagnosticRuns(
          loaded.value.run,
          resolved.baseline,
          resolved.matchedBy,
          extra,
        );
        baseline = {
          available: true,
          runId: resolved.baseline.runId,
          matchedBy: resolved.matchedBy,
          highlights: baselineHighlightsFromComparison(comparison),
        };
      } else {
        baseline = {
          available: false,
          reason: sanitizeDiagnosticText(
            resolved.reason ?? "No comparable successful run",
            extra,
          ),
        };
      }
    } catch (error) {
      if (isAbortError(error, signal)) throw error;
      partial = true;
      warnings.push(`Last-success lookup unavailable: ${sanitizeDiagnosticText(errorMessage(error), extra)}`);
      baseline = { available: false, reason: "Last-success lookup failed; use dagster_compare_run to retry." };
    }
  }

  const pack: EvidencePack = {
    run: loaded.value.run,
    failures,
    stepEvents,
    computeLogs,
    upstream,
    locations,
    collisions,
    baseline,
    partial,
    warnings: stableStrings(warnings),
  };
  pack.classificationHints = classifyEvidence(pack);

  const serialized = JSON.stringify(pack);
  if (Buffer.byteLength(serialized, "utf8") > MAX_INLINE_EVIDENCE_BYTES || loaded.value.eventHasMore) {
    pack.overflowPath = await writeDiagnosticOverflow(pack, `evidence-${runId}`);
  }
  runtime.rememberEntity("run", runId);
  runtime.recordIncident({
    runId,
    evidencePointer: pack.overflowPath,
    profileName: runtime.activeProfileName ?? undefined,
    entityIds: {
      runIds: [runId, ...(baseline.runId ? [baseline.runId] : [])],
      assetKeys: selectedAssets.map((path) => path.join("/")),
      backfillIds: [],
    },
  });

  const visiblePack = pack.overflowPath ? compactPack(pack) : pack;
  const details: EvidencePackDetails = {
    kind: "evidence_pack",
    runId,
    evidence: visiblePack,
    evidencePointer: pack.overflowPath,
    redacted: true,
    incident: {
      runId,
      evidencePointer: pack.overflowPath,
      entityIds: {
        runIds: [runId, ...(baseline.runId ? [baseline.runId] : [])],
        assetKeys: selectedAssets.map((path) => path.join("/")),
        backfillIds: [],
      },
    },
  };
  return {
    content: [{ type: "text" as const, text: formatEvidencePack(visiblePack) }],
    details,
  };
}

export function createEvidencePackTool(runtime: DagsterRuntime) {
  return attachSafeRenderers(defineTool({
    name: "dagster_evidence_pack",
    label: "Dagster evidence pack",
    description: "Collect bounded, redacted failure evidence for a Dagster run: error chain, failed steps, available logs, upstream checks/materializations, and location/collision signals; inspect before remediation.",
    parameters: Type.Object({
      runId: Type.String({ minLength: 1 }),
      includeComputeLogs: Type.Optional(Type.Boolean({ description: "Include explicitly available bounded compute-log evidence; never returns an unbounded raw stream." })),
      compareLastSuccess: Type.Optional(Type.Boolean({ description: "Collect baseline candidates only; use dagster_compare_run for strict comparison." })),
    }),
    async execute(_toolCallId, params, signal) {
      return evidencePackCore(runtime, params, signal);
    },
  }));
}

function compactPack(pack: EvidencePack): EvidencePack {
  return {
    ...pack,
    failures: pack.failures.slice(0, 10).map((failure) => ({
      ...failure,
      errorChain: failure.errorChain?.slice(0, 4).map((item) => ({
        message: item.message,
        stack: item.stack?.slice(0, 2),
      })),
    })),
    stepEvents: pack.stepEvents.slice(0, 20),
    computeLogs: pack.computeLogs.map((log) => ({
      ...log,
      stdoutTail: log.stdoutTail?.slice(-1_500),
      stderrTail: log.stderrTail?.slice(-1_500),
    })),
    upstream: pack.upstream.slice(0, 20),
  };
}

function stableStrings(values: string[]): string[] {
  return [...new Set(values)].sort();
}
