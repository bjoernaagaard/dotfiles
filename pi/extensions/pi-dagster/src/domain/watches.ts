/**
 * Watch handle types + pure helpers for run-log watches.
 */

export type WatchKind = "run_logs" | "location_state";

export type WatchStatus = "active" | "stopped" | "error";

export type WatchHandle = {
  id: string;
  kind: WatchKind;
  runId?: string;
  startedAt: number;
  status: WatchStatus;
  lastEventAt?: number;
  lastError?: string;
  logPath?: string;
  urgentFailure?: boolean;
  eventCount?: number;
  notifyModel?: boolean;
};

export type RunLogEventSummary = {
  typename: string;
  message?: string;
  stepKey?: string | null;
  level?: string | null;
  eventType?: string | null;
  timestamp?: string | null;
};

const URGENT_TYPENAMES = new Set([
  "RunFailureEvent",
  "ExecutionStepFailureEvent",
  "ResourceInitFailureEvent",
  "HookErroredEvent",
  "AlertFailureEvent",
  "FailedToMaterializeEvent",
  "PipelineRunLogsSubscriptionFailure",
]);

export function isUrgentLogEvent(ev: RunLogEventSummary | { __typename?: string }): boolean {
  const t =
    "typename" in ev
      ? String(ev.typename ?? "")
      : String((ev as { __typename?: string }).__typename ?? "");
  return URGENT_TYPENAMES.has(t);
}

export function summarizeLogMessage(node: Record<string, unknown>): RunLogEventSummary {
  return {
    typename: String(node.__typename ?? "Unknown"),
    message: typeof node.message === "string" ? node.message : undefined,
    stepKey: (node.stepKey as string | null | undefined) ?? null,
    level: (node.level as string | null | undefined) ?? null,
    eventType: (node.eventType as string | null | undefined) ?? null,
    timestamp: (node.timestamp as string | null | undefined) ?? null,
  };
}

export function formatWatchStatus(handles: WatchHandle[]): string {
  if (handles.length === 0) return "No active watches.";
  return handles
    .map((h) => {
      const bits = [
        h.id,
        h.kind,
        h.status,
        h.runId ? `run=${h.runId}` : null,
        h.eventCount != null ? `events=${h.eventCount}` : null,
        h.urgentFailure ? "URGENT" : null,
        h.logPath ? `log=${h.logPath}` : null,
        h.lastError ? `err=${h.lastError}` : null,
      ].filter(Boolean);
      return bits.join(" ");
    })
    .join("\n");
}

export function makeWatchId(kind: WatchKind, seed?: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  const base = seed ? `${kind}:${seed}` : kind;
  return `watch:${base}:${Date.now().toString(36)}:${rand}`;
}
