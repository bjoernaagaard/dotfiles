import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { DagsterRuntime } from "../../runtime.ts";
import { classifyMutationDocument } from "../../policy/mutation-risk.ts";
import {
  selectGraphqlOperation,
  GraphqlOperationError,
} from "../../graphql/operation.ts";
import {
  assertRuntimeOpen,
  auditMutation,
  gateAndConfirm,
  redactedJsonResult,
} from "./mutation-helpers.ts";
import { attachSafeRenderers } from "../../render/index.ts";

export function createGraphqlMutationTool(runtime: DagsterRuntime) {
  return attachSafeRenderers(
    defineTool({
      name: "dagster_graphql_mutation",
      label: "GraphQL Mutation",
      description:
        "Generic GraphQL mutation escape hatch. Risk is classified from the document; policy-gated.",
      parameters: Type.Object({
        mutation: Type.String(),
        variables: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
        operationName: Type.Optional(Type.String()),
        force: Type.Optional(Type.Boolean()),
      }),
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        assertRuntimeOpen(runtime, signal);
        const mutation = params.mutation.trim();
        if (!mutation) throw new Error("mutation document is required");

        // Select + type-check before policy/network (AST, aliases/fragments).
        // GraphQL shorthand selections are queries and are rejected here.
        let selected;
        try {
          selected = selectGraphqlOperation({
            document: mutation,
            operationName: params.operationName,
            expectedType: "mutation",
          });
        } catch (err) {
          if (err instanceof Error && /rejects query|rejects subscription/i.test(err.message)) {
            throw err;
          }
          if (err instanceof GraphqlOperationError) {
            if (/Expected mutation.*query/i.test(err.message) || /selected is query/i.test(err.message)) {
              throw new Error(
                "dagster_graphql_mutation rejects query documents. Use dagster_graphql_query.",
              );
            }
            if (/subscription/i.test(err.message)) {
              throw new Error(
                "dagster_graphql_mutation rejects subscription documents. Use dagster_graphql_subscribe.",
              );
            }
            throw new Error(err.message);
          }
          throw err instanceof Error ? err : new Error(String(err));
        }

        let risk;
        try {
          risk = classifyMutationDocument(mutation, params.operationName);
        } catch (err) {
          throw err instanceof Error ? err : new Error(String(err));
        }

        try {
          await gateAndConfirm({
            runtime,
            risk,
            force: params.force,
            ctx,
            title: "Confirm GraphQL mutation",
            message: `Execute GraphQL mutation (classified risk=${risk}; roots=${selected.rootFields.join(",")})?`,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          auditMutation({
            runtime,
            tool: "dagster_graphql_mutation",
            risk,
            outcome: msg.includes("declined") ? "declined" : "denied",
            summary: `risk=${risk} roots=${selected.rootFields.join(",")}: ${msg}`,
          });
          throw err;
        }

        const client = await runtime.ensureClient({ signal: signal ?? ctx?.signal });
        const data = await client.request<unknown>({
          query: mutation,
          variables: params.variables,
          operationName: params.operationName ?? selected.name,
          signal: signal ?? ctx?.signal,
        });

        auditMutation({
          runtime,
          tool: "dagster_graphql_mutation",
          risk,
          outcome: "success",
          summary: `mutation ok risk=${risk} roots=${selected.rootFields.join(",")}`,
        });

        const result = await redactedJsonResult(runtime, data, "graphql-mutation");
        return {
          ...result,
          details: {
            ...result.details,
            kind: "mutation_ok",
            risk,
            operationType: "mutation",
            operationName: selected.name,
            rootFields: selected.rootFields,
            // Never include variables that may hold runConfig secrets.
          },
        };
      },
    }),
  );
}
