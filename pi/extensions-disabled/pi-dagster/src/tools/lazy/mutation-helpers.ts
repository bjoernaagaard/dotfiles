/**
 * Shared helpers for mutating lazy tools.
 */
import type { DagsterRuntime } from "../../runtime.ts";
import { enforceMutation } from "../../policy/enforce.ts";
import { appendAudit, buildAuditEntry, type AuditOutcome } from "../../policy/audit.ts";
import type { RiskClass } from "../../policy/types.ts";
import {
  formatMutationOutcome,
  outcomeToToolDetails,
  type MutationOutcome,
} from "../../domain/mutations.ts";
import { redactObject } from "../../policy/redact.ts";
import { truncateForTool } from "../../clients/truncate.ts";

export type ToolCtx = {
  hasUI?: boolean;
  ui?: { confirm?: (title: string, message: string) => Promise<boolean> };
  signal?: AbortSignal;
  cwd?: string;
};

export async function gateAndConfirm(opts: {
  runtime: DagsterRuntime;
  risk: RiskClass;
  force?: boolean;
  ctx?: ToolCtx;
  title: string;
  message: string;
}): Promise<void> {
  await enforceMutation({
    risk: opts.risk,
    policy: opts.runtime.getEffectivePolicy(),
    hasUI: Boolean(opts.ctx?.hasUI),
    force: opts.force,
    title: opts.title,
    message: opts.message,
    ui: opts.ctx?.ui,
  });
}

export function auditMutation(opts: {
  runtime: DagsterRuntime;
  tool: string;
  risk: RiskClass;
  outcome: AuditOutcome;
  summary: string;
  entityIds?: string[];
}): void {
  const entry = buildAuditEntry({
    tool: opts.tool,
    risk: opts.risk,
    profile: opts.runtime.activeProfileName,
    summary: opts.summary,
    entityIds: opts.entityIds,
    outcome: opts.outcome,
    endpoint: opts.runtime.getClient()?.endpoint ?? opts.runtime.getEphemeralGraphqlUrl(),
  });
  // Runtime state is authoritative for this live branch even when persistence is unavailable.
  opts.runtime.recordAudit(entry);
  appendAudit(opts.runtime.pi, entry);
}

export function mutationToolResult(outcome: MutationOutcome) {
  return {
    content: [{ type: "text" as const, text: formatMutationOutcome(outcome) }],
    details: outcomeToToolDetails(outcome),
  };
}

export async function redactedJsonResult(
  runtime: DagsterRuntime,
  value: unknown,
  label: string,
) {
  const extra = runtime.getActiveProfile()?.redaction?.extraKeyPatterns;
  const redacted = redactObject(value, extra);
  const truncated = await truncateForTool(redacted, { label });
  return {
    content: [{ type: "text" as const, text: truncated.content }],
    details: {
      kind: "ok",
      truncated: truncated.truncated,
      tempPath: truncated.tempPath,
      redacted: true,
      endpoint: runtime.getClient()?.endpoint,
    } as Record<string, unknown>,
  };
}

export function assertRuntimeOpen(runtime: DagsterRuntime, signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("Aborted");
  if (runtime.closed) throw new Error("Dagster runtime is shut down");
}
