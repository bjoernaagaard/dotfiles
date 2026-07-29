import { redactObject } from "../policy/redact.ts";

export const MAX_EVENTS = 200;
export const MAX_FAILURES = 25;
export const MAX_STEP_EVENTS = 100;
export const MAX_LOGS = 10;
export const MAX_LOG_CHARS_PER_STREAM = 8_000;
export const MAX_UPSTREAM_ASSETS = 50;
export const MAX_CHECKS_PER_ASSET = 20;
export const MAX_MATERIALIZATIONS_PER_ASSET = 3;
export const MAX_BASELINE_CANDIDATES = 50;
export const MAX_LOCATIONS = 50;
export const MAX_COLLISIONS = 50;
export const DAGSTER_PARTITION_TAG = "dagster/partition";

export type EvidenceAvailability =
  | "available"
  | "empty"
  | "unavailable"
  | "external"
  | "unsupported"
  | "partial";

export type ErrorChainItem = { message: string; stack?: string[] };
export type FailureEvidence = {
  stepKey?: string;
  eventType?: string;
  message: string;
  errorChain?: ErrorChainItem[];
};
export type StepEventEvidence = {
  timestamp?: string;
  stepKey?: string;
  type: string;
  summary: string;
};
export type ComputeLogEvidence = {
  stepKey?: string;
  fileKey?: string;
  stdoutTail?: string;
  stderrTail?: string;
  availability: EvidenceAvailability;
  note?: string;
};
export type UpstreamEvidence = {
  assetKey: string[];
  latestMaterialization?: { runId?: string; timestamp?: string; partition?: string };
  failedChecks?: Array<{ name: string; status?: string; message?: string }>;
};
export type EvidencePack = {
  run: DiagnosticRun;
  failures: FailureEvidence[];
  stepEvents: StepEventEvidence[];
  computeLogs: ComputeLogEvidence[];
  upstream: UpstreamEvidence[];
  locations: Array<{ name: string; loadStatus?: string; error?: string }>;
  collisions: Array<{ kind: string; name: string; locations?: string[] }>;
  baseline: {
    available: boolean;
    runId?: string;
    reason?: string;
    matchedBy?: string[];
    /** Compact categorized highlights vs last success (full diff via dagster_compare_run). */
    highlights?: BaselineHighlights;
  };
  classificationHints?: string[];
  partial: boolean;
  warnings: string[];
  overflowPath?: string;
};

export type BaselineHighlights = {
  configChanges: number;
  tagChanges: number;
  partitionChanged: boolean;
  stepStatusChanges: number;
  assetSelectionChanges: number;
  checkStatusChanges: number;
  sample: string[];
};

export type DiagnosticRun = {
  runId: string;
  status: string;
  jobName?: string;
  pipelineName?: string;
  startTime?: number;
  endTime?: number;
  partition?: string;
  tags: Array<{ key: string; value: string }>;
  runConfig?: unknown;
  parentRunId?: string;
  rootRunId?: string;
  repositoryName?: string;
  repositoryLocationName?: string;
  assetSelection: string[][];
  assetChecks: Array<{ assetKey: string[]; checkName: string; status?: string }>;
  steps: Array<{ stepKey: string; status?: string }>;
};

export type RunComparison = {
  runId: string;
  baseline?: { runId: string; matchedBy: string[]; endTime?: number };
  noBaselineReason?: string;
  searchedConstraints?: string[];
  changes: {
    config: Array<{ path: string; before?: unknown; after?: unknown }>;
    tags: Array<{ key: string; before?: string; after?: string }>;
    partition?: { before?: string; after?: string };
    steps: Array<{ stepKey: string; before?: string; after?: string }>;
    assets: Array<{ assetKey: string[]; change: string }>;
    checks: Array<{ assetKey?: string[]; checkName: string; before?: string; after?: string }>;
  };
  truncated: boolean;
  overflowPath?: string;
};

export type RunLookupResult =
  | { ok: true; run: DiagnosticRun; raw: Record<string, unknown> }
  | { ok: false; kind: "not_found" | "python_error" | "unsupported"; message: string };

export type LogCaptureKey = {
  fileKey: string;
  logKey?: string;
  stepKey?: string;
  stepKeys: string[];
  external: boolean;
  externalNote?: string;
};

const FAILURE_TYPES = new Set([
  "ExecutionStepFailureEvent",
  "ResourceInitFailureEvent",
  "RunFailureEvent",
  "HookErroredEvent",
]);

