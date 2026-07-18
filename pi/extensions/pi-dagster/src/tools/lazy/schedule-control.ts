import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { DagsterRuntime } from "../../runtime.ts";
import {
  RESET_SCHEDULE_MUTATION,
  SCHEDULE_LOOKUP_QUERY,
  START_SCHEDULE_MUTATION,
  STOP_SCHEDULE_MUTATION,
} from "../../clients/documents/schedule.gql.ts";
import {
  mapScheduleMutationResult,
  resolveRepoDefaults,
} from "../../domain/mutations.ts";
import {
  assertRuntimeOpen,
  auditMutation,
  gateAndConfirm,
  mutationToolResult,
} from "./mutation-helpers.ts";

const ACTIONS = ["start", "stop", "reset"] as const;

export function createScheduleControlTool(runtime: DagsterRuntime) {
  return defineTool({
    name: "dagster_schedule_control",
    label: "Schedule Control",
    description: "Start, stop, or reset a Dagster schedule after inspecting current state and target. Remote state is policy-gated; UI confirmation or allowed non-UI force=true is required.",
    parameters: Type.Object({
      action: Type.Unsafe<(typeof ACTIONS)[number]>(
        Type.String({ enum: [...ACTIONS], description: "Choose start, stop, or reset after inspecting schedule state." }),
      ),
      scheduleName: Type.String(),
      repositoryLocationName: Type.Optional(Type.String()),
      repositoryName: Type.Optional(Type.String()),
      /** Optional instigation state id for stop (otherwise looked up). */
      id: Type.Optional(Type.String()),
      force: Type.Optional(Type.Boolean({ description: "Non-UI confirmation override when policy allows; readOnly still blocks." })),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      assertRuntimeOpen(runtime, signal);
      const action = params.action;
      if (!ACTIONS.includes(action)) {
        throw new Error(`action must be one of ${ACTIONS.join(", ")}`);
      }
      const scheduleName = params.scheduleName.trim();
      if (!scheduleName) throw new Error("scheduleName is required");

      const profile = runtime.getActiveProfile();
      const repo = resolveRepoDefaults({
        repositoryLocationName: params.repositoryLocationName,
        repositoryName: params.repositoryName,
        profileDefaultLocation: profile?.defaultLocation,
        profileDefaultRepository: profile?.defaultRepository,
      });

      const risk = "remote_state" as const;
      try {
        await gateAndConfirm({
          runtime,
          risk,
          force: params.force,
          ctx,
          title: `Confirm schedule ${action}`,
          message: `${action} schedule ${scheduleName} @ ${repo.repositoryLocationName}?`,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        auditMutation({
          runtime,
          tool: "dagster_schedule_control",
          risk,
          outcome: msg.includes("declined") ? "declined" : "denied",
          summary: msg,
          entityIds: [scheduleName],
        });
        throw err;
      }

      const client = await runtime.ensureClient({ signal: signal ?? ctx?.signal });
      const scheduleSelector = {
        scheduleName,
        repositoryName: repo.repositoryName,
        repositoryLocationName: repo.repositoryLocationName,
      };

      let field: string;
      let data: Record<string, unknown>;

      if (action === "start") {
        field = "startSchedule";
        data = await client.request({
          query: START_SCHEDULE_MUTATION,
          variables: { scheduleSelector },
          signal: signal ?? ctx?.signal,
          operationName: "DagsterStartSchedule",
        });
      } else if (action === "reset") {
        field = "resetSchedule";
        data = await client.request({
          query: RESET_SCHEDULE_MUTATION,
          variables: { scheduleSelector },
          signal: signal ?? ctx?.signal,
          operationName: "DagsterResetSchedule",
        });
      } else {
        // stop — need instigation state id
        let id = params.id?.trim();
        if (!id) {
          const lookup = await client.request<{
            scheduleOrError: Record<string, unknown>;
          }>({
            query: SCHEDULE_LOOKUP_QUERY,
            variables: { scheduleSelector },
            signal: signal ?? ctx?.signal,
            operationName: "DagsterScheduleLookup",
          });
          const node = lookup.scheduleOrError;
          if (!node || node.__typename !== "Schedule") {
            const message =
              typeof node?.message === "string"
                ? node.message
                : `Schedule not found: ${scheduleName}`;
            const outcome = {
              ok: false as const,
              error: {
                kind: "NotFound" as const,
                typename: String(node?.__typename ?? "ScheduleNotFoundError"),
                message,
              },
              summary: message,
              entityIds: [scheduleName],
            };
            auditMutation({
              runtime,
              tool: "dagster_schedule_control",
              risk,
              outcome: "error",
              summary: message,
              entityIds: [scheduleName],
            });
            return mutationToolResult(outcome);
          }
          const state = node.scheduleState as { id?: string } | undefined;
          id = state?.id;
          if (!id) throw new Error("Could not resolve schedule state id for stop");
        }
        field = "stopRunningSchedule";
        data = await client.request({
          query: STOP_SCHEDULE_MUTATION,
          variables: { id },
          signal: signal ?? ctx?.signal,
          operationName: "DagsterStopSchedule",
        });
      }

      const outcome = mapScheduleMutationResult(data, field);
      auditMutation({
        runtime,
        tool: "dagster_schedule_control",
        risk,
        outcome: outcome.ok ? "success" : "error",
        summary: outcome.summary,
        entityIds: outcome.entityIds,
      });
      return mutationToolResult(outcome);
    },
  });
}
