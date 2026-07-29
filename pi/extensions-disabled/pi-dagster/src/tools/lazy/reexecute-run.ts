import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { DagsterRuntime } from "../../runtime.ts";
import { REEXECUTE_RUN_MUTATION } from "../../clients/documents/reexecute.gql.ts";
import { mapReexecuteResult } from "../../domain/mutations.ts";
import {
  assertRuntimeOpen,
  auditMutation,
  gateAndConfirm,
  mutationToolResult,
} from "./mutation-helpers.ts";
import { attachSafeRenderers } from "../../render/index.ts";

const STRATEGIES = ["FROM_FAILURE", "FROM_ASSET_FAILURE", "ALL_STEPS"] as const;

export function createReexecuteRunTool(runtime: DagsterRuntime) {
  return attachSafeRenderers(defineTool({
    name: "dagster_reexecute_run",
    label: "Reexecute Run",
    description:
      "Reexecute an inspected Dagster run with FROM_FAILURE, FROM_ASSET_FAILURE, or ALL_STEPS. Remote launch is policy-gated; confirm in UI or pass force=true in non-UI modes when allowed.",
    parameters: Type.Object({
      parentRunId: Type.String({ description: "Existing run id to inspect/reexecute." }),
      strategy: Type.Unsafe<(typeof STRATEGIES)[number]>(
        Type.String({ enum: [...STRATEGIES] }),
      ),
      force: Type.Optional(Type.Boolean({ description: "Non-UI confirmation override when policy allows; readOnly still blocks." })),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      assertRuntimeOpen(runtime, signal);
      const parentRunId = params.parentRunId.trim();
      if (!parentRunId) throw new Error("parentRunId is required");
      const strategy = params.strategy;
      if (!STRATEGIES.includes(strategy)) {
        throw new Error(`strategy must be one of ${STRATEGIES.join(", ")}`);
      }

      const risk = "remote_launch" as const;
      try {
        await gateAndConfirm({
          runtime,
          risk,
          force: params.force,
          ctx,
          title: "Confirm reexecute run",
          message: `Reexecute parent run ${parentRunId} with strategy ${strategy}?`,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        auditMutation({
          runtime,
          tool: "dagster_reexecute_run",
          risk,
          outcome: msg.includes("declined") ? "declined" : "denied",
          summary: msg,
          entityIds: [parentRunId],
        });
        throw err;
      }

      const client = await runtime.ensureClient({ signal: signal ?? ctx?.signal });
      const data = await client.request<{ launchRunReexecution: Record<string, unknown> }>({
        query: REEXECUTE_RUN_MUTATION,
        variables: {
          reexecutionParams: { parentRunId, strategy },
        },
        signal: signal ?? ctx?.signal,
        operationName: "DagsterReexecuteRun",
      });

      const outcome = mapReexecuteResult(data);
      if (outcome.ok) {
        for (const id of outcome.entityIds) runtime.rememberEntity("run", id);
      }
      auditMutation({
        runtime,
        tool: "dagster_reexecute_run",
        risk,
        outcome: outcome.ok ? "success" : "error",
        summary: outcome.summary,
        entityIds: outcome.entityIds,
      });
      return mutationToolResult(outcome);
    },
  }));
}
