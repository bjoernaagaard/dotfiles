import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { DagsterRuntime } from "../../runtime.ts";
import { formatWatchStatus } from "../../domain/watches.ts";
import { assertRuntimeOpen } from "./mutation-helpers.ts";
import { attachSafeRenderers } from "../../render/index.ts";

const ACTIONS = ["start", "stop", "status"] as const;

export function createWatchRunTool(runtime: DagsterRuntime) {
  return attachSafeRenderers(defineTool({
    name: "dagster_watch_run",
    label: "Watch Run",
    description:
      "Start/stop/status a read-only run-log watch. Streams go to a bounded temp log path; use status and summarize the path, never dump full logs into chat.",
    parameters: Type.Object({
      action: Type.Unsafe<(typeof ACTIONS)[number]>(
        Type.String({ enum: [...ACTIONS] }),
      ),
      runId: Type.Optional(Type.String()),
      watchId: Type.Optional(Type.String()),
      notifyModel: Type.Optional(
        Type.Boolean({
          description: "If true, urgent failures may followUp the model on agent_settled",
        }),
      ),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      assertRuntimeOpen(runtime, signal);
      const action = params.action;
      if (!ACTIONS.includes(action)) {
        throw new Error(`action must be one of ${ACTIONS.join(", ")}`);
      }

      if (action === "status") {
        const watches = runtime.listWatches();
        const text = formatWatchStatus(watches);
        return {
          content: [{ type: "text" as const, text }],
          details: { kind: "watches", watches },
        };
      }

      if (action === "stop") {
        const id = params.watchId?.trim() || params.runId?.trim();
        if (!id) throw new Error("watchId or runId is required for stop");
        runtime.stopWatch(id);
        return {
          content: [{ type: "text" as const, text: `Stopped watch ${id}` }],
          details: { kind: "watch_stopped", id },
        };
      }

      // start
      const runId = params.runId?.trim();
      if (!runId) throw new Error("runId is required for start");
      const handle = await runtime.startRunLogWatch({
        runId,
        signal: signal ?? ctx?.signal,
        notifyModel: params.notifyModel,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: [
              `Started run log watch ${handle.id}`,
              `runId: ${handle.runId}`,
              `logPath: ${handle.logPath}`,
              "Events stream to the log file; use action=status for summary.",
            ].join("\n"),
          },
        ],
        details: { kind: "watch_started", watch: handle },
      };
    },
  }));
}
