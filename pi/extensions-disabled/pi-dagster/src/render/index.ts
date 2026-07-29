/**
 * Safe compact tool/entry renderers for high-value Dagster tools.
 * Never stringify arbitrary details; use explicit allowlists only.
 */
import type { AgentToolResult, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Box, Text, type Component } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { AuditEntry } from "../policy/audit.ts";
import type { IncidentState } from "../state/incident.ts";
import { formatAuditEntryLine } from "../policy/audit.ts";

const SECRET_KEY =
  /password|secret|token|api[_-]?key|authorization|cookie|runConfig|headers|variables|connectionParams/i;

/** Keys allowed in expanded renderer output (public ids / counts / statuses / paths). */
const SAFE_DETAIL_KEYS = new Set([
  "kind",
  "risk",
  "typename",
  "entityIds",
  "runId",
  "runIds",
  "watchId",
  "id",
  "status",
  "truncated",
  "tempPath",
  "overflowPath",
  "logPath",
  "eventCount",
  "completionReason",
  "operationType",
  "operationName",
  "rootFields",
  "endpoint",
  "redacted",
  "exitCode",
  "command",
  "argvSummary",
  "classificationHints",
  "evidencePointer",
  "baselineRunId",
  "partial",
  "message",
  "error",
  "ok",
  "action",
  "jobName",
  "assetKey",
  "backfillId",
  "locationName",
  "matches",
  "added",
  "watch",
  "watches",
]);

export type SafeSummary = {
  compact: string;
  expanded: string[];
  isError: boolean;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

function safeString(v: unknown, max = 120): string {
  if (v == null) return "";
  if (typeof v === "string") return v.length > max ? `${v.slice(0, max)}…` : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    const joined = v
      .slice(0, 8)
      .map((x) => safeString(x, 40))
      .join(", ");
    return v.length > 8 ? `${joined}, …` : joined;
  }
  return "";
}

function pickSafe(details: unknown): Record<string, unknown> {
  if (!isRecord(details)) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(details)) {
    if (SECRET_KEY.test(k)) continue;
    if (!SAFE_DETAIL_KEYS.has(k) && k !== "kind") continue;
    if (isRecord(v) && SECRET_KEY.test(JSON.stringify(Object.keys(v)))) continue;
    // Nested watch handle — only public fields
    if (k === "watch" && isRecord(v)) {
      out.watch = {
        id: v.id,
        runId: v.runId,
        status: v.status,
        logPath: v.logPath,
      };
      continue;
    }
    if (k === "watches" && Array.isArray(v)) {
      out.watches = v.slice(0, 10).map((w) =>
        isRecord(w)
          ? { id: w.id, runId: w.runId, status: w.status, logPath: w.logPath }
          : w,
      );
      continue;
    }
    if (k === "matches" && Array.isArray(v)) {
      out.matches = v.slice(0, 10).map((m) =>
        isRecord(m) ? { kind: m.kind, id: m.id, label: m.label } : m,
      );
      continue;
    }
    out[k] = v;
  }
  return out;
}

/**
 * Pure summary extraction — unit-testable without ANSI/TUI.
 */
