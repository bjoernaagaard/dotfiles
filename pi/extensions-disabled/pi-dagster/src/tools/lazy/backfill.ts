import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { DagsterRuntime } from "../../runtime.ts";
import {
  CANCEL_BACKFILL_MUTATION,
  LAUNCH_BACKFILL_MUTATION,
  RESUME_BACKFILL_MUTATION,
} from "../../clients/documents/backfill.gql.ts";
import {
  mapBackfillCancelResult,
  mapBackfillLaunchResult,
  mapBackfillResumeResult,
  parseAssetKey,
  type MutationOutcome,
} from "../../domain/mutations.ts";
import {
  assertRuntimeOpen,
  auditMutation,
  gateAndConfirm,
  mutationToolResult,
} from "./mutation-helpers.ts";
import type { RiskClass } from "../../policy/types.ts";
import { attachSafeRenderers } from "../../render/index.ts";

const ACTIONS = ["launch", "cancel", "resume"] as const;

export function createBackfillTool(runtime: DagsterRuntime) {
  return attachSafeRenderers(defineTool({
    name: "dagster_backfill",
    label: "Backfill",
    description:
      "Launch, cancel, or resume a partition backfill after inspecting action, asset selection, and partition scope. Launch is remote_launch; cancel/resume remote_state; all are policy-gated.",
    parameters: Type.Object({
      action: Type.Unsafe<(typeof ACTIONS)[number]>(
        Type.String({ enum: [...ACTIONS], description: "Choose launch, cancel, or resume only after inspecting the target state." }),
      ),
      backfillId: Type.Optional(Type.String()),
      assetSelection: Type.Optional(Type.Array(Type.String())),
      partitionNames: Type.Optional(Type.Array(Type.String())),
      allPartitions: Type.Optional(Type.Boolean()),
      fromFailure: Type.Optional(Type.Boolean()),
      force: Type.Optional(Type.Boolean({ description: "Non-UI confirmation override when policy allows; readOnly still blocks." })),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      assertRuntimeOpen(runtime, signal);
      const action = params.action;
      if (!ACTIONS.includes(action)) {
        throw new Error(`action must be one of ${ACTIONS.join(", ")}`);
      }

      const risk: RiskClass = action === "launch" ? "remote_launch" : "remote_state";

      try {
        await gateAndConfirm({
          runtime,
          risk,
          force: params.force,
          ctx,
          title: `Confirm backfill ${action}`,
          message:
            action === "launch"
              ? `Launch partition backfill (assets=${(params.assetSelection ?? []).join(",") || "—"})?`
              : `${action} backfill ${params.backfillId ?? "?"}?`,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        auditMutation({
          runtime,
          tool: "dagster_backfill",
          risk,
          outcome: msg.includes("declined") ? "declined" : "denied",
          summary: msg,
          entityIds: params.backfillId ? [params.backfillId] : undefined,
        });
        throw err;
      }

      const client = await runtime.ensureClient({ signal: signal ?? ctx?.signal });
      let outcome: MutationOutcome;

      if (action === "launch") {
        if (!params.assetSelection?.length && !params.partitionNames?.length && !params.allPartitions) {
          throw new Error(
            "launch requires assetSelection and (partitionNames or allPartitions=true)",
          );
        }
        const backfillParams: Record<string, unknown> = {};
        if (params.assetSelection?.length) {
          backfillParams.assetSelection = params.assetSelection.map((k) => ({
            path: parseAssetKey(k),
          }));
        }
        if (params.partitionNames?.length) {
          backfillParams.partitionNames = params.partitionNames;
        }
        if (params.allPartitions) backfillParams.allPartitions = true;
        if (params.fromFailure) backfillParams.fromFailure = true;

        const data = await client.request<{ launchPartitionBackfill: Record<string, unknown> }>({
          query: LAUNCH_BACKFILL_MUTATION,
          variables: { backfillParams },
          signal: signal ?? ctx?.signal,
          operationName: "DagsterLaunchBackfill",
        });
        outcome = mapBackfillLaunchResult(data);
      } else if (action === "cancel") {
        const backfillId = params.backfillId?.trim();
        if (!backfillId) throw new Error("backfillId is required for cancel");
        const data = await client.request<{ cancelPartitionBackfill: Record<string, unknown> }>({
          query: CANCEL_BACKFILL_MUTATION,
          variables: { backfillId },
          signal: signal ?? ctx?.signal,
          operationName: "DagsterCancelBackfill",
        });
        outcome = mapBackfillCancelResult(data);
      } else {
        const backfillId = params.backfillId?.trim();
        if (!backfillId) throw new Error("backfillId is required for resume");
        const data = await client.request<{ resumePartitionBackfill: Record<string, unknown> }>({
          query: RESUME_BACKFILL_MUTATION,
          variables: { backfillId },
          signal: signal ?? ctx?.signal,
          operationName: "DagsterResumeBackfill",
        });
        outcome = mapBackfillResumeResult(data);
      }

      if (outcome.ok) {
        for (const id of outcome.entityIds) runtime.rememberEntity("backfill", id);
      }
      auditMutation({
        runtime,
        tool: "dagster_backfill",
        risk,
        outcome: outcome.ok ? "success" : "error",
        summary: outcome.summary,
        entityIds: outcome.entityIds,
      });
      return mutationToolResult(outcome);
    },
  }));
}
