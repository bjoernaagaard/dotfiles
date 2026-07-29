import type { AuditEntry, AuditOutcome } from "../policy/audit.ts";
import { redactDiagnosticValue, sanitizeDiagnosticText } from "../domain/diagnose.ts";

export const MAX_INCIDENT_ENTITY_IDS = 50;
export const MAX_INCIDENT_MUTATIONS = 50;
export const MAX_INCIDENT_AUDIT_IDS = 100;
export const MAX_HYPOTHESIS_CHARS = 500;
export const MAX_HANDOFF_CHARS = 4_000;

export type IncidentMutation = {
  auditId: string;
  tool: string;
  outcome: AuditOutcome;
  summary: string;
  entityIds?: string[];
};

export type IncidentState = {
  runId?: string;
  hypothesis?: string;
  evidencePointer?: string;
  profileName?: string;
  entityIds: {
    runIds: string[];
    assetKeys: string[];
    backfillIds: string[];
  };
  mutations: IncidentMutation[];
  auditIds: string[];
  handoff?: string;
};

export type IncidentPatch = Partial<Omit<IncidentState, "entityIds" | "mutations" | "auditIds">> & {
  entityIds?: Partial<IncidentState["entityIds"]>;
  mutations?: IncidentMutation[];
  auditIds?: string[];
};

export type IncidentBranchEntry = {
  type?: string;
  customType?: string;
  data?: unknown;
  details?: unknown;
  summary?: string;
  message?: {
    role?: string;
    toolName?: string;
    details?: unknown;
  };
};

export function emptyIncidentState(): IncidentState {
  return {
    entityIds: { runIds: [], assetKeys: [], backfillIds: [] },
    mutations: [],
    auditIds: [],
  };
}

export function normalizeIncidentState(
  input: IncidentPatch | undefined,
  extraPatterns: string[] = [],
): IncidentState {
  const safe = redactDiagnosticValue(input ?? {}, extraPatterns) as IncidentPatch;
  const state = emptyIncidentState();
  state.runId = oneLine(safe.runId, 300, extraPatterns);
  state.hypothesis = oneLine(safe.hypothesis, MAX_HYPOTHESIS_CHARS, extraPatterns);
  state.evidencePointer = safePointer(safe.evidencePointer, extraPatterns);
  state.profileName = oneLine(safe.profileName, 200, extraPatterns);
  state.handoff = boundedText(safe.handoff, MAX_HANDOFF_CHARS, extraPatterns);
  state.entityIds = {
    runIds: stableIds(safe.entityIds?.runIds, extraPatterns),
    assetKeys: stableIds(safe.entityIds?.assetKeys, extraPatterns),
    backfillIds: stableIds(safe.entityIds?.backfillIds, extraPatterns),
  };
  state.mutations = (Array.isArray(safe.mutations) ? safe.mutations : [])
    .map((mutation) => normalizeMutation(mutation, extraPatterns))
    .filter((mutation): mutation is IncidentMutation => Boolean(mutation))
    .slice(-MAX_INCIDENT_MUTATIONS);
  state.auditIds = stableIds(
    [...(safe.auditIds ?? []), ...state.mutations.map((mutation) => mutation.auditId)],
    extraPatterns,
    MAX_INCIDENT_AUDIT_IDS,
  );
  return stripUndefined(state);
}

export function mergeIncidentState(
  current: IncidentState,
  patch: IncidentPatch,
  extraPatterns: string[] = [],
): IncidentState {
  const normalizedPatch = normalizeIncidentState(patch, extraPatterns);
  return normalizeIncidentState({
    runId: normalizedPatch.runId ?? current.runId,
    hypothesis: normalizedPatch.hypothesis ?? current.hypothesis,
    evidencePointer: normalizedPatch.evidencePointer ?? current.evidencePointer,
    profileName: normalizedPatch.profileName ?? current.profileName,
    handoff: normalizedPatch.handoff ?? current.handoff,
    entityIds: {
      runIds: [...current.entityIds.runIds, ...normalizedPatch.entityIds.runIds],
      assetKeys: [...current.entityIds.assetKeys, ...normalizedPatch.entityIds.assetKeys],
      backfillIds: [...current.entityIds.backfillIds, ...normalizedPatch.entityIds.backfillIds],
    },
    mutations: [...current.mutations, ...normalizedPatch.mutations],
    auditIds: [...current.auditIds, ...normalizedPatch.auditIds],
  }, extraPatterns);
}

