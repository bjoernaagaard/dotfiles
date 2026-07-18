/**
 * Classify generic GraphQL mutation documents into RiskClass.
 * Uses AST-based operation selection (aliases/fragments resolved).
 */
import type { RiskClass } from "./types.ts";
import {
  selectGraphqlOperation,
  isQueryDocument as astIsQueryDocument,
  isSubscriptionDocument as astIsSubscriptionDocument,
  isMutationDocumentStrict as astIsMutationDocumentStrict,
  GraphqlOperationError,
} from "../graphql/operation.ts";

const REMOTE_LAUNCH = new Set([
  "launchRun",
  "launchPipelineExecution",
  "launchMultipleRuns",
  "launchRunReexecution",
  "launchPipelineReexecution",
  "launchPartitionBackfill",
  "reexecutePartitionBackfill",
]);

const DESTRUCTIVE = new Set([
  "deleteRun",
  "deletePipelineRun",
  "wipeAssets",
  "shutdownRepositoryLocation",
  "freeConcurrencySlots",
  "deleteDynamicPartitions",
]);

const REMOTE_STATE = new Set([
  "terminateRun",
  "terminateRuns",
  "terminatePipelineExecution",
  "startSchedule",
  "stopRunningSchedule",
  "resetSchedule",
  "startSensor",
  "stopSensor",
  "resetSensor",
  "setSensorCursor",
  "reloadRepositoryLocation",
  "reloadWorkspace",
  "cancelPartitionBackfill",
  "resumePartitionBackfill",
  "addDynamicPartition",
  "reportRunlessAssetEvents",
  "reportAssetCheckEvaluations",
]);

const UNSUPPORTED = new Set(["logTelemetry", "setNuxSeen"]);

/**
 * Strip GraphQL comments (compat export for older callers).
 */
export function stripGraphqlComments(document: string): string {
  return document
    .replace(/#[^\n\r]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Extract mutation root field names via AST (aliases/fragments resolved). */
export function extractMutationRootFields(
  document: string,
  operationName?: string,
): string[] {
  try {
    return selectGraphqlOperation({
      document,
      operationName,
      expectedType: "mutation",
    }).rootFields;
  } catch {
    return [];
  }
}

export function isMutationDocumentStrict(document: string): boolean {
  return astIsMutationDocumentStrict(document);
}

export function isQueryDocument(document: string): boolean {
  return astIsQueryDocument(document);
}

export function isSubscriptionDocument(document: string): boolean {
  return astIsSubscriptionDocument(document);
}

/**
 * Classify a mutation document. Unknown roots default to remote_state.
 * Honors operationName for multi-operation documents.
 * Throws on empty documents, wrong type, or unsupported noise ops.
 */
export function classifyMutationDocument(
  mutation: string,
  operationName?: string,
): RiskClass {
  const stripped = stripGraphqlComments(mutation).trim();
  if (!stripped) {
    throw new Error("Mutation document is empty");
  }

  let selected;
  try {
    // GraphQL shorthand (`{ field }`) is a query, never a mutation.
    selected = selectGraphqlOperation({
      document: mutation,
      operationName,
      expectedType: "mutation",
    });
  } catch (err) {
    if (err instanceof Error && /rejects|expected a mutation|empty/i.test(err.message)) {
      throw err;
    }
    if (err instanceof GraphqlOperationError) {
      // Re-map type mismatches into tool-facing messages
      if (/Expected mutation/i.test(err.message)) {
        if (/query/i.test(err.message)) {
          throw new Error(
            "dagster_graphql_mutation rejects query documents. Use dagster_graphql_query.",
          );
        }
        if (/subscription/i.test(err.message)) {
          throw new Error(
            "dagster_graphql_mutation rejects subscription documents. Use dagster_graphql_subscribe.",
          );
        }
      }
      throw new Error(err.message);
    }
    throw err instanceof Error ? err : new Error(String(err));
  }

  const fields = selected.rootFields;
  if (fields.length === 0) {
    return "remote_state";
  }

  for (const f of fields) {
    if (UNSUPPORTED.has(f)) {
      throw new Error(
        `Mutation field "${f}" is unsupported noise (UI telemetry/NUX). Not exposed.`,
      );
    }
  }

  if (fields.some((f) => DESTRUCTIVE.has(f))) return "destructive";
  if (fields.some((f) => REMOTE_LAUNCH.has(f))) return "remote_launch";
  if (fields.some((f) => REMOTE_STATE.has(f))) return "remote_state";
  return "remote_state";
}

/**
 * Refine catalog risk using tool input (generic mutation document, backfill action).
 * Central tool_call and execute must classify the same selected mutation.
 */
export function refineToolRisk(
  toolName: string,
  input: unknown,
  catalogRisk?: RiskClass,
): RiskClass {
  if (toolName === "dagster_graphql_mutation") {
    const obj =
      input && typeof input === "object"
        ? (input as { mutation?: unknown; operationName?: unknown })
        : undefined;
    const mutation = obj?.mutation;
    const operationName =
      typeof obj?.operationName === "string" ? obj.operationName : undefined;
    if (typeof mutation === "string" && mutation.trim()) {
      try {
        return classifyMutationDocument(mutation, operationName);
      } catch {
        return catalogRisk ?? "remote_state";
      }
    }
    return catalogRisk ?? "remote_state";
  }

  if (toolName === "dagster_backfill") {
    const action =
      input && typeof input === "object" && "action" in input
        ? (input as { action?: unknown }).action
        : undefined;
    if (action === "launch") return "remote_launch";
    if (action === "cancel" || action === "resume") return "remote_state";
    return catalogRisk ?? "remote_launch";
  }

  return catalogRisk ?? "read";
}
