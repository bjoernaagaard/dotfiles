import type {
  ExtensionAPI,
  ExtensionCommandContext,
  SessionBeforeCompactEvent,
} from "@earendil-works/pi-coding-agent";
import type { DagsterRuntime } from "../runtime.ts";
import {
  MAX_HANDOFF_CHARS,
  clearOpenIncident,
  cloneIncidentState,
  formatIncidentState,
  mergeIncidentState,
  reconstructIncidentState,
  type IncidentPatch,
  type IncidentState,
} from "../state/incident.ts";
import { sanitizeDiagnosticText } from "../domain/diagnose.ts";
import type { BranchEntry } from "../state/session.ts";
import { renderIncidentEntryCard } from "../render/index.ts";

export function registerDiagnose(pi: ExtensionAPI, runtime: DagsterRuntime): void {
  try {
    pi.registerEntryRenderer<IncidentState>("dagster.incident", (entry, options, theme) => {
      return renderIncidentEntryCard(entry.data, theme, {
        expanded: Boolean((options as { expanded?: boolean } | undefined)?.expanded),
      });
    });
  } catch {
    // Entry rendering is optional in non-TUI contexts.
  }

  pi.on("session_before_compact", createDagsterCompactionHandler(runtime));
}

export async function handleIncidentCommand(
  args: string,
  ctx: ExtensionCommandContext,
  runtime: DagsterRuntime,
): Promise<void> {
  const trimmed = args.trim();
  const [head = "show"] = trimmed.split(/\s+/, 1);
  const command = head.toLowerCase();
  const extra = runtime.getActiveProfile()?.redaction?.extraKeyPatterns ?? [];

  if (command === "show" || !trimmed) {
    await ctx.ui.notify(formatIncidentState(runtime.getIncidentSnapshot()), "info");
    return;
  }

  if (command === "clear") {
    const state = runtime.clearIncident();
    appendIncident(runtime, { clear: true, state });
    await ctx.ui.notify("Cleared open Dagster incident metadata; audit history was retained.", "info");
    return;
  }

  if (command === "fork") {
    await forkIncident(trimmed.slice(head.length).trim(), ctx, runtime, extra);
    return;
  }

  const runId = sanitizeDiagnosticText(head.trim(), extra).slice(0, 300);
  if (!runId) {
    await ctx.ui.notify(incidentUsage(), "error");
    return;
  }
  const hypothesis = parseHypothesis(trimmed.slice(head.length), extra);
  const previous = runtime.getIncidentSnapshot();
  const state = runtime.recordIncident({
    runId,
    hypothesis,
    evidencePointer: previous.evidencePointer,
    profileName: runtime.activeProfileName ?? undefined,
    entityIds: { runIds: [runId] },
  });
  appendIncident(runtime, state);
  runtime.rememberEntity("run", runId);
  await ctx.ui.notify(`Recorded Dagster incident.\n${formatIncidentState(state)}`, "info");
}