export function extractSafeSummary(
  toolName: string,
  result: {
    content?: Array<{ type: string; text?: string }>;
    details?: unknown;
  },
  options?: { isError?: boolean; isPartial?: boolean },
): SafeSummary {
  if (options?.isPartial) {
    return { compact: `${toolName}…`, expanded: [`${toolName} in progress`], isError: false };
  }

  const details = pickSafe(result.details);
  const text =
    result.content
      ?.filter((c) => c.type === "text" && typeof c.text === "string")
      .map((c) => c.text!)
      .join("\n")
      .split("\n")[0] ?? "";

  const kind = safeString(details.kind) || toolName.replace(/^dagster_/, "");
  const risk = details.risk ? ` risk=${safeString(details.risk)}` : "";
  const ids =
    details.entityIds != null
      ? ` ids=${safeString(details.entityIds)}`
      : details.runId
        ? ` run=${safeString(details.runId)}`
        : details.id
          ? ` id=${safeString(details.id)}`
          : "";
  const status = details.status ? ` ${safeString(details.status)}` : "";
  const count =
    details.eventCount != null
      ? ` events=${safeString(details.eventCount)}`
      : details.matches != null && Array.isArray(details.matches)
        ? ` matches=${details.matches.length}`
        : "";
  const path =
    details.overflowPath || details.tempPath || details.logPath || details.evidencePointer
      ? ` path=${safeString(details.overflowPath ?? details.tempPath ?? details.logPath ?? details.evidencePointer, 80)}`
      : "";
  const completion = details.completionReason
    ? ` ${safeString(details.completionReason)}`
    : "";
  const exit =
    details.exitCode != null ? ` exit=${safeString(details.exitCode)}` : "";
  const roots = Array.isArray(details.rootFields)
    ? ` roots=${safeString(details.rootFields)}`
    : "";

  const errKind =
    options?.isError ||
    kind.includes("error") ||
    kind.includes("Error") ||
    details.kind === "error" ||
    Boolean(details.error);

  const compact =
    `${kind}${risk}${ids}${status}${count}${completion}${exit}${roots}${path}`.trim() ||
    text.slice(0, 120) ||
    toolName;

  const expanded: string[] = [compact];
  if (details.typename) expanded.push(`typename=${safeString(details.typename)}`);
  if (details.operationName) expanded.push(`op=${safeString(details.operationName)}`);
  if (details.endpoint) expanded.push(`endpoint=${safeString(details.endpoint, 100)}`);
  if (details.message) expanded.push(safeString(details.message, 200));
  if (details.command || details.argvSummary) {
    expanded.push(`cmd=${safeString(details.command ?? details.argvSummary, 160)}`);
  }
  if (details.classificationHints) {
    expanded.push(`hints=${safeString(details.classificationHints, 160)}`);
  }
  if (details.baselineRunId) expanded.push(`baseline=${safeString(details.baselineRunId)}`);
  if (text && text !== compact) expanded.push(text.slice(0, 200));

  // Bound expanded view
  return {
    compact: compact.slice(0, 200),
    expanded: expanded.slice(0, 20),
    isError: Boolean(errKind),
  };
}

export function renderSummaryComponent(
  summary: SafeSummary,
  theme: Theme,
  options?: { expanded?: boolean },
): Component {
  const color = summary.isError ? "error" : "success";
  if (!options?.expanded) {
    return new Text(theme.fg(color, summary.compact), 0, 0);
  }
  const box = new Box(0, 0);
  for (const line of summary.expanded) {
    box.addChild(new Text(theme.fg(color, line), 0, 0));
  }
  return box;
}

type AnyTool = ToolDefinition<any, any, any>;

/** Pure allowlist for tool-call rows. Never includes GraphQL documents or variables. */
export function extractSafeCallArguments(args: unknown): string[] {
  if (!isRecord(args)) return [];
  const parts: string[] = [];
  for (const key of ["runId", "jobName", "action", "operationName", "force"] as const) {
    if (args[key] != null && typeof args[key] !== "object") {
      parts.push(`${key}=${String(args[key]).slice(0, 40)}`);
    }
  }
  if (Array.isArray(args.args)) {
    parts.push(args.args.slice(0, 4).map(String).join(" "));
  }
  if (Array.isArray(args.assetSelection)) {
    parts.push(`assets=${args.assetSelection.slice(0, 3).map(String).join(",")}`);
  }
  return parts.filter((part) => !SECRET_KEY.test(part));
}

/**
 * Attach compact/safe renderCall + renderResult without changing execute/schema.
 */
