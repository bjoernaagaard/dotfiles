import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { DagsterRuntime } from "../../runtime.ts";
import {
  TERMINATE_RUN_MUTATION,
  TERMINATE_RUNS_MUTATION,
} from "../../clients/documents/terminate.gql.ts";
import {
  mapTerminateRunResult,
  mapTerminateRunsResult,
} from "../../domain/mutations.ts";
import {
  assertRuntimeOpen,
  auditMutation,
  gateAndConfirm,
  mutationToolResult,
} from "./mutation-helpers.ts";
import { attachSafeRenderers } from "../../render/index.ts";

const POLICIES = ["SAFE_TERMINATE", "MARK_AS_CANCELED_IMMEDIATELY"] as const;

export function createTerminateRunTool(runtime: DagsterRuntime) {
  return attachSafeRenderers(defineTool({
    name: "dagster_terminate_run",
    label: "Terminate Run",
    description: "Terminate one or more Dagster runs only after status inspection. Remote state change is policy-gated; confirm in UI or pass force=true in non-UI modes when allowed.",
    parameters: Type.Object({
      runId: Type.Optional(Type.String()),
      runIds: Type.Optional(Type.Array(Type.String())),
      terminatePolicy: Type.Optional(
        Type.Unsafe<(typeof POLICIES)[number]>(Type.String({ enum: [...POLICIES] })),
      ),
      force: Type.Optional(Type.Boolean({ description: "Non-UI confirmation override when policy allows; readOnly still blocks." })),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      assertRuntimeOpen(runtime, signal);
      const ids = [
        ...(params.runId ? [params.runId.trim()] : []),
        ...((params.runIds ?? []).map((r) => r.trim()).filter(Boolean)),
      ];
      const unique = [...new Set(ids.filter(Boolean))];
      if (unique.length === 0) throw new Error("runId or runIds is required");

      const risk = "remote_state" as const;
      try {
        await gateAndConfirm({
          runtime,
          risk,
          force: params.force,
          ctx,
          title: "Confirm terminate run",
          message: `Terminate run(s): ${unique.join(", ")}?`,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        auditMutation({
          runtime,
          tool: "dagster_terminate_run",
          risk,
          outcome: msg.includes("declined") ? "declined" : "denied",
          summary: msg,
          entityIds: unique,
        });
        throw err;
      }

      const client = await runtime.ensureClient({ signal: signal ?? ctx?.signal });
      const terminatePolicy = params.terminatePolicy;

      if (unique.length === 1) {
        const data = await client.request<{ terminateRun: Record<string, unknown> }>({
          query: TERMINATE_RUN_MUTATION,
          variables: { runId: unique[0], terminatePolicy },
          signal: signal ?? ctx?.signal,
          operationName: "DagsterTerminateRun",
        });
        const outcome = mapTerminateRunResult(data);
        auditMutation({
          runtime,
          tool: "dagster_terminate_run",
          risk,
          outcome: outcome.ok ? "success" : "error",
          summary: outcome.summary,
          entityIds: outcome.entityIds ?? unique,
        });
        return mutationToolResult(outcome);
      }

      const data = await client.request<{ terminateRuns: Record<string, unknown> }>({
        query: TERMINATE_RUNS_MUTATION,
        variables: { runIds: unique, terminatePolicy },
        signal: signal ?? ctx?.signal,
        operationName: "DagsterTerminateRuns",
      });
      const outcome = mapTerminateRunsResult(data);
      auditMutation({
        runtime,
        tool: "dagster_terminate_run",
        risk,
        outcome: outcome.ok ? "success" : "error",
        summary: outcome.summary,
        entityIds: outcome.entityIds ?? unique,
      });
      return mutationToolResult(outcome);
    },
  }));
}