export function createDagsterCompactionHandler(runtime: DagsterRuntime) {
  return async (
    event: SessionBeforeCompactEvent,
  ) => {
    if (event.signal.aborted) return undefined;
    // Overflow recovery should use Pi's default path so retry semantics remain untouched.
    if (event.reason === "overflow" && event.willRetry) return undefined;

    const extra = runtime.getActiveProfile()?.redaction?.extraKeyPatterns ?? [];
    const branchState = reconstructIncidentState(event.branchEntries as unknown as BranchEntry[], extra);
    const liveState = runtime.getIncidentSnapshot();
    const state = mergeIncidentState(branchState, liveState, extra);
    if (!hasIncidentContext(state)) return undefined;

    const general = buildGeneralContext(event, extra);
    // A custom summary replaces Pi's summary. Defer rather than emit Dagster-only context.
    if (!general) return undefined;
    if (event.signal.aborted) return undefined;

    const policy = runtime.getEffectivePolicy();
    const profile = state.profileName ?? runtime.activeProfileName ?? "none";
    const mutationLines = state.mutations.slice(-15).map((mutation) =>
      `- [${mutation.auditId}] ${mutation.tool} → ${mutation.outcome}: ${mutation.summary}`,
    );
    const summary = boundSummary([
      general,
      "",
      "Dagster context:",
      `- Profile/policy: ${profile} / ${policy}`,
      `- Runs: ${state.entityIds.runIds.join(", ") || state.runId || "none"}`,
      `- Assets: ${state.entityIds.assetKeys.join(", ") || "none"}`,
      `- Backfills: ${state.entityIds.backfillIds.join(", ") || "none"}`,
      `- Open hypothesis: ${state.hypothesis ?? "none"}`,
      `- Evidence: ${state.evidencePointer ?? "re-run dagster_evidence_pack"}`,
      `- Audit pointers: ${state.auditIds.slice(-30).join(", ") || "none"}`,
      "- Mutations:",
      ...(mutationLines.length ? mutationLines : ["  (none)"]),
      "- Next safe step: verify evidence, then use existing policy-gated remediation; validate with dg check before relaunch.",
    ].join("\n"));
    const files = computeCumulativeFileLists(event.preparation.fileOps);

    return {
      compaction: {
        summary,
        firstKeptEntryId: event.preparation.firstKeptEntryId,
        tokensBefore: event.preparation.tokensBefore,
        details: {
          // Pi 0.80.8 default cumulative file-operation convention.
          readFiles: files.readFiles,
          modifiedFiles: files.modifiedFiles,
          fileOps: {
            readFiles: files.readFiles,
            modifiedFiles: files.modifiedFiles,
          },
          dagster: {
            // Full sanitized incident snapshot for compact-then-reload reconstruction.
            profileName: profile,
            policy,
            runId: state.runId,
            hypothesis: state.hypothesis,
            evidencePointer: state.evidencePointer,
            handoff: state.handoff,
            runIds: state.entityIds.runIds,
            assetKeys: state.entityIds.assetKeys,
            backfillIds: state.entityIds.backfillIds,
            auditIds: state.auditIds.slice(-30),
            mutations: state.mutations.slice(-15).map((mutation) => ({
              auditId: mutation.auditId,
              tool: mutation.tool,
              outcome: mutation.outcome,
              summary: mutation.summary,
              entityIds: mutation.entityIds,
            })),
            incident: {
              runId: state.runId,
              hypothesis: state.hypothesis,
              evidencePointer: state.evidencePointer,
              profileName: profile,
              handoff: state.handoff,
              entityIds: state.entityIds,
              mutations: state.mutations.slice(-15),
              auditIds: state.auditIds.slice(-30),
            },
            redacted: true,
          },
        },
      },
    };
  };
}

export function buildIncidentHandoff(state: IncidentState, policy: string): string {
  const profile = state.profileName ?? "none";
  const text = [
    "Dagster incident hypothesis branch.",
    `Profile: ${profile} (reapply by name; policy: ${policy})`,
    `Run: ${state.runId ?? state.entityIds.runIds[0] ?? "unknown"}`,
    `Hypothesis: ${state.hypothesis ?? "not recorded"}`,
    `Evidence: ${state.evidencePointer ?? "re-run dagster_evidence_pack"}`,
    `Audit pointers: ${state.auditIds.slice(-30).join(", ") || "none"}`,
    `Entity pointers: runs=${state.entityIds.runIds.join(",") || "none"}; assets=${state.entityIds.assetKeys.join(",") || "none"}; backfills=${state.entityIds.backfillIds.join(",") || "none"}`,
    "Continue with evidence verification; use existing policy-gated tools for remediation. Validate source/config changes with dg check before relaunch.",
  ].join("\n");
  return text.length <= MAX_HANDOFF_CHARS ? text : `${text.slice(0, MAX_HANDOFF_CHARS)}…`;
}

async function forkIncident(
  args: string,
  ctx: ExtensionCommandContext,
  runtime: DagsterRuntime,
  extra: string[],
): Promise<void> {
  if (!ctx.hasUI || typeof ctx.fork !== "function") {
    await ctx.ui.notify("/dagster-incident fork requires an interactive session with fork support.", "error");
    return;
  }

  const current = runtime.getIncidentSnapshot();
  if (!current.runId && current.entityIds.runIds.length === 0) {
    await ctx.ui.notify("No open Dagster incident. Record one before forking.", "error");
    return;
  }
  const hypothesis = parseHypothesis(args, extra) ?? current.hypothesis;
  if (!hypothesis) {
    await ctx.ui.notify("Provide one explicit hypothesis: /dagster-incident fork hypothesis=\"…\"", "error");
    return;
  }

  const policy = String(runtime.getEffectivePolicy());
  const captured = runtime.recordIncident({
    hypothesis,
    profileName: runtime.activeProfileName ?? current.profileName,
  });
  const handoff = buildIncidentHandoff(captured, policy);
  const plainDetails = JSON.parse(JSON.stringify({ ...captured, handoff })) as IncidentState;
  appendIncident(runtime, plainDetails);

  // Read the leaf only from the current manager, after the incident custom entry is appended.
  const leafId = ctx.sessionManager.getLeafId();
  if (!leafId) {
    await ctx.ui.notify("Cannot fork Dagster incident: current session has no leaf entry.", "error");
    return;
  }

  const result = await ctx.fork(String(leafId), {
    position: "at",
    withSession: async (freshCtx) => {
      // Only JSON-safe captured data and the fresh replacement-session context are used here.
      await freshCtx.sendMessage(
        {
          customType: "dagster.incident",
          content: handoff,
          display: true,
          details: plainDetails,
        },
        { triggerTurn: false },
      );
    },
  });
  if (result.cancelled) {
    await ctx.ui.notify(
      "Dagster incident fork was cancelled (an active dg dev session must be stopped first).",
      "warning",
    );
  }
  // Successful replacement is terminal: never touch old ctx/pi/runtime after this point.
}