export function attachSafeRenderers<T extends AnyTool>(tool: T): T {
  const name = tool.name;
  const short = name.replace(/^dagster_/, "");

  return {
    ...tool,
    renderCall(args: unknown, theme: Theme) {
      const bits: string[] = [theme.fg("toolTitle", theme.bold(short))];
      for (const part of extractSafeCallArguments(args)) {
        bits.push(theme.fg("dim", part));
      }
      return new Text(bits.join(" "), 0, 0);
    },
    renderResult(
      result: AgentToolResult<unknown>,
      options: { expanded: boolean; isPartial: boolean },
      theme: Theme,
      context: { isError?: boolean; lastComponent?: Component },
    ) {
      if (options.isPartial) {
        if (context.lastComponent) return context.lastComponent;
        return new Text(theme.fg("warning", `${short}…`), 0, 0);
      }
      const summary = extractSafeSummary(name, result, {
        isError: context.isError,
        isPartial: options.isPartial,
      });
      return renderSummaryComponent(summary, theme, { expanded: options.expanded });
    },
  } as T;
}

/** Expanded-aware audit entry card (compact one line; expanded safe fields). */
export function renderAuditEntryCard(
  data: AuditEntry | undefined,
  theme: Theme,
  options?: { expanded?: boolean },
): Component {
  const line = data ? formatAuditEntryLine(data) : "dagster.audit";
  if (!options?.expanded || !data) {
    const box = new Box(1, 0, (text) => theme.bg("customMessageBg", text));
    box.addChild(new Text(`${theme.fg("dim", "[dagster.audit]")} ${line}`, 0, 0));
    return box;
  }
  const box = new Box(1, 0, (text) => theme.bg("customMessageBg", text));
  box.addChild(new Text(`${theme.fg("dim", "[dagster.audit]")} ${line}`, 0, 0));
  const fields = [
    data.auditId ? `auditId=${data.auditId}` : null,
    data.profile ? `profile=${data.profile}` : null,
    data.endpoint ? `endpoint=${data.endpoint}` : null,
    data.entityIds?.length ? `entityIds=${data.entityIds.join(",")}` : null,
    `ts=${new Date(data.ts).toISOString()}`,
  ].filter(Boolean) as string[];
  for (const f of fields.slice(0, 8)) {
    box.addChild(new Text(theme.fg("dim", f), 0, 0));
  }
  return box;
}

export function renderIncidentEntryCard(
  data: IncidentState | undefined,
  theme: Theme,
  options?: { expanded?: boolean },
): Component {
  const line = data
    ? `run=${data.runId ?? data.entityIds.runIds[0] ?? "none"} profile=${data.profileName ?? "none"} audits=${data.auditIds.length} mutations=${data.mutations.length}`
    : "Dagster incident";
  const box = new Box(1, 0, (text) => theme.bg("customMessageBg", text));
  box.addChild(new Text(`${theme.fg("dim", "[dagster.incident]")} ${line}`, 0, 0));
  if (options?.expanded && data) {
    const fields = [
      data.runId ? `runId=${data.runId}` : null,
      data.evidencePointer ? `evidence=${data.evidencePointer}` : null,
      data.profileName ? `profile=${data.profileName}` : null,
      data.hypothesis ? `hypothesis=${data.hypothesis.slice(0, 120)}` : null,
    ].filter(Boolean) as string[];
    for (const f of fields.slice(0, 8)) {
      box.addChild(new Text(theme.fg("dim", f), 0, 0));
    }
  }
  return box;
}

/**
 * Whether a details object would leak secret-bearing keys if rendered wholesale.
 * Used by tests / adversarial checks.
 */
export function detailsContainSecretKeys(details: unknown): boolean {
  if (!isRecord(details)) return false;
  for (const k of Object.keys(details)) {
    if (SECRET_KEY.test(k)) return true;
  }
  return false;
}

export function filterDetailsForRender(details: unknown): Record<string, unknown> {
  return pickSafe(details);
}