const STEP_TYPES = new Set([
  "ExecutionStepFailureEvent",
  "ExecutionStepStartEvent",
  "ExecutionStepSuccessEvent",
  "ExecutionStepSkippedEvent",
  "ExecutionStepUpForRetryEvent",
  "ExecutionStepRestartEvent",
  "ResourceInitFailureEvent",
  "ResourceInitStartedEvent",
  "ResourceInitSuccessEvent",
  "HookErroredEvent",
  "HookCompletedEvent",
  "HookSkippedEvent",
  "AssetCheckEvaluationEvent",
]);

export function sanitizeDiagnosticText(text: string, extraPatterns: string[] = []): string {
  let out = String(text ?? "");
  out = out
    .replace(/Bearer\s+[A-Za-z0-9._~+\x2F-]+/gi, "Bearer [REDACTED]")
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[REDACTED-JWT]")
    .replace(/([?&](?:token|api[_-]?key|secret|password|authorization)=)[^&#\s]+/gi, "$1[REDACTED]")
    // Avoid matching the Authorization suffix inside Proxy-Authorization via lookaround.
    .replace(
      /(?<![A-Za-z0-9_-])(password|secret|token|api[_-]?key|authorization|credentials|private[_-]?key|access[_-]?key)(?![A-Za-z0-9_-])\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;\]}]+)/gi,
      "$1=[REDACTED]",
    )
    // Credential-bearing HTTP headers last so full header names win.
    .replace(
      /\b(Cookie|Set-Cookie|Proxy-Authorization|Authorization|X-Api-Key|X-Auth-Token)\b\s*[:=]\s*[^\r\n]+/gi,
      "$1: [REDACTED]",
    );
  for (const raw of extraPatterns) {
    if (!raw) continue;
    const key = escapeRegExp(raw);
    out = out.replace(
      new RegExp(`(?<![A-Za-z0-9_-])(${key})(?![A-Za-z0-9_-])\\s*[:=]\\s*[^\\r\\n]+`, "gi"),
      "$1: [REDACTED]",
    );
  }
  return out;
}

export function redactDiagnosticValue(value: unknown, extraPatterns: string[] = []): unknown {
  const keyed = redactObject(value, extraPatterns);
  return sanitizeWalk(keyed, extraPatterns);
}

function sanitizeWalk(value: unknown, extraPatterns: string[]): unknown {
  if (typeof value === "string") return sanitizeDiagnosticText(value, extraPatterns);
  if (Array.isArray(value)) return value.map((item) => sanitizeWalk(item, extraPatterns));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      sanitizeWalk(item, extraPatterns),
    ]),
  );
}

export function mapDiagnosticRunOrError(
  payload: { runOrError?: unknown },
  extraPatterns: string[] = [],
): RunLookupResult {
  const node = asRecord(payload.runOrError);
  const typename = asString(node.__typename);
  if (typename === "RunNotFoundError") {
    return { ok: false, kind: "not_found", message: safeText(node.message, extraPatterns, "Run not found") };
  }
  if (typename === "PythonError") {
    return { ok: false, kind: "python_error", message: safeText(node.message, extraPatterns, "Dagster PythonError") };
  }
  if (typename !== "Run") {
    return { ok: false, kind: "unsupported", message: `Unsupported run result: ${typename || "unknown"}` };
  }

  const tags = mapTags(node.tags, extraPatterns);
  const partition = parsePartitionTag(tags);
  const stats = Array.isArray(node.stepStats) ? node.stepStats : [];
  const checks = Array.isArray(node.assetChecks)
    ? node.assetChecks
    : Array.isArray(node.assetCheckSelection)
      ? node.assetCheckSelection
      : [];
  const repositoryOrigin = asRecord(node.repositoryOrigin);
  const runConfig = node.runConfig !== undefined ? node.runConfig : parseRunConfig(node.runConfigYaml);
  const rawAssets = Array.isArray(node.assetSelection) ? node.assetSelection : [];

  const run: DiagnosticRun = {
    runId: asString(node.runId) || asString(node.id),
    status: asString(node.status) || asString(node.runStatus) || "UNKNOWN",
    jobName: optionalString(node.jobName),
    pipelineName: optionalString(node.pipelineName),
    startTime: optionalNumber(node.startTime),
    endTime: optionalNumber(node.endTime),
    partition,
    tags,
    runConfig: redactDiagnosticValue(runConfig, extraPatterns),
    parentRunId: optionalString(node.parentRunId),
    rootRunId: optionalString(node.rootRunId),
    repositoryName: optionalString(repositoryOrigin.repositoryName),
    repositoryLocationName: optionalString(repositoryOrigin.repositoryLocationName),
    assetSelection: stableAssetKeys(rawAssets),
    assetChecks: checks
      .map((item) => {
        const rec = asRecord(item);
        return {
          assetKey: assetPath(rec.assetKey),
          checkName: asString(rec.name) || asString(rec.checkName),
          status: optionalString(rec.status),
        };
      })
      .filter((item) => item.checkName)
      .sort(compareChecks),
    steps: stats
      .map((item) => {
        const rec = asRecord(item);
        return { stepKey: asString(rec.stepKey), status: optionalString(rec.status) };
      })
      .filter((item) => item.stepKey)
      .sort((a, b) => a.stepKey.localeCompare(b.stepKey)),
  };
  return { ok: true, run, raw: node };
}

