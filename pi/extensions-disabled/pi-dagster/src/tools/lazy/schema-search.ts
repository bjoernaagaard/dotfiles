import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { DagsterRuntime } from "../../runtime.ts";
import {
  formatRootFieldHits,
  searchRootFields,
  type RootFieldKind,
} from "../../domain/schema-index.ts";

/**
 * Offline schema search over pinned ROOT_FIELDS inventory.
 * Lazy tool — omit promptSnippet / promptGuidelines.
 */
export function createSchemaSearchTool(runtime: DagsterRuntime) {
  return defineTool({
    name: "dagster_schema_search",
    label: "Schema Search",
    description:
      "Search the pinned Dagster GraphQL root field inventory (Query/Mutation/Subscription).",
    parameters: Type.Object({
      query: Type.String({ description: "Field name or keyword" }),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
      kinds: Type.Optional(
        Type.Array(
          Type.Unsafe<RootFieldKind>({
            type: "string",
            enum: ["Query", "Mutation", "Subscription"],
          }),
        ),
      ),
    }),
    async execute(_toolCallId, params, signal) {
      if (signal?.aborted) throw new Error("Aborted");
      if (runtime.closed) throw new Error("Dagster runtime is shut down");

      const hits = searchRootFields(params.query, {
        limit: params.limit,
        kinds: params.kinds as RootFieldKind[] | undefined,
      });

      return {
        content: [{ type: "text", text: formatRootFieldHits(hits) }],
        details: {
          matches: hits,
          source: "pinned-ROOT_FIELDS",
        },
      };
    },
  });
}