export function recordAuditInIncident(
  current: IncidentState,
  audit: AuditEntry | Record<string, unknown>,
  extraPatterns: string[] = [],
): IncidentState {
  const raw = audit as Partial<AuditEntry>;
  const auditId = typeof raw.auditId === "string" && raw.auditId
    ? raw.auditId
    : legacyAuditId(raw);
  const mutation = normalizeMutation({
    auditId,
    tool: typeof raw.tool === "string" ? raw.tool : "unknown",
    outcome: validOutcome(raw.outcome) ? raw.outcome : "error",
    summary: typeof raw.summary === "string" ? raw.summary : "Legacy audit entry",
    entityIds: Array.isArray(raw.entityIds) ? raw.entityIds : undefined,
  }, extraPatterns);
  if (!mutation) return cloneIncidentState(current);
  const withoutSame = current.mutations.filter((item) => item.auditId !== auditId);
  return mergeIncidentState(
    { ...current, mutations: withoutSame, auditIds: current.auditIds.filter((id) => id !== auditId) },
    {
      mutations: [mutation],
      auditIds: [auditId],
      entityIds: inferEntityIds(mutation.entityIds ?? []),
    },
    extraPatterns,
  );
}

export function reconstructIncidentState(
  entries: readonly IncidentBranchEntry[],
  extraPatterns: string[] = [],
): IncidentState {
  let state = emptyIncidentState();
  for (const entry of entries) {
    if (entry.type === "message" && entry.message?.role === "toolResult") {
      const details = asRecord(entry.message.details);
      if (entry.message.toolName === "dagster_evidence_pack") {
        const incident = asRecord(details.incident);
        state = mergeIncidentState(state, {
          runId: stringOrUndefined(incident.runId) ?? stringOrUndefined(details.runId),
          evidencePointer: stringOrUndefined(incident.evidencePointer) ?? stringOrUndefined(details.evidencePointer),
          entityIds: asRecord(incident.entityIds) as Partial<IncidentState["entityIds"]>,
        }, extraPatterns);
      } else if (entry.message.toolName === "dagster_compare_run") {
        const comparison = asRecord(details.comparison);
        const baseline = asRecord(comparison.baseline);
        state = mergeIncidentState(state, {
          runId: stringOrUndefined(details.runId),
          evidencePointer: stringOrUndefined(comparison.overflowPath),
          entityIds: { runIds: [details.runId, baseline.runId].filter((x): x is string => typeof x === "string") },
        }, extraPatterns);
      }
      continue;
    }

    if (entry.type === "custom" && entry.customType === "dagster.incident") {
      const data = asRecord(entry.data);
      if (data.clear === true) state = clearOpenIncident(state);
      state = mergeIncidentState(state, asRecord(data.state ?? data) as IncidentPatch, extraPatterns);
      continue;
    }
    if (entry.type === "custom" && entry.customType === "dagster.audit") {
      state = recordAuditInIncident(state, asRecord(entry.data), extraPatterns);
      continue;
    }
    if (entry.type === "custom_message" && entry.customType === "dagster.incident") {
      state = mergeIncidentState(state, asRecord(entry.details) as IncidentPatch, extraPatterns);
      continue;
    }
    if (entry.type === "compaction") {
      const dagster = asRecord(asRecord(entry.details).dagster);
      if (Object.keys(dagster).length) {
        // Prefer the full nested incident snapshot; fall back to flat fields.
        const nested = asRecord(dagster.incident);
        const source = Object.keys(nested).length ? nested : dagster;
        const mutations = Array.isArray(source.mutations)
          ? source.mutations
          : Array.isArray(dagster.mutations)
            ? dagster.mutations
            : undefined;
        state = mergeIncidentState(state, {
          runId:
            stringOrUndefined(source.runId) ??
            stringOrUndefined(dagster.runId) ??
            stringArray(dagster.runIds)[0],
          hypothesis:
            stringOrUndefined(source.hypothesis) ??
            stringOrUndefined(dagster.hypothesis),
          evidencePointer:
            stringOrUndefined(source.evidencePointer) ??
            stringOrUndefined(dagster.evidencePointer),
          profileName:
            stringOrUndefined(source.profileName) ??
            stringOrUndefined(dagster.profileName),
          handoff:
            stringOrUndefined(source.handoff) ??
            stringOrUndefined(dagster.handoff),
          entityIds: {
            runIds: stringArray(
              asRecord(source.entityIds).runIds ?? dagster.runIds,
            ),
            assetKeys: stringArray(
              asRecord(source.entityIds).assetKeys ?? dagster.assetKeys,
            ),
            backfillIds: stringArray(
              asRecord(source.entityIds).backfillIds ?? dagster.backfillIds,
            ),
          },
          mutations: mutations as IncidentMutation[] | undefined,
          auditIds: stringArray(source.auditIds ?? dagster.auditIds),
        }, extraPatterns);
      }
    }
  }
  return cloneIncidentState(state);
}