export function parsePartitionTag(tags: Array<{ key: string; value: string }>): string | undefined {
  return tags.find((tag) => tag.key === DAGSTER_PARTITION_TAG)?.value;
}

export function mapFailureEvents(
  events: unknown,
  extraPatterns: string[] = [],
): FailureEvidence[] {
  const output: FailureEvidence[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(events) ? events : []) {
    const event = asRecord(raw);
    const typename = asString(event.__typename);
    if (!FAILURE_TYPES.has(typename)) continue;
    const message = bounded(safeText(event.message, extraPatterns, typename), 2_000);
    const chain = mapPythonErrorChain(event.error, extraPatterns);
    const key = `${asString(event.stepKey)}\0${typename}\0${message}\0${chain.map((x) => x.message).join("|")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push({
      stepKey: optionalString(event.stepKey),
      eventType: optionalString(event.eventType) ?? typename,
      message,
      errorChain: chain.length ? chain : undefined,
    });
    if (output.length >= MAX_FAILURES) break;
  }
  return output;
}

export function mapStepEvents(
  events: unknown,
  extraPatterns: string[] = [],
): StepEventEvidence[] {
  const seen = new Set<string>();
  const out: StepEventEvidence[] = [];
  for (const raw of Array.isArray(events) ? events : []) {
    const event = asRecord(raw);
    const typename = asString(event.__typename);
    if (!STEP_TYPES.has(typename)) continue;
    const item: StepEventEvidence = {
      timestamp: optionalString(event.timestamp),
      stepKey: optionalString(event.stepKey),
      type: optionalString(event.eventType) ?? typename,
      summary: bounded(safeText(event.message, extraPatterns, typename), 1_000),
    };
    const key = `${item.timestamp ?? ""}\0${item.stepKey ?? ""}\0${item.type}\0${item.summary}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out
    .sort((a, b) =>
      (a.timestamp ?? "").localeCompare(b.timestamp ?? "") ||
      (a.stepKey ?? "").localeCompare(b.stepKey ?? "") ||
      a.type.localeCompare(b.type) ||
      a.summary.localeCompare(b.summary),
    )
    .slice(0, MAX_STEP_EVENTS);
}

export function extractLogsCapturedKeys(events: unknown): LogCaptureKey[] {
  const seen = new Set<string>();
  const out: LogCaptureKey[] = [];
  for (const raw of Array.isArray(events) ? events : []) {
    const event = asRecord(raw);
    if (asString(event.__typename) !== "LogsCapturedEvent") continue;
    const fileKey = asString(event.fileKey);
    if (!fileKey || seen.has(fileKey)) continue;
    seen.add(fileKey);
    const externalUrls = [event.externalUrl, event.externalStdoutUrl, event.externalStderrUrl]
      .map(optionalString)
      .filter((x): x is string => Boolean(x));
    out.push({
      fileKey,
      logKey: optionalString(event.logKey),
      stepKey: optionalString(event.stepKey),
      stepKeys: stringArray(event.stepKeys).sort(),
      external: externalUrls.length > 0,
      externalNote: externalUrls.length > 0 ? "Logs are stored externally" : undefined,
    });
    if (out.length >= MAX_LOGS) break;
  }
  return out;
}

export function mapCapturedLogs(
  payload: { runOrError?: unknown },
  key: LogCaptureKey,
  extraPatterns: string[] = [],
): ComputeLogEvidence {
  const node = asRecord(payload.runOrError);
  const typename = asString(node.__typename);
  const base = { stepKey: key.stepKey ?? key.stepKeys[0], fileKey: key.fileKey };
  if (typename === "RunNotFoundError" || typename === "PythonError") {
    return {
      ...base,
      availability: "unavailable",
      note: bounded(safeText(node.message, extraPatterns, "Captured logs unavailable"), 500),
    };
  }
  if (typename !== "Run") {
    return { ...base, availability: "unsupported", note: "Captured logs unsupported by this result" };
  }
  const logs = asRecord(node.capturedLogs);
  const stdout = typeof logs.stdout === "string" ? sanitizeDiagnosticText(logs.stdout, extraPatterns) : undefined;
  const stderr = typeof logs.stderr === "string" ? sanitizeDiagnosticText(logs.stderr, extraPatterns) : undefined;
  if (stdout === undefined && stderr === undefined) {
    return key.external
      ? { ...base, availability: "external", note: key.externalNote }
      : { ...base, availability: "unavailable", note: "No inline stdout/stderr was returned" };
  }
  if (!stdout && !stderr) {
    return { ...base, availability: "empty", note: "Captured stdout/stderr are empty" };
  }
  return {
    ...base,
    stdoutTail: stdout ? tail(stdout, MAX_LOG_CHARS_PER_STREAM) : undefined,
    stderrTail: stderr ? tail(stderr, MAX_LOG_CHARS_PER_STREAM) : undefined,
    availability: "available",
  };
}

export function mapUpstreamEvidence(
  payload: { assetNodes?: unknown },
  extraPatterns: string[] = [],
): UpstreamEvidence[] {
  const nodes = Array.isArray(payload.assetNodes) ? payload.assetNodes : [];
  return nodes
    .map((raw) => {
      const node = asRecord(raw);
      const mats = Array.isArray(node.assetMaterializations) ? node.assetMaterializations : [];
      const latest = mats
        .map(asRecord)
        .sort((a, b) => asString(b.timestamp).localeCompare(asString(a.timestamp)))[0];
      const checksUnion = asRecord(node.assetChecksOrError);
      const checks = Array.isArray(checksUnion.checks) ? checksUnion.checks : [];
      const failedChecks = checks
        .map((rawCheck) => {
          const check = asRecord(rawCheck);
          const execution = asRecord(check.executionForLatestMaterialization);
          const evaluation = asRecord(execution.evaluation);
          const status = optionalString(execution.status);
          return {
            name: asString(check.name),
            status,
            message: optionalString(evaluation.description)
              ? bounded(safeText(evaluation.description, extraPatterns), 1_000)
              : undefined,
          };
        })
        .filter((check) => check.name && check.status !== "SUCCEEDED")
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, MAX_CHECKS_PER_ASSET);
      return {
        assetKey: assetPath(node.assetKey),
        latestMaterialization: latest
          ? {
              runId: optionalString(latest.runId),
              timestamp: optionalString(latest.timestamp),
              partition: optionalString(latest.partition),
            }
          : undefined,
        failedChecks: failedChecks.length ? failedChecks : undefined,
      } satisfies UpstreamEvidence;
    })
    .filter((item) => item.assetKey.length > 0)
    .sort((a, b) => keyString(a.assetKey).localeCompare(keyString(b.assetKey)))
    .slice(0, MAX_UPSTREAM_ASSETS);
}

