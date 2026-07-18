import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { DagsterRuntime } from "../../runtime.ts";
import { truncateForTool } from "../../clients/truncate.ts";
import { redactObject } from "../../policy/redact.ts";
import {
  GraphqlOperationError,
  selectGraphqlOperation,
} from "../../graphql/operation.ts";
import { attachSafeRenderers } from "../../render/index.ts";

/**
 * Reject documents that look like mutations (compat export).
 * Prefer selectGraphqlOperation for real gating.
 */
export function isMutationDocument(query: string): boolean {
  try {
    const selected = selectGraphqlOperation({ document: query });
    return selected.type === "mutation";
  } catch {
    const trimmed = query.trim().replace(/^#[^\n]*\n/gm, "").trim();
    const noComments = trimmed.replace(/\/\*[\s\S]*?\*\//g, "").trim();
    return /^(mutation)\b/i.test(noComments);
  }
}

export function createGraphqlQueryTool(runtime: DagsterRuntime) {
  return attachSafeRenderers(
    defineTool({
      name: "dagster_graphql_query",
      label: "Dagster GraphQL Query",
      description:
        "Execute a read-only GraphQL query against the active Dagster target. Prefer typed tools; this validates queries and rejects mutations as a schema escape hatch.",
      promptSnippet: "Run a read-only Dagster GraphQL query",
      parameters: Type.Object({
        query: Type.String({ description: "GraphQL query document" }),
        variables: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
        operationName: Type.Optional(Type.String()),
      }),
      async execute(_toolCallId, params, signal) {
        if (signal?.aborted) throw new Error("Aborted");
        if (runtime.closed) throw new Error("Dagster runtime is shut down");

        let selected;
        try {
          selected = selectGraphqlOperation({
            document: params.query,
            operationName: params.operationName,
            expectedType: "query",
          });
        } catch (err) {
          const msg =
            err instanceof GraphqlOperationError || err instanceof Error
              ? err.message
              : String(err);
          throw new Error(
            `dagster_graphql_query: ${msg}. Use typed mutation tools or dagster_graphql_mutation for mutations; dagster_graphql_subscribe for subscriptions.`,
          );
        }

        const client = await runtime.ensureClient({ signal });
        const data = await client.request<unknown>({
          query: params.query,
          variables: params.variables,
          operationName: params.operationName ?? selected.name,
          signal,
        });

        const extraPatterns = runtime.getActiveProfile()?.redaction?.extraKeyPatterns;
        const redacted = redactObject(data, extraPatterns);
        const truncated = await truncateForTool(redacted, { label: "graphql-query" });

        return {
          content: [{ type: "text", text: truncated.content }],
          details: {
            endpoint: client.endpoint,
            truncated: truncated.truncated,
            tempPath: truncated.tempPath,
            redacted: true,
            operationType: selected.type,
            operationName: selected.name,
            rootFields: selected.rootFields,
            // Never include headers, variables, or raw secrets.
          },
        };
      },
    }),
  );
}
