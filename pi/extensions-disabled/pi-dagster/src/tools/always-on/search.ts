import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { DagsterRuntime } from "../../runtime.ts";
import {
  runCrossEntitySearch,
} from "../../domain/cross-search.ts";
import type { SearchEntityKind } from "../../domain/search.ts";
import { truncateForTool } from "../../clients/truncate.ts";

const KIND_ENUM = ["asset", "job", "run", "schedule", "sensor"] as const;

export function createSearchTool(runtime: DagsterRuntime) {
  return defineTool({
    name: "dagster_search",
    label: "Dagster Search",
    description:
      "Read-only cross-entity search across assets, jobs, runs, schedules, and sensors on the active target; establish target status first and use inspect tools for bounded detail.",
    promptSnippet: "Search Dagster catalog entities",
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
      kinds: Type.Optional(
        Type.Array(
          Type.Unsafe<SearchEntityKind>({
            type: "string",
            enum: [...KIND_ENUM],
          }),
          { description: "Entity kinds to include (default: all available)" },
        ),
      ),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
    }),
    async execute(_toolCallId, params, signal) {
      if (signal?.aborted) throw new Error("Aborted");
      if (runtime.closed) throw new Error("Dagster runtime is shut down");

      const client = await runtime.ensureClient({ signal });
      const kinds = params.kinds as SearchEntityKind[] | undefined;
      const { matches, notes, text } = await runCrossEntitySearch(client, {
        query: params.query,
        kinds,
        limit: params.limit,
        signal,
      });

      // Populate entity cache for autocomplete (all matches, safe metadata only).
      for (const m of matches) {
        const status =
          m.extra && typeof m.extra === "object" && "status" in m.extra
            ? String((m.extra as { status?: unknown }).status ?? "")
            : "";
        const jobName =
          m.extra && typeof m.extra === "object" && "jobName" in m.extra
            ? String((m.extra as { jobName?: unknown }).jobName ?? "")
            : "";
        runtime.rememberEntity(m.kind, m.id, {
          label: m.label,
          description: [status, jobName].filter(Boolean).join(" ") || m.kind,
        });
      }

      const truncated = await truncateForTool(text, { label: "search" });

      return {
        content: [{ type: "text", text: truncated.content }],
        details: {
          matches: matches.map((m) => ({
            kind: m.kind,
            id: m.id,
            label: m.label,
            extra: m.extra,
          })),
          truncated: truncated.truncated,
          tempPath: truncated.tempPath,
          notes,
        },
      };
    },
  });
}