export function extractDependencyKeys(payload: { assetNodes?: unknown }): string[][] {
  const nodes = Array.isArray(payload.assetNodes) ? payload.assetNodes : [];
  return stableAssetKeys(
    nodes.flatMap((raw) => {
      const node = asRecord(raw);
      return Array.isArray(node.dependencyKeys) ? node.dependencyKeys : [];
    }),
  ).slice(0, MAX_UPSTREAM_ASSETS);
}

export function mapLocationEvidence(
  payload: { workspaceOrError?: unknown },
  extraPatterns: string[] = [],
): { locations: EvidencePack["locations"]; warning?: string } {
  const root = asRecord(payload.workspaceOrError);
  const typename = asString(root.__typename);
  if (typename === "PythonError") {
    return { locations: [], warning: safeText(root.message, extraPatterns, "Workspace health unavailable") };
  }
  if (typename !== "Workspace") return { locations: [], warning: "Workspace location evidence unsupported" };
  const entries = Array.isArray(root.locationEntries) ? root.locationEntries : [];
  return {
    locations: entries
      .map((raw) => {
        const item = asRecord(raw);
        const location = asRecord(item.locationOrLoadError);
        return {
          name: asString(item.name),
          loadStatus: optionalString(item.loadStatus),
          error:
            asString(location.__typename) === "PythonError"
              ? bounded(safeText(location.message, extraPatterns), 2_000)
              : undefined,
        };
      })
      .filter((item) => item.name)
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, MAX_LOCATIONS),
    warning: entries.length > MAX_LOCATIONS ? `Location evidence limited to ${MAX_LOCATIONS}` : undefined,
  };
}

export function mapCollisionEvidence(payload: { assetNodeDefinitionCollisions?: unknown }): EvidencePack["collisions"] {
  const collisions = Array.isArray(payload.assetNodeDefinitionCollisions)
    ? payload.assetNodeDefinitionCollisions
    : [];
  return collisions
    .map((raw) => {
      const item = asRecord(raw);
      const repositories = Array.isArray(item.repositories) ? item.repositories : [];
      return {
        kind: "asset_definition",
        name: keyString(assetPath(item.assetKey)),
        locations: repositories
          .map((repo) => asString(asRecord(asRecord(repo).location).name))
          .filter(Boolean)
          .sort(),
      };
    })
    .filter((item) => item.name)
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, MAX_COLLISIONS);
}