function appendIncident(runtime: DagsterRuntime, data: unknown): void {
  try {
    runtime.pi.appendEntry("dagster.incident", data);
  } catch {
    // Best effort; live runtime state and replacement handoff remain available.
  }
}

function parseHypothesis(args: string, extra: string[]): string | undefined {
  const match = args.match(/(?:^|\s)hypothesis=(?:"([^"]*)"|'([^']*)'|(\S+))/i);
  const raw = match?.[1] ?? match?.[2] ?? match?.[3];
  if (!raw) return undefined;
  const safe = sanitizeDiagnosticText(raw.replace(/\s+/g, " ").trim(), extra);
  return safe ? `${safe.slice(0, 500)}${safe.length > 500 ? "…" : ""}` : undefined;
}

function buildGeneralContext(event: SessionBeforeCompactEvent, extra: string[]): string | undefined {
  const previous = sanitizeGeneralText(event.preparation.previousSummary ?? "", extra);
  if (previous) return previous;

  const snippets: string[] = [];
  for (const message of event.preparation.messagesToSummarize) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    const content = "content" in message ? message.content : undefined;
    const text = typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content.filter((part): part is { type: "text"; text: string } =>
            Boolean(part && typeof part === "object" && part.type === "text" && typeof part.text === "string"),
          ).map((part) => part.text).join(" ")
        : "";
    const safe = sanitizeGeneralText(text, extra);
    if (safe) snippets.push(`${message.role === "user" ? "User" : "Assistant"}: ${safe.slice(0, 1_500)}`);
  }
  if (!snippets.length) return undefined;
  return ["Prior/general task context:", ...snippets.slice(-6)].join("\n");
}

function sanitizeGeneralText(value: string, extra: string[]): string {
  if (!value.trim()) return "";
  return sanitizeDiagnosticText(value, extra)
    .replace(/```[\s\S]*?```/g, "[code/config omitted during Dagster compaction]")
    .split(/\r?\n/)
    .filter((line) => !/(raw\s+logs?|event\s+dump|runConfig|GraphQL\s+(response|variables)|stdout|stderr)/i.test(line))
    .join("\n")
    .trim()
    .slice(0, 8_000);
}

function hasIncidentContext(state: IncidentState): boolean {
  return Boolean(
    state.runId || state.hypothesis || state.evidencePointer || state.auditIds.length ||
    state.entityIds.runIds.length || state.entityIds.assetKeys.length || state.entityIds.backfillIds.length,
  );
}

function boundSummary(value: string): string {
  return value.length <= 12_000 ? value : `${value.slice(0, 12_000)}…`;
}

function computeCumulativeFileLists(fileOps: {
  read: Set<string>;
  written: Set<string>;
  edited: Set<string>;
}): { readFiles: string[]; modifiedFiles: string[] } {
  const modified = new Set([...fileOps.written, ...fileOps.edited]);
  return {
    readFiles: [...fileOps.read].filter((path) => !modified.has(path)).sort(),
    modifiedFiles: [...modified].sort(),
  };
}

function incidentUsage(): string {
  return [
    "Usage:",
    "  /dagster-incident <runId> [hypothesis=\"…\"]",
    "  /dagster-incident show",
    "  /dagster-incident fork hypothesis=\"…\"",
    "  /dagster-incident clear",
  ].join("\n");
}

// Used by reconstruction tests to express an explicit clear marker.
export function applyIncidentEntry(state: IncidentState, data: unknown): IncidentState {
  const record = data && typeof data === "object" ? data as Record<string, unknown> : {};
  if (record.clear === true) return clearOpenIncident(state);
  return mergeIncidentState(state, (record.state ?? record) as IncidentPatch);
}

void cloneIncidentState;
