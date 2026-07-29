import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { DagsterRuntime } from "../../runtime.ts";
import { INSPECT_RUN_QUERY } from "../../clients/documents/run.gql.ts";
import { formatRunSummary, mapRunOrError } from "../../domain/run.ts";

/**
 * Lazy tool — omit promptSnippet / promptGuidelines.
 */
export function createInspectRunTool(runtime: DagsterRuntime) {
  return defineTool({
    name: "dagster_inspect_run",
    label: "Inspect Run",
    description: "Inspect a Dagster run: config (redacted), steps, status",
    parameters: Type.Object({
      runId: Type.String({ description: "Run id" }),
    }),
    async execute(_toolCallId, params, signal) {
      if (signal?.aborted) throw new Error("Aborted");
      if (runtime.closed) throw new Error("Dagster runtime is shut down");

      const runId = params.runId.trim();
      if (!runId) throw new Error("runId is required");

      const client = await runtime.ensureClient({ signal });
      const data = await client.request<{ runOrError: Record<string, unknown> }>({
        query: INSPECT_RUN_QUERY,
        variables: { runId },
        signal,
        operationName: "DagsterInspectRun",
      });

      const extra = runtime.getActiveProfile()?.redaction?.extraKeyPatterns;
      const result = mapRunOrError(data, extra);
      if (!result.ok) {
        return {
          content: [
            {
              type: "text",
              text: `Run inspect error (${result.error.typename}): ${result.error.message}`,
            },
          ],
          details: {
            kind: result.error.kind,
            typename: result.error.typename,
            message: result.error.message,
            runId,
          } as Record<string, unknown>,
        };
      }

      runtime.rememberEntity("run", result.run.runId);

      return {
        content: [{ type: "text", text: formatRunSummary(result.run) }],
        details: {
          kind: "run",
          run: result.run,
          redacted: true,
        } as Record<string, unknown>,
      };
    },
  });
}