export function selectComparableBaseline(
  current: DiagnosticRun,
  candidates: DiagnosticRun[],
): { baseline?: DiagnosticRun; matchedBy: string[]; reason?: string; constraints: string[] } {
  const constraints = ["status=SUCCESS", `job=${current.jobName ?? current.pipelineName ?? "unknown"}`];
  if (current.repositoryName || current.repositoryLocationName) constraints.push("same repository/location");
  if (current.partition) constraints.push(`partition=${current.partition}`);
  if (current.assetSelection.length) constraints.push("same asset selection");

  const currentIdentity = current.jobName ?? current.pipelineName;
  const currentAssets = new Set(current.assetSelection.map(keyString));
  const strict = candidates.filter((candidate) => {
    if (candidate.status !== "SUCCESS" || candidate.runId === current.runId) return false;
    if ((candidate.jobName ?? candidate.pipelineName) !== currentIdentity) return false;
    if (current.repositoryName && candidate.repositoryName !== current.repositoryName) return false;
    if (current.repositoryLocationName && candidate.repositoryLocationName !== current.repositoryLocationName) return false;
    if (current.partition && candidate.partition !== current.partition) return false;
    if (sameLineage(current, candidate)) return false;
    if (currentAssets.size) {
      const candidateAssets = new Set(candidate.assetSelection.map(keyString));
      if (candidateAssets.size !== currentAssets.size) return false;
      for (const key of currentAssets) if (!candidateAssets.has(key)) return false;
    }
    return true;
  });

  strict.sort((a, b) =>
    (b.endTime ?? Number.NEGATIVE_INFINITY) - (a.endTime ?? Number.NEGATIVE_INFINITY) ||
    (b.startTime ?? Number.NEGATIVE_INFINITY) - (a.startTime ?? Number.NEGATIVE_INFINITY) ||
    a.runId.localeCompare(b.runId),
  );
  const baseline = strict[0];
  if (!baseline) {
    return {
      matchedBy: [],
      constraints,
      reason: `No comparable successful run found within ${MAX_BASELINE_CANDIDATES} candidates (${constraints.join(", ")}).`,
    };
  }
  const matchedBy = ["status:SUCCESS", `job:${currentIdentity}`];
  if (current.repositoryName) matchedBy.push(`repository:${current.repositoryName}`);
  if (current.repositoryLocationName) matchedBy.push(`location:${current.repositoryLocationName}`);
  if (current.partition) matchedBy.push(`partition:${current.partition}`);
  if (currentAssets.size) matchedBy.push("asset-selection:exact");
  matchedBy.push("lineage:excluded-current-retry-family");
  return { baseline, matchedBy, constraints };
}

export function compareDiagnosticRuns(
  currentInput: DiagnosticRun,
  baselineInput: DiagnosticRun,
  matchedBy: string[],
  extraPatterns: string[] = [],
): RunComparison {
  const current = redactDiagnosticValue(currentInput, extraPatterns) as DiagnosticRun;
  const baseline = redactDiagnosticValue(baselineInput, extraPatterns) as DiagnosticRun;
  const config = diffValues(baseline.runConfig, current.runConfig);
  const tags = diffStringMap(
    new Map(baseline.tags.map((x) => [x.key, x.value])),
    new Map(current.tags.map((x) => [x.key, x.value])),
  ).map(({ key, before, after }) => ({ key, before, after }));
  const steps = diffStringMap(
    new Map(baseline.steps.map((x) => [x.stepKey, x.status])),
    new Map(current.steps.map((x) => [x.stepKey, x.status])),
  ).map(({ key, before, after }) => ({ stepKey: key, before, after }));
  const baselineAssets = new Set(baseline.assetSelection.map(keyString));
  const currentAssets = new Set(current.assetSelection.map(keyString));
  const assets = [...new Set([...baselineAssets, ...currentAssets])]
    .sort()
    .filter((key) => baselineAssets.has(key) !== currentAssets.has(key))
    .map((key) => ({ assetKey: key.split("/"), change: currentAssets.has(key) ? "added" : "removed" }));
  const checkKey = (x: { assetKey: string[]; checkName: string }) => `${keyString(x.assetKey)}\0${x.checkName}`;
  const baselineChecks = new Map(baseline.assetChecks.map((x) => [checkKey(x), x]));
  const currentChecks = new Map(current.assetChecks.map((x) => [checkKey(x), x]));
  const checks = [...new Set([...baselineChecks.keys(), ...currentChecks.keys()])]
    .sort()
    .filter((key) => baselineChecks.get(key)?.status !== currentChecks.get(key)?.status)
    .map((key) => {
      const before = baselineChecks.get(key);
      const after = currentChecks.get(key);
      return {
        assetKey: after?.assetKey ?? before?.assetKey,
        checkName: after?.checkName ?? before?.checkName ?? key,
        before: before?.status,
        after: after?.status,
      };
    });
  return {
    runId: current.runId,
    baseline: { runId: baseline.runId, matchedBy: [...matchedBy], endTime: baseline.endTime },
    changes: {
      config,
      tags,
      partition: baseline.partition !== current.partition
        ? { before: baseline.partition, after: current.partition }
        : undefined,
      steps,
      assets,
      checks,
    },
    truncated: false,
  };
}