export function clearOpenIncident(current: IncidentState): IncidentState {
  return {
    entityIds: { runIds: [], assetKeys: [], backfillIds: [] },
    mutations: current.mutations.map((item) => ({ ...item, entityIds: item.entityIds ? [...item.entityIds] : undefined })),
    auditIds: [...current.auditIds],
  };
}

export function cloneIncidentState(state: IncidentState): IncidentState {
  return JSON.parse(JSON.stringify(state)) as IncidentState;
}

export function formatIncidentState(state: IncidentState): string {
  return [
    `Run: ${state.runId ?? "(none)"}`,
    `Profile: ${state.profileName ?? "(none)"}`,
    `Hypothesis: ${state.hypothesis ?? "(none)"}`,
    `Evidence: ${state.evidencePointer ?? "re-run dagster_evidence_pack"}`,
    `Runs: ${state.entityIds.runIds.join(", ") || "(none)"}`,
    `Assets: ${state.entityIds.assetKeys.join(", ") || "(none)"}`,
    `Backfills: ${state.entityIds.backfillIds.join(", ") || "(none)"}`,
    `Audit ids: ${state.auditIds.join(", ") || "(none)"}`,
    `Mutations: ${state.mutations.length}`,
  ].join("\n");
}

function normalizeMutation(value: unknown, extraPatterns: string[]): IncidentMutation | null {
  const item = asRecord(value);
  const auditId = oneLine(item.auditId, 200, extraPatterns);
  const tool = oneLine(item.tool, 200, extraPatterns);
  const outcome = item.outcome;
  if (!auditId || !tool || !validOutcome(outcome)) return null;
  return {
    auditId,
    tool,
    outcome,
    summary: oneLine(item.summary, 500, extraPatterns) ?? "(no summary)",
    entityIds: stableIds(item.entityIds, extraPatterns),
  };
}

function inferEntityIds(ids: string[]): Partial<IncidentState["entityIds"]> {
  return { runIds: ids };
}

function legacyAuditId(raw: Partial<AuditEntry>): string {
  const input = `${raw.ts ?? 0}|${raw.tool ?? "unknown"}|${raw.outcome ?? "unknown"}|${raw.summary ?? ""}`;
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `legacy-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function validOutcome(value: unknown): value is AuditOutcome {
  return value === "success" || value === "error" || value === "denied" || value === "declined";
}

function stableIds(value: unknown, extra: string[], max = MAX_INCIDENT_ENTITY_IDS): string[] {
  const source = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of source) {
    const item = oneLine(raw, 300, extra);
    if (!item || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out.slice(-max);
}

function oneLine(value: unknown, max: number, extra: string[]): string | undefined {
  if (typeof value !== "string") return undefined;
  const safe = sanitizeDiagnosticText(value.replace(/\s+/g, " ").trim(), extra);
  if (!safe) return undefined;
  return safe.length <= max ? safe : `${safe.slice(0, max)}…`;
}

function boundedText(value: unknown, max: number, extra: string[]): string | undefined {
  if (typeof value !== "string") return undefined;
  const safe = sanitizeDiagnosticText(value.trim(), extra);
  if (!safe) return undefined;
  return safe.length <= max ? safe : `${safe.slice(0, max)}…`;
}

function safePointer(value: unknown, extra: string[]): string | undefined {
  const pointer = oneLine(value, 1_000, extra);
  return pointer?.replace(/([?&](?:token|key|secret|sig)=)[^&\s]+/gi, "$1[REDACTED]");
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}
function stripUndefined<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
