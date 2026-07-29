import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { DagsterRuntime } from "../../runtime.ts";
import {
  RESET_SENSOR_MUTATION,
  SENSOR_LOOKUP_QUERY,
  START_SENSOR_MUTATION,
  STOP_SENSOR_MUTATION,
} from "../../clients/documents/sensor.gql.ts";
import {
  mapSensorMutationResult,
  resolveRepoDefaults,
} from "../../domain/mutations.ts";
import {
  assertRuntimeOpen,
  auditMutation,
  gateAndConfirm,
  mutationToolResult,
} from "./mutation-helpers.ts";

const ACTIONS = ["start", "stop", "reset"] as const;

export function createSensorControlTool(runtime: DagsterRuntime) {
  return defineTool({
    name: "dagster_sensor_control",
    label: "Sensor Control",
    description: "Start, stop, or reset a Dagster sensor after inspecting current state and target. Remote state is policy-gated; UI confirmation or allowed non-UI force=true is required.",
    parameters: Type.Object({
      action: Type.Unsafe<(typeof ACTIONS)[number]>(
        Type.String({ enum: [...ACTIONS], description: "Choose start, stop, or reset after inspecting sensor state." }),
      ),
      sensorName: Type.String(),
      repositoryLocationName: Type.Optional(Type.String()),
      repositoryName: Type.Optional(Type.String()),
      id: Type.Optional(Type.String()),
      force: Type.Optional(Type.Boolean({ description: "Non-UI confirmation override when policy allows; readOnly still blocks." })),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      assertRuntimeOpen(runtime, signal);
      const action = params.action;
      if (!ACTIONS.includes(action)) {
        throw new Error(`action must be one of ${ACTIONS.join(", ")}`);
      }
      const sensorName = params.sensorName.trim();
      if (!sensorName) throw new Error("sensorName is required");

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
          title: `Confirm sensor ${action}`,
          message: `${action} sensor ${sensorName} @ ${repo.repositoryLocationName}?`,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        auditMutation({
          runtime,
          tool: "dagster_sensor_control",
          risk,
          outcome: msg.includes("declined") ? "declined" : "denied",
          summary: msg,
          entityIds: [sensorName],
        });
        throw err;
      }

      const client = await runtime.ensureClient({ signal: signal ?? ctx?.signal });
      const sensorSelector = {
        sensorName,
        repositoryName: repo.repositoryName,
        repositoryLocationName: repo.repositoryLocationName,
      };

      let field: string;
      let data: Record<string, unknown>;

      if (action === "start") {
        field = "startSensor";
        data = await client.request({
          query: START_SENSOR_MUTATION,
          variables: { sensorSelector },
          signal: signal ?? ctx?.signal,
          operationName: "DagsterStartSensor",
        });
      } else if (action === "reset") {
        field = "resetSensor";
        data = await client.request({
          query: RESET_SENSOR_MUTATION,
          variables: { sensorSelector },
          signal: signal ?? ctx?.signal,
          operationName: "DagsterResetSensor",
        });
      } else {
        let id = params.id?.trim();
        if (!id) {
          const lookup = await client.request<{
            sensorOrError: Record<string, unknown>;
          }>({
            query: SENSOR_LOOKUP_QUERY,
            variables: { sensorSelector },
            signal: signal ?? ctx?.signal,
            operationName: "DagsterSensorLookup",
          });
          const node = lookup.sensorOrError;
          if (!node || node.__typename !== "Sensor") {
            const message =
              typeof node?.message === "string"
                ? node.message
                : `Sensor not found: ${sensorName}`;
            const outcome = {
              ok: false as const,
              error: {
                kind: "NotFound" as const,
                typename: String(node?.__typename ?? "SensorNotFoundError"),
                message,
              },
              summary: message,
              entityIds: [sensorName],
            };
            auditMutation({
              runtime,
              tool: "dagster_sensor_control",
              risk,
              outcome: "error",
              summary: message,
              entityIds: [sensorName],
            });
            return mutationToolResult(outcome);
          }
          const state = node.sensorState as { id?: string } | undefined;
          id = state?.id;
          if (!id) throw new Error("Could not resolve sensor state id for stop");
        }
        field = "stopSensor";
        data = await client.request({
          query: STOP_SENSOR_MUTATION,
          variables: { id },
          signal: signal ?? ctx?.signal,
          operationName: "DagsterStopSensor",
        });
      }

      const outcome = mapSensorMutationResult(data, field);
      auditMutation({
        runtime,
        tool: "dagster_sensor_control",
        risk,
        outcome: outcome.ok ? "success" : "error",
        summary: outcome.summary,
        entityIds: outcome.entityIds,
      });
      return mutationToolResult(outcome);
    },
  });
}