export function noBaselineComparison(runId: string, reason: string, constraints: string[]): RunComparison {
  return {
    runId,
    noBaselineReason: reason,
    searchedConstraints: [...constraints],
    changes: { config: [], tags: [], steps: [], assets: [], checks: [] },
    truncated: false,
  };
}

export function classifyEvidence(pack: Pick<EvidencePack, "failures" | "upstream" | "locations" | "collisions" | "run">): string[] {
  const haystack = pack.failures.map((x) => `${x.eventType ?? ""} ${x.message}`).join(" ").toLowerCase();
  const hints = new Set<string>();
  if (/config|invalid.*config|missing.*field/.test(haystack)) hints.add("config");
  if (/resource|connection|timeout|memory|disk|network|worker/.test(haystack)) hints.add("resource/infra");
  if (/cancel|interrupt/.test(haystack) || /CANCEL/.test(pack.run.status)) hints.add("cancellation");
  if (/import|module|attribute|syntax|user code/.test(haystack)) hints.add("code");
  if (pack.upstream.some((x) => x.failedChecks?.length)) hints.add("asset check");
  if (pack.upstream.length && /upstream|input|load/.test(haystack)) hints.add("upstream data");
  if (pack.locations.some((x) => x.error) || pack.collisions.length) hints.add("location load");
  if (!hints.size) hints.add("unknown");
  return [...hints].sort();
}

export function formatEvidencePack(pack: EvidencePack): string {
  const lines = [
    `Dagster evidence pack: run ${pack.run.runId} (${pack.run.status})`,
    `Job: ${pack.run.jobName ?? pack.run.pipelineName ?? "unknown"}${pack.run.partition ? ` partition=${pack.run.partition}` : ""}`,
    `Classification hints: ${(pack.classificationHints ?? ["unknown"]).join(", ")}`,
    `Failures: ${pack.failures.length}; step events: ${pack.stepEvents.length}`,
  ];
  for (const failure of pack.failures.slice(0, 5)) {
    lines.push(`- ${failure.stepKey ? `${failure.stepKey}: ` : ""}${failure.message}`);
    for (const link of failure.errorChain?.slice(0, 4) ?? []) lines.push(`  caused by: ${link.message}`);
  }
  lines.push(`Compute logs: ${pack.computeLogs.map((x) => `${x.stepKey ?? x.fileKey ?? "log"}=${x.availability}`).join(", ") || "not requested/discovered"}`);
  for (const log of pack.computeLogs.filter((item) => item.availability === "available").slice(0, 3)) {
    if (log.stderrTail) lines.push(`- ${log.stepKey ?? log.fileKey ?? "log"} stderr tail: ${log.stderrTail.slice(-1_000)}`);
    if (log.stdoutTail) lines.push(`- ${log.stepKey ?? log.fileKey ?? "log"} stdout tail: ${log.stdoutTail.slice(-1_000)}`);
  }
  lines.push(`Upstream assets: ${pack.upstream.length}; failed checks: ${pack.upstream.reduce((n, x) => n + (x.failedChecks?.length ?? 0), 0)}`);
  lines.push(`Locations with errors: ${pack.locations.filter((x) => x.error).length}; collisions: ${pack.collisions.length}`);
  lines.push(
    pack.baseline.available
      ? `Last comparable success: ${pack.baseline.runId}`
      : `Last comparable success: unavailable (${pack.baseline.reason ?? "no baseline"})`,
  );
  if (pack.baseline.highlights) {
    const h = pack.baseline.highlights;
    lines.push(
      `Baseline highlights: config=${h.configChanges}, tags=${h.tagChanges}, partition=${h.partitionChanged ? 1 : 0}, steps=${h.stepStatusChanges}, assets=${h.assetSelectionChanges}, checks=${h.checkStatusChanges}`,
    );
    for (const sample of h.sample.slice(0, 6)) lines.push(`  • ${sample}`);
  }
  if (pack.warnings.length) lines.push(`Warnings: ${pack.warnings.join("; ")}`);
  if (pack.overflowPath) lines.push(`Redacted overflow: ${pack.overflowPath}`);
  return lines.join("\n");
}

