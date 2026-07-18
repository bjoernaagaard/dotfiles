import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { DagsterRuntime } from "../../runtime.ts";
import { applySearchToolsOnPi, type SearchToolsDetails } from "../loader.ts";
import { DAGSTER_LOADER_GUIDELINES } from "../../guidance.ts";

/**
 * Loader tool — keeps promptSnippet + promptGuidelines (lazy tools must omit them).
 */
export function createSearchToolsTool(pi: ExtensionAPI, runtime: DagsterRuntime) {
  return defineTool({
    name: "dagster_search_tools",
    label: "Dagster Search Tools",
    description:
      "Search for and enable the smallest additional Dagster tool set relevant to a task. Establish the target/policy first, and call this before assuming a capability is missing; loading is additive.",
    promptSnippet:
      "Search for additional Dagster tools when the active tools cannot perform the task",
    promptGuidelines: DAGSTER_LOADER_GUIDELINES,
    parameters: Type.Object({
      query: Type.String({ description: "Capability or task; include entities/actions such as ‘launch run’, ‘diagnose failure’, ‘dg check’, or ‘watch logs’." }),
      limit: Type.Optional(
        Type.Integer({ minimum: 1, maximum: 12, description: "Max tools to return (default 5)" }),
      ),
    }),
    async execute(_toolCallId, params, signal) {
      if (signal?.aborted) throw new Error("Aborted");
      if (runtime.closed) throw new Error("Dagster runtime is shut down");

      const details: SearchToolsDetails = applySearchToolsOnPi(
        pi,
        runtime,
        params.query,
        params.limit,
      );

      const text =
        details.matches.length === 0
          ? `No Dagster tools found for: ${params.query}`
          : details.added.length > 0
            ? `Loaded tools: ${details.added.join(", ")}`
            : `Matching tools already active: ${details.matches.join(", ")}`;

      return {
        content: [{ type: "text", text }],
        // details.added is the stable, typed replay record for session reconstruction.
        details,
      };
    },
  });
}
