import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GraphqlClient } from "../../clients/graphql.ts";
import {
  DIAGNOSE_BASELINE_CANDIDATES_QUERY,
  DIAGNOSE_DEFAULT_VARIABLES,
  DIAGNOSE_RUN_QUERY,
} from "../../clients/documents/diagnose.gql.ts";
import {
  MAX_BASELINE_CANDIDATES,
  MAX_EVENTS,
  mapDiagnosticRunOrError,
  mergeCheckStatusesFromEvents,
  selectComparableBaseline,
  type DiagnosticRun,
} from "../../domain/diagnose.ts";

/** Hard cap on total events scanned while paginating (retain last MAX_EVENTS). */
export const MAX_EVENT_SCAN = MAX_EVENTS * 5;

export type LoadedDiagnosticRun = {
  run: DiagnosticRun;
  raw: Record<string, unknown>;
  events: unknown[];
  eventHasMore: boolean;
  /** True when early pages were discarded to keep the terminal window. */
  eventWindowTrimmed?: boolean;
};

export async function loadDiagnosticRun(
  client: GraphqlClient,
  runId: string,
  signal: AbortSignal | undefined,
  extraPatterns: string[],
): Promise<
  | { ok: true; value: LoadedDiagnosticRun }
  | { ok: false; kind: "not_found" | "python_error" | "unsupported"; message: string }
> {
  throwIfAborted(signal);
  const pageLimit = DIAGNOSE_DEFAULT_VARIABLES.eventLimit;
  let afterCursor: string | undefined;
  let serverHasMore = true;
  let scanned = 0;
  const collected: unknown[] = [];
  let mappedRun: ReturnType<typeof mapDiagnosticRunOrError> | null = null;
  let lastRaw: Record<string, unknown> = {};
  let stoppedEarly = false;

  // Paginate forward; keep only the newest MAX_EVENTS so terminal failure / LogsCaptured
  // evidence is retained even when the first page is only early steps.
  while (serverHasMore && scanned < MAX_EVENT_SCAN) {
    throwIfAborted(signal);
    const data = await client.request<{ runOrError?: unknown }>({
      query: DIAGNOSE_RUN_QUERY,
      variables: {
        runId,
        eventLimit: pageLimit,
        afterCursor: afterCursor ?? null,
      },
      operationName: "DagsterDiagnoseRun",
      signal,
    });
    const mapped = mapDiagnosticRunOrError(data, extraPatterns);
    if (!mapped.ok) return mapped;
    mappedRun = mapped;
    lastRaw = mapped.raw;
    const connection = asRecord(mapped.raw.eventConnection);
    const page = Array.isArray(connection.events) ? connection.events : [];
    collected.push(...page);
    scanned += page.length;
    serverHasMore = connection.hasMore === true;
    const nextCursor = typeof connection.cursor === "string" ? connection.cursor : undefined;
    // Avoid infinite loops if the server returns hasMore without advancing cursor.
    if (!page.length || !nextCursor || nextCursor === afterCursor) {
      if (serverHasMore) stoppedEarly = true;
      break;
    }
    afterCursor = nextCursor;
    if (scanned >= MAX_EVENT_SCAN && serverHasMore) {
      stoppedEarly = true;
      break;
    }
  }

  if (!mappedRun || !mappedRun.ok) {
    return { ok: false, kind: "unsupported", message: "Failed to load diagnostic run" };
  }

  const trimmed = collected.length > MAX_EVENTS;
  const events = trimmed ? collected.slice(-MAX_EVENTS) : collected;
  // hasMore is true when more server pages remain, we hit the scan cap, or we kept only the tail.
  const eventHasMore = serverHasMore || stoppedEarly || trimmed;

  return {
    ok: true,
    value: {
      run: mergeCheckStatusesFromEvents(mappedRun.run, events),
      raw: lastRaw,
      events,
      eventHasMore,
      eventWindowTrimmed: trimmed,
    },
  };
}

export async function resolveBaseline(
  client: GraphqlClient,
  current: DiagnosticRun,
  signal: AbortSignal | undefined,
  extraPatterns: string[],
): Promise<{
  baseline?: DiagnosticRun;
  baselineLoaded?: LoadedDiagnosticRun;
  matchedBy: string[];
  constraints: string[];
  reason?: string;
}> {
  throwIfAborted(signal);
  const identity = current.pipelineName ?? current.jobName;
  if (!identity) {
    return {
      matchedBy: [],
      constraints: ["status=SUCCESS", "same job/pipeline identity"],
      reason: "Current run has no job/pipeline identity, so a comparable baseline cannot be selected.",
    };
  }
  const data = await client.request<{ runsOrError?: unknown }>({
    query: DIAGNOSE_BASELINE_CANDIDATES_QUERY,
    variables: {
      filter: { pipelineName: identity, statuses: ["SUCCESS"] },
      limit: MAX_BASELINE_CANDIDATES,
    },
    operationName: "DagsterDiagnoseBaselineCandidates",
    signal,
  });
  const root = asRecord(data.runsOrError);
  if (root.__typename !== "Runs") {
    return {
      matchedBy: [],
      constraints: ["status=SUCCESS", `job=${identity}`],
      reason: typeof root.message === "string"
        ? `Baseline query unavailable: ${root.message}`
        : `Baseline query returned ${String(root.__typename ?? "unsupported")}`,
    };
  }
  const candidates = (Array.isArray(root.results) ? root.results : [])
    .map((raw) => mapDiagnosticRunOrError({ runOrError: raw }, extraPatterns))
    .filter((result): result is Extract<typeof result, { ok: true }> => result.ok)
    .map((result) => result.run);
  const selected = selectComparableBaseline(current, candidates);
  if (!selected.baseline) return selected;

  // Fetch the one selected baseline with bounded comparison fields/events.
  throwIfAborted(signal);
  const loaded = await loadDiagnosticRun(client, selected.baseline.runId, signal, extraPatterns);
  if (!loaded.ok) {
    return {
      matchedBy: selected.matchedBy,
      constraints: selected.constraints,
      reason: `Selected baseline ${selected.baseline.runId} could not be loaded: ${loaded.message}`,
    };
  }
  return {
    baseline: loaded.value.run,
    baselineLoaded: loaded.value,
    matchedBy: selected.matchedBy,
    constraints: selected.constraints,
  };
}

export async function writeDiagnosticOverflow(
  value: unknown,
  label: string,
): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pi-dagster-diagnose-"));
  const path = join(dir, `${safeLabel(label)}.json`);
  await writeFile(path, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 });
  // Explicit chmod protects platforms honoring a permissive process umask.
  await chmod(path, 0o600).catch(() => {});
  return path;
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const error = new Error("Aborted");
    error.name = "AbortError";
    throw error;
  }
}

export function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted || (error instanceof Error && error.name === "AbortError"));
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function safeLabel(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]+/g, "-").slice(0, 80) || "evidence";
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}