/** Bound comparison into evidence-pack highlights (not the full structured diff). */
export function baselineHighlightsFromComparison(
  comparison: RunComparison,
  maxSamples = 6,
): BaselineHighlights | undefined {
  if (!comparison.baseline) return undefined;
  const { changes } = comparison;
  const sample: string[] = [];
  for (const item of changes.steps.slice(0, maxSamples)) {
    sample.push(`step ${item.stepKey}: ${item.before ?? "(missing)"} → ${item.after ?? "(missing)"}`);
  }
  for (const item of changes.config.slice(0, Math.max(0, maxSamples - sample.length))) {
    sample.push(`config ${item.path} changed`);
  }
  for (const item of changes.tags.slice(0, Math.max(0, maxSamples - sample.length))) {
    sample.push(`tag ${item.key} changed`);
  }
  for (const item of changes.assets.slice(0, Math.max(0, maxSamples - sample.length))) {
    sample.push(`asset ${item.assetKey.join("/")}: ${item.change}`);
  }
  for (const item of changes.checks.slice(0, Math.max(0, maxSamples - sample.length))) {
    sample.push(`check ${item.checkName}: ${item.before ?? "?"} → ${item.after ?? "?"}`);
  }
  if (changes.partition && sample.length < maxSamples) {
    sample.push(
      `partition: ${changes.partition.before ?? "(none)"} → ${changes.partition.after ?? "(none)"}`,
    );
  }
  return {
    configChanges: changes.config.length,
    tagChanges: changes.tags.length,
    partitionChanged: Boolean(changes.partition),
    stepStatusChanges: changes.steps.length,
    assetSelectionChanges: changes.assets.length,
    checkStatusChanges: changes.checks.length,
    sample,
  };
}

export function formatRunComparison(comparison: RunComparison): string {
  if (!comparison.baseline) {
    return `No comparable successful baseline for run ${comparison.runId}. ${comparison.noBaselineReason ?? "Re-run after a successful comparable execution exists."}`;
  }
  const { changes } = comparison;
  const lines = [
    `Run ${comparison.runId} compared with ${comparison.baseline.runId}`,
    `Matched by: ${comparison.baseline.matchedBy.join(", ")}`,
    `Changes: config=${changes.config.length}, tags=${changes.tags.length}, partition=${changes.partition ? 1 : 0}, steps=${changes.steps.length}, assets=${changes.assets.length}, checks=${changes.checks.length}`,
  ];
  for (const item of changes.config.slice(0, 10)) lines.push(`- config ${item.path}: ${display(item.before)} -> ${display(item.after)}`);
  for (const item of changes.tags.slice(0, 10)) lines.push(`- tag ${item.key}: ${item.before ?? "(missing)"} -> ${item.after ?? "(missing)"}`);
  for (const item of changes.steps.slice(0, 10)) lines.push(`- step ${item.stepKey}: ${item.before ?? "(missing)"} -> ${item.after ?? "(missing)"}`);
  if (comparison.truncated && comparison.overflowPath) lines.push(`Redacted overflow: ${comparison.overflowPath}`);
  return lines.join("\n");
}

export function mergeCheckStatusesFromEvents(run: DiagnosticRun, events: unknown): DiagnosticRun {
  const byKey = new Map(run.assetChecks.map((x) => [`${keyString(x.assetKey)}\0${x.checkName}`, { ...x }]));
  for (const raw of Array.isArray(events) ? events : []) {
    const event = asRecord(raw);
    if (asString(event.__typename) !== "AssetCheckEvaluationEvent") continue;
    const evaluation = asRecord(event.evaluation);
    const assetKey = assetPath(evaluation.assetKey);
    const checkName = asString(evaluation.checkName);
    if (!checkName) continue;
    const status = typeof evaluation.success === "boolean" ? (evaluation.success ? "SUCCEEDED" : "FAILED") : undefined;
    byKey.set(`${keyString(assetKey)}\0${checkName}`, { assetKey, checkName, status });
  }
  return { ...run, assetChecks: [...byKey.values()].sort(compareChecks) };
}

