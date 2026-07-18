/**
 * TUI-only mutation audit entries (proposal §6.4).
 * Never put secrets / runConfig in audit payloads.
 */
import { randomUUID } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { RiskClass } from "./types.ts";

export type AuditOutcome = "success" | "error" | "denied" | "declined";

export type AuditEntry = {
  /** Stable public pointer shared by runtime, session entry, renderer, and compaction. */
  auditId: string;
  ts: number;
  tool: string;
  risk: RiskClass;
  profile?: string;
  summary: string;
  entityIds?: string[];
  outcome: AuditOutcome;
  /** Public GraphQL HTTP URL only — never headers/secrets. */
  endpoint?: string;
};

export function buildAuditEntry(input: {
  tool: string;
  risk: RiskClass;
  profile?: string | null;
  summary: string;
  entityIds?: string[];
  outcome: AuditOutcome;
  endpoint?: string | null;
  ts?: number;
  auditId?: string;
}): AuditEntry {
  return {
    auditId: input.auditId ?? `audit-${randomUUID()}`,
    ts: input.ts ?? Date.now(),
    tool: input.tool,
    risk: input.risk,
    profile: input.profile ?? undefined,
    summary: sanitizeAuditText(input.summary),
    entityIds: input.entityIds?.filter(Boolean),
    outcome: input.outcome,
    endpoint: sanitizeEndpoint(input.endpoint ?? undefined),
  };
}

/** Strip obvious secret patterns from free-form summary text. */
export function sanitizeAuditText(text: string): string {
  return text
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted-jwt]")
    // Key=value secrets first; avoid matching the "Authorization" suffix of Proxy-Authorization.
    .replace(
      /(?<![A-Za-z0-9_-])(password|secret|token|api_key|authorization)(?![A-Za-z0-9_-])\s*[:=]\s*\S+/gi,
      "$1=[REDACTED]",
    )
    .replace(
      /\b(Cookie|Set-Cookie|Proxy-Authorization|Authorization|X-Api-Key|X-Auth-Token)\b\s*[:=]\s*[^\r\n]+/gi,
      "$1: [REDACTED]",
    );
}

/**
 * Append a TUI-only audit entry when appendEntry is available.
 * Never throws into tool flow — audit is best-effort.
 */
export function appendAudit(
  pi: Pick<ExtensionAPI, "appendEntry"> | { appendEntry?: ExtensionAPI["appendEntry"] },
  entry: AuditEntry,
): void {
  try {
    const append = pi.appendEntry?.bind(pi);
    if (typeof append !== "function") return;
    append("dagster.audit", entry);
  } catch {
    // ignore — audit must not break mutations
  }
}

/** One-line renderer for custom entry type dagster.audit. */
export function formatAuditEntryLine(entry: AuditEntry): string {
  const ids = entry.entityIds?.length ? ` [${entry.entityIds.join(", ")}]` : "";
  const profile = entry.profile ? ` @${entry.profile}` : "";
  const auditId = entry.auditId ? ` [${entry.auditId}]` : "";
  return `dagster.audit${auditId} ${entry.outcome} ${entry.tool} risk=${entry.risk}${profile}${ids}: ${entry.summary}`;
}

function sanitizeEndpoint(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    for (const key of url.searchParams.keys()) {
      if (/token|secret|password|api[_-]?key|authorization/i.test(key)) {
        url.searchParams.set(key, "[REDACTED]");
      }
    }
    return url.toString();
  } catch {
    return sanitizeAuditText(value);
  }
}