function mapPythonErrorChain(errorValue: unknown, extraPatterns: string[]): ErrorChainItem[] {
  const error = asRecord(errorValue);
  if (!Object.keys(error).length) return [];
  const out: ErrorChainItem[] = [];
  const add = (nodeValue: unknown): void => {
    const node = asRecord(nodeValue);
    const message = optionalString(node.message);
    if (!message) return;
    out.push({
      message: bounded(sanitizeDiagnosticText(message, extraPatterns), 2_000),
      stack: stringArray(node.stack)
        .map((x) => bounded(sanitizeDiagnosticText(x, extraPatterns), 1_000))
        .slice(0, 10),
    });
  };
  add(error);
  const chain = Array.isArray(error.errorChain) ? error.errorChain : [];
  for (const linkValue of chain) {
    const link = asRecord(linkValue);
    add(link.error);
    if (out.length >= 10) break;
  }
  if (out.length < 10) {
    for (const cause of Array.isArray(error.causes) ? error.causes : []) {
      add(cause);
      if (out.length >= 10) break;
    }
  }
  const deduped: ErrorChainItem[] = [];
  const seen = new Set<string>();
  for (const item of out) {
    const key = `${item.message}\0${item.stack?.join("|") ?? ""}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(item);
    }
  }
  return deduped;
}

function mapTags(value: unknown, extraPatterns: string[]): Array<{ key: string; value: string }> {
  const tags = Array.isArray(value) ? value : [];
  return tags
    .map((raw) => {
      const tag = asRecord(raw);
      const redacted = redactDiagnosticValue({ [asString(tag.key)]: asString(tag.value) }, extraPatterns) as Record<string, unknown>;
      const key = asString(tag.key);
      return { key, value: sanitizeDiagnosticText(asString(redacted[key]), extraPatterns) };
    })
    .filter((tag) => tag.key)
    .sort((a, b) => a.key.localeCompare(b.key) || a.value.localeCompare(b.value));
}

function parseRunConfig(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return trimmed;
  }
}

function stableAssetKeys(values: unknown[]): string[][] {
  const map = new Map<string, string[]>();
  for (const value of values) {
    const path = assetPath(value);
    if (path.length) map.set(keyString(path), path);
  }
  return [...map.values()].sort((a, b) => keyString(a).localeCompare(keyString(b)));
}

function assetPath(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((x): x is string => typeof x === "string");
  return stringArray(asRecord(value).path);
}

function sameLineage(a: DiagnosticRun, b: DiagnosticRun): boolean {
  const familyA = new Set([a.runId, a.rootRunId, a.parentRunId].filter((x): x is string => Boolean(x)));
  return [b.runId, b.rootRunId, b.parentRunId].some((x) => Boolean(x && familyA.has(x)));
}

function diffValues(before: unknown, after: unknown): Array<{ path: string; before?: unknown; after?: unknown }> {
  const left = flatten(before);
  const right = flatten(after);
  return [...new Set([...left.keys(), ...right.keys()])]
    .sort()
    .filter((path) => stableString(left.get(path)) !== stableString(right.get(path)))
    .map((path) => ({ path, before: left.get(path), after: right.get(path) }));
}

function flatten(value: unknown, path = "$", out = new Map<string, unknown>()): Map<string, unknown> {
  if (Array.isArray(value)) {
    if (!value.length) out.set(path, []);
    else value.forEach((item, i) => flatten(item, `${path}[${i}]`, out));
  } else if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    if (!entries.length) out.set(path, {});
    else for (const [key, item] of entries) flatten(item, `${path}.${key}`, out);
  } else {
    out.set(path, value);
  }
  return out;
}

function diffStringMap(
  before: Map<string, string | undefined>,
  after: Map<string, string | undefined>,
): Array<{ key: string; before?: string; after?: string }> {
  return [...new Set([...before.keys(), ...after.keys()])]
    .sort()
    .filter((key) => before.get(key) !== after.get(key))
    .map((key) => ({ key, before: before.get(key), after: after.get(key) }));
}

function safeText(value: unknown, extra: string[], fallback = ""): string {
  const text = optionalString(value) ?? fallback;
  return sanitizeDiagnosticText(text, extra);
}
function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length ? value : undefined;
}
function asString(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}
function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [];
}
function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}
function keyString(path: string[]): string {
  return path.join("/");
}
function tail(value: string, max: number): string {
  return value.length <= max ? value : value.slice(value.length - max);
}
function bounded(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}
function compareChecks(a: { assetKey: string[]; checkName: string }, b: { assetKey: string[]; checkName: string }): number {
  return keyString(a.assetKey).localeCompare(keyString(b.assetKey)) || a.checkName.localeCompare(b.checkName);
}
function stableString(value: unknown): string {
  return JSON.stringify(value) ?? "undefined";
}
function display(value: unknown): string {
  return value === undefined ? "(missing)" : stableString(value);
}
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
